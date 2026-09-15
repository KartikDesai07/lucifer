import { inr } from "@/lib/utils";
// From the pure message module — NEVER from "@/lib/reward-claim": that module
// funds claims and imports Mongoose models, and a value import of it from here
// put models/Customer.ts into the POS browser bundle (2026-09-14 incident).
import { rewardClaimMessage, type RewardClaimFailure } from "@/lib/reward-claim-messages";
import type { LoyaltyRewardKind } from "@pos/shared/loyalty-rules";

// CB-5B S9 — the STAFF POS rung-picking library. Pure, DB-free, React-free:
// the ONE place "which rungs can this bill use, and which should be
// pre-selected" lives, so the counter picker and any future surface cannot
// drift apart. The server money path (lib/reward-claim.ts,
// lib/reward-redemption.ts) is untouched by this file and remains the sole
// place a claim is actually funded — everything here is a client-side
// PREVIEW of what that path will decide, so the two must be mirrored exactly
// or the counter offers a rung the server then refuses.

// A rung of the owner-configured loyalty ladder, shaped for the counter to
// read. `affordable` is the RAW-STAMPS test — see decideRedemption's own
// `stamps < milestone.at` check (lib/reward-redemption.ts:49). It is NOT the
// diner-facing ladder's `cyclePosition` (stamps % cycleLength,
// packages/shared/src/loyalty-rules.ts ladderProgress): the server reads the
// customer's raw `stamps` field with no modulo, so a picker built on
// cyclePosition would pre-select or allow a rung the server then refuses
// with a 400. Whoever builds this array from a resolved ladder + a
// customer's stamp balance MUST compare raw stamps to `at`, never
// cyclePosition, to compute `affordable`.
export interface RewardRung {
  at: number;
  kind: LoyaltyRewardKind;
  value: number;
  item: string;
  qty?: number;
  minBill: number | null;
  affordable: boolean;
  // Two raw ladder rows share this `at`, so the server's claim gate refuses it
  // as "ambiguous-reward" (lib/reward-claim.ts findMilestoneAt). Optional so a
  // caller that predates the field still compiles; absent reads as "not
  // ambiguous", which is the safe default for every well-formed ladder.
  ambiguous?: boolean;
}

/** A rung plus the CLIENT-side verdict for the CURRENT bill. */
export interface RungOffer {
  rung: RewardRung;
  usable: boolean;
  /** Plain-English reason, present iff !usable. */
  reason?: string;
}

// The two rejection reasons this preview can produce, reusing
// lib/reward-claim.ts's counter-facing copy (CLAIM_MESSAGES) rather than
// hand-copying strings that would then drift from the server's own wording.
const AFFORDABILITY_REASON: RewardClaimFailure = "insufficient-stamps";
const MIN_BILL_REASON: RewardClaimFailure = "below-min-bill";
// The claim gate's own verdict for a duplicated `at`, so the counter reads the
// same words the server would have answered with.
const AMBIGUOUS_REASON: RewardClaimFailure = "ambiguous-reward";

/**
 * Client-side preview of decideRedemption, one rung at a time, in the SAME
 * order (lib/reward-redemption.ts's decideRedemption + its own doc comment):
 *   1. not affordable (raw stamps < `at`) -> "insufficient-stamps".
 *   2. bill under the rung's own `minBill` -> "below-min-bill".
 *   3. otherwise usable.
 * TOTAL: a non-finite `billTotal` is treated as 0 (matching how
 * loyalty-rules.ts's ladderProgress clamps a corrupt `stamps` value) rather
 * than propagating NaN into the minBill comparison, which would make every
 * `billTotal < minBill` compare false and silently mark every rung usable.
 */
export function rungOffers(rungs: readonly RewardRung[], billTotal: number): RungOffer[] {
  const safeBillTotal = Number.isFinite(billTotal) ? billTotal : 0;

  return rungs.map((rung) => {
    // Checked FIRST, ahead of the balance: a duplicated rung is refused by the
    // claim gate before it ever looks at stamps (findMilestoneAt runs upstream
    // of decideRedemption), and telling a counter with a full card "not enough
    // stamps" would send them to the wrong place. This one is the owner's to
    // fix in Settings.
    if (rung.ambiguous === true) {
      return { rung, usable: false, reason: rewardClaimMessage(AMBIGUOUS_REASON) };
    }
    if (!rung.affordable) {
      return { rung, usable: false, reason: rewardClaimMessage(AFFORDABILITY_REASON) };
    }
    if (rung.minBill != null && safeBillTotal < rung.minBill) {
      return { rung, usable: false, reason: rewardClaimMessage(MIN_BILL_REASON) };
    }
    return { rung, usable: true };
  });
}

/**
 * The auto-default the counter sees PRE-SELECTED: the highest `at` among
 * usable offers, or undefined if none is usable.
 *
 * A3/D7 BINDING: staff may override this DOWN to any other usable rung, and
 * the CHOSEN rung's `at` — not "highest affordable" — is what gets sent to
 * the server. The server must never re-derive "highest affordable" itself,
 * or a staff override to a lower rung would be silently ignored and the
 * customer would be charged the higher rung's cost instead of the one the
 * counter actually picked.
 */
export function pickDefaultRung(offers: readonly RungOffer[]): RungOffer | undefined {
  let best: RungOffer | undefined;
  for (const offer of offers) {
    if (!offer.usable) continue;
    if (best === undefined || offer.rung.at > best.rung.at) best = offer;
  }
  return best;
}

/**
 * Plain-English rendering of a rung's worth for the counter, e.g.
 * "Rs 100 off" / "10% off" / the dish name for an item rung.
 *
 * MIRRORS components/public/PublicRewardsTab.tsx's local `rewardWorth`
 * function byte-for-byte in behaviour (that function is not exported, and a
 * lib must never import from a component, so this is a deliberate parallel
 * implementation, not a shared one) — the two MUST be kept in step if either
 * changes. Uses the same `inr` helper (lib/utils.ts, re-exporting
 * @pos/shared/utils) as the diner-facing copy so rupee formatting never
 * diverges between the two surfaces.
 *
 * TOTAL: never throws, never returns NaN — a non-finite `value` renders as
 * 0 via `inr`/template interpolation rather than propagating "NaN off your
 * bill" to the counter.
 */
export function rungWorthLabel(rung: RewardRung): string {
  const safeValue = Number.isFinite(rung.value) ? rung.value : 0;
  if (rung.kind === "item") return rung.item.length > 0 ? rung.item : "a free item";
  if (rung.kind === "percent") return `${safeValue}% off your bill`;
  return `${inr(safeValue)} off your bill`;
}
