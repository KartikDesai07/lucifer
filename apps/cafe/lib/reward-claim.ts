import type { ISettings } from "@/models/Settings";
import { Customer } from "@/models/Customer";
import { resolveLoyaltyConfig } from "@/lib/diner-loyalty";
import { isRungClaimWindowClosed } from "@pos/shared/public-promo";
import {
  decideRedemption,
  claimRewardStamps,
  returnRewardStamps,
  type RewardAssignment,
} from "@/lib/reward-redemption";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";
import { resolveRewardItemLine, type ResolveRewardItemResult, type RewardItemLine } from "@/lib/reward-item-line";

// CB-5B S4/S5 — the ONE place a staff writer turns a client's INTENT into a
// funded reward. Every staff money writer (create, add-round, settle) goes
// through this file, so the fence below exists exactly once rather than in
// four hand-copied variants.
//
// THE MONEY FENCE (schemas/order.schema.ts:35 states the rule this enforces):
// a client may send only `rewardAt` — the stamp COST of the rung it wants,
// which is an identifier into the OWNER-configured ladder, never an amount.
// Value, kind, dish, qty and the stamp price are all resolved server-side from
// Settings plus the customer's own row. A client that could send a value could
// grant itself an unfunded discount.

// Why a rung is identified by `at` and not by array index: `at` is the stamp
// cost the diner and the staff both SEE on the card, and it survives the owner
// reordering or inserting rungs — an index does not.
// The failure union + the staff-facing message table live in the pure,
// import-free lib/reward-claim-messages.ts so the counter's client-side preview
// (lib/reward-rungs.ts) can read the SAME words without pulling this module —
// and its Mongoose models — into the browser bundle (2026-09-14 /pos incident).
// Re-exported here so every server caller keeps its existing import address.
import { rewardClaimMessage, type RewardClaimFailure } from "@/lib/reward-claim-messages";
export { rewardClaimMessage };
export type { RewardClaimFailure };

export type RewardResolution =
  | { ok: true; milestone: ResolvedMilestone; reward: RedeemedReward; cost: number }
  | { ok: false; reason: RewardClaimFailure };

// Staff-readable words for a FAILED resolveRewardItemLine call — kept here
// rather than inline in a route (per the CB-5B S4/S5 spec) so the three
// order-taking writers that append a claimed item reward's dish line all
// read the same counter-facing copy. Plain English per this repo's UI-copy
// rule (Hinglish is chat-only).
const ITEM_LINE_MESSAGES: Record<Exclude<ResolveRewardItemResult, { ok: true }>["reason"], string> = {
  "not-an-item-reward": "That reward has no dish attached",
  "no-product-ref": "This reward predates linked dishes — pick another rung",
  "product-missing": "The reward dish is no longer on the menu",
  "product-unavailable": "The reward dish is marked unavailable right now",
  "variation-required": "Pick a size for the reward dish",
};

export function rewardItemLineMessage(
  reason: Exclude<ResolveRewardItemResult, { ok: true }>["reason"],
): string {
  return ITEM_LINE_MESSAGES[reason];
}

/**
 * Find the rung the client asked for, by its stamp cost, in the ladder the
 * OWNER configured.
 *
 * AMBIGUITY IS REFUSED, never first-match — and the check reads the RAW stored
 * rows, not the resolved ladder, because that is the only layer where the
 * ambiguity still exists. `normalizeMilestones` (loyalty-rules.ts) deliberately
 * collapses a duplicate `at` by keeping the FIRST row, which is right for the
 * display paths it was written for but is precisely the silent first-match this
 * claim path must not do: it would spend one rung's stamps and hand the diner
 * the other rung's reward. `at` is unique only because the SAVE-time refinement
 * (settings-loyalty.schema.ts:133-140) rejects duplicates; a document stored
 * before that refinement shipped carries no such guarantee, which is the same
 * assumption that broke session 33's migration when it matched rows by `at`.
 * So the duplicate is detected upstream of the normalizer and surfaced to the
 * owner as a refusal they can act on.
 */
export function findMilestoneAt(
  settings: ISettings | null,
  rewardAt: number,
): { ok: true; milestone: ResolvedMilestone } | { ok: false; reason: "no-such-reward" | "ambiguous-reward" } {
  // The raw rows as stored, BEFORE normalization dedupes them. A legacy doc is
  // the only way two rows share an `at`, and it is exactly the case that must
  // not resolve silently.
  const rawRows = settings?.loyaltyRules?.milestones ?? [];
  const rawMatches = rawRows.filter((m) => m.at === rewardAt);
  if (rawMatches.length > 1) return { ok: false, reason: "ambiguous-reward" };

  const { ladder } = resolveLoyaltyConfig(settings);
  const matches = ladder.milestones.filter((m) => m.at === rewardAt);
  if (matches.length === 0) return { ok: false, reason: "no-such-reward" };
  // Defensive: the raw check above already refused a duplicate, so a second
  // match here would mean the normalizer stopped deduping. Refuse rather than
  // silently take one.
  if (matches.length > 1) return { ok: false, reason: "ambiguous-reward" };
  return { ok: true, milestone: matches[0]! };
}

export interface ResolveRewardClaimInput {
  settings: ISettings | null;
  customerId: string | undefined;
  rewardAt: number;
  // The bill the reward is being claimed against, in RUPEES — the per-milestone
  // `minBill` gate is evaluated against this. Same unit as models/Order.ts's
  // `total` (a plain Number); do NOT pass paise.
  billTotal: number;
  // D9: the settle path REFUSES a kind:"item" rung. The free dish has to reach
  // the KITCHEN while the order is being taken — granting one at payment time
  // would tell the kitchen to cook something after the customer has paid and
  // left. Order-taking writers pass false.
  refuseItemKind: boolean;
}

/**
 * Resolve a claim WITHOUT spending anything: which rung, worth what, and may
 * this customer afford it right now. Split from the spend so a caller can
 * price the bill first and claim only once it is about to write.
 *
 * A reward ALWAYS requires a customer: stamps live on a Customer row, so a
 * reward claimed against nobody is money off the bill that nothing funded.
 */
export async function resolveRewardClaim(
  input: ResolveRewardClaimInput,
): Promise<RewardResolution> {
  if (!input.customerId) return { ok: false, reason: "no-customer" };

  const found = findMilestoneAt(input.settings, input.rewardAt);
  if (!found.ok) return { ok: false, reason: found.reason };

  // Checked BEFORE the stamp balance so the operator hears the actionable
  // reason ("add it while ordering") rather than a balance complaint about a
  // rung they were never allowed to use here.
  if (input.refuseItemKind && found.milestone.kind === "item") {
    return { ok: false, reason: "item-not-at-settle" };
  }

  // The balance is read here only to REJECT early with a useful message. It is
  // NOT what makes the spend safe: claimRewardStamps carries `stamps: {$gte:
  // cost}` in its own filter, so the real check is atomic against another
  // device redeeming for the same diner between this read and that write.
  //
  // `rungEarnedAt` widened onto this SAME projection (CB-5D part 2 defect fix)
  // — SINGLE-HOMING the claim-window check here means every staff writer
  // (create, add-round, settle) and the QR accept bridge (which all resolve a
  // claim through this one function) inherits it, rather than four hand-copied
  // checks silently drifting apart.
  const customer = await Customer.findById(input.customerId).select("stamps rungEarnedAt").lean();
  if (!customer) return { ok: false, reason: "no-customer" };

  // CLAIM-WINDOW GATE — placed with the other "is this rung even claimable"
  // checks, before the balance/minBill decision below, exactly like the
  // item-not-at-settle check above (same reasoning: an operator should hear
  // the actionable "the window closed" rather than a balance complaint about a
  // rung they were never allowed to claim here). Mirrors the QR submit gate's
  // OWN read of this field (lib/order-request-reward.ts:161-162) exactly:
  // `.lean()` returns `rungEarnedAt` as a plain object, NOT a Mongoose Map
  // (Map hydration is a Document-only feature lean skips), so it is indexed as
  // `[key]`, never `.get(key)` — `.get()` would throw on a lean result. A rung
  // never crossed (every customer who earned it before this feature shipped)
  // is simply an absent key, read as `undefined` via optional chaining and
  // passed straight through as `earnedAt?.getTime()` — NEVER coerced to 0: a
  // literal 0 reads as the 1970 epoch and would refuse EVERY pre-existing
  // customer's claim on a rung with a configured window. A rung with no
  // configured `claimWithinDays` (null/absent) is never refused either way —
  // isRungClaimWindowClosed's own contract.
  const earnedAt = customer.rungEarnedAt?.[String(found.milestone.at)];
  if (isRungClaimWindowClosed(earnedAt?.getTime(), found.milestone.claimWithinDays, Date.now())) {
    return { ok: false, reason: "claim-window-closed" };
  }

  const decision = decideRedemption(customer.stamps ?? 0, found.milestone, input.billTotal);
  if (!decision.ok) {
    // "no-milestone" cannot occur — a milestone was resolved above — but the
    // mapping is total rather than asserted, so a future reason added to
    // decideRedemption surfaces as a refusal instead of an exception.
    return {
      ok: false,
      reason: decision.reason === "no-milestone" ? "no-such-reward" : decision.reason,
    };
  }
  return { ok: true, milestone: found.milestone, reward: decision.reward, cost: decision.cost };
}

// RewardItemLine (reward-item-line.ts) plus the two fields every order-item
// writer's array element carries (modifiers/instructions — orderItemSchema's
// own Zod defaults make them REQUIRED on the parsed shape, never optional) and
// the round stamp — i.e. exactly what a caller can splice straight into the
// items array it is about to price and persist, with no further field-filling.
export type ResolvedRewardOrderItem = RewardItemLine & {
  modifiers: string[];
  instructions: string;
  kotRound: number;
};

export type RewardClaimAndLineResult =
  | { ok: true; claim: Extract<RewardResolution, { ok: true }>; line?: ResolvedRewardOrderItem }
  | { ok: false; message: string };

/**
 * The FULL create/add-round-time resolution: resolve the claim, and — for a
 * kind:"item" rung — resolve its dish line too, in one call. Both failures
 * collapse to a single staff-readable `message` (rewardClaimMessage or
 * rewardItemLineMessage) so the three order-taking writers (create,
 * add-round, and — for a non-item kind only — settle) don't each re-derive
 * which message function applies to which half of the resolution.
 *
 * `kotRound` is the round the resolved dish line is stamped with — 1 for a
 * brand-new order, the tab's next round number for an add-round — so the
 * kitchen sees the free dish on whichever ticket the rest of this call's
 * items are firing on.
 */
export async function resolveRewardClaimAndLine(
  input: ResolveRewardClaimInput,
  kotRound: number,
): Promise<RewardClaimAndLineResult> {
  const claim = await resolveRewardClaim(input);
  if (!claim.ok) return { ok: false, message: rewardClaimMessage(claim.reason) };

  if (claim.reward.kind !== "item") return { ok: true, claim };

  const resolvedLine = await resolveRewardItemLine(claim.reward, undefined);
  if (!resolvedLine.ok) return { ok: false, message: rewardItemLineMessage(resolvedLine.reason) };
  // modifiers/instructions: a comped dish carries neither — the claim names
  // no modifiers and the reward note (REWARD_ITEM_LINE_NOTE) already lives in
  // resolvedLine.line.note, a DIFFERENT field from the free-text `instructions`
  // a staff-entered line carries.
  return {
    ok: true,
    claim,
    line: { ...resolvedLine.line, modifiers: [], instructions: "", kotRound },
  };
}

/**
 * The five Order snapshot fields for a resolved reward, as a `$set` fragment.
 * Omit-empty: a rung with no dish writes no dish keys, so a flat reward leaves
 * no dead `rewardItemProductId` in the ledger.
 *
 * `rewardStamps` records what the claim COST. It is the provenance a refund or
 * an audit reads years later, and it is stored rather than re-derived because
 * the owner may retune the rung's `at` afterwards.
 */
export function rewardSnapshotFields(reward: RedeemedReward, cost: number): Record<string, unknown> {
  return {
    rewardAt: reward.at,
    rewardKind: reward.kind,
    rewardValue: reward.value,
    rewardItem: reward.item,
    rewardStamps: cost,
    ...(reward.itemProductId === undefined ? {} : { rewardItemProductId: reward.itemProductId }),
    ...(reward.qty === undefined ? {} : { rewardQty: reward.qty }),
  };
}

// Re-exported so a route wires the whole claim lifecycle from ONE import and
// cannot reach for the earn side's best-effort helpers by mistake.
export { claimRewardStamps, returnRewardStamps };
export type { RewardAssignment };
