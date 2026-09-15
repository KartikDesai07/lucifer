import {
  LOYALTY_REWARD_KINDS,
  LOYALTY_REWARD_QTY_DEFAULT,
  LOYALTY_REWARD_QTY_MIN,
  type LoyaltyRewardKind,
} from "./public-diner";
import { normalizePromoCode } from "./public-promo";

// CB-5A — the loyaltyRules CONTRACT: milestone-ladder + membership-level
// constants and PURE math, shared by the cafe runtime's settings form, its
// earn/redeem resolvers, and (eventually) the diner surface. Client-safe,
// DB-free, zod-free — the Zod half of this contract lives in
// `./schemas/settings-loyalty.schema.ts`, which imports these constants
// rather than restating them.
//
// This is a SEPARATE contract from public-diner.ts's flat
// loyaltyStampsPerReward/loyaltyRewardKind fields (CB-4) — those stay as they
// are for existing cafes; loyaltyRules is the richer multi-milestone +
// membership-level ladder an owner can opt into instead.

// CB-5D — bumped 1 -> 2: membership is removed from the container below.
// loyaltyRulesSchema pins `v` to the CURRENT version only, so this is what
// stops a stale v1 doc (still carrying `membership`) being silently re-saved
// under the new shape — it must 400 instead.
export const LOYALTY_RULES_SCHEMA_VERSION = 2;

export const LOYALTY_MILESTONES_MAX = 6;
export const LOYALTY_MILESTONE_AT_MIN = 1;
export const LOYALTY_MILESTONE_AT_MAX = 60;
// CB-5C — how many boxes the stamp card shows. Shares the milestone bounds so
// a reward can always sit on any box of the card.
export const LOYALTY_CARD_SIZE_MIN = LOYALTY_MILESTONE_AT_MIN;
export const LOYALTY_CARD_SIZE_MAX = LOYALTY_MILESTONE_AT_MAX;
export const LOYALTY_CARD_SIZE_DEFAULT = 8;

// CB-5D — bounds for the milestone's two TTL-in-days fields
// (loyaltyMilestoneSchema's promoCode/claimWithinDays). Min 1 (a 0-day claim
// window is not a window); max is a sane ceiling, not a real-world limit —
// same "generous cap, not a policy" reasoning as LOYALTY_MILESTONE_AT_MAX.
export const LOYALTY_CLAIM_WITHIN_DAYS_MIN = 1;
export const LOYALTY_CLAIM_WITHIN_DAYS_MAX = 365;




export const LOYALTY_UNIT_LABEL_MAX_LEN = 16;
export const LOYALTY_UNIT_LABEL_DEFAULT = "stamp";

// ── Milestone ladder ─────────────────────────────────────────────────────────

// A milestone as it comes off the wire/store — see LoyaltyMilestoneInput in
// settings-loyalty.schema.ts for the validated shape this is built from.
export interface LoyaltyMilestoneLike {
  at: number;
  kind: LoyaltyRewardKind;
  value: number;
  item: string;
  // CB-5B D8 — the product REFERENCE behind a kind:"item" rung (`item` is
  // only its display name). Optional here because a pre-D8 row stored on a
  // live cafe carries no ref; a consumer that needs to put the dish on a bill
  // must treat its absence as "not resolvable", never fall back to the name.
  itemProductId?: string | null;
  // CB-5B D11 — how many of that dish one claim grants. Absent = 1.
  qty?: number | null;
  minBill?: number | null;
  // CB-5D part 2 — the promo code this rung MINTS, and how long after EARNING
  // the rung it may still be claimed. Both are configured on the milestone
  // (settings-loyalty.schema.ts) and both must survive normalizeMilestones:
  // the CLAIM path only ever sees a ResolvedMilestone, so a field dropped here
  // is a field the assignment writer can never read — the code would be
  // configured, stored, and silently never assigned.
  promoCode?: string | null;
  claimWithinDays?: number | null;
}

export interface ResolvedMilestone {
  at: number;
  kind: LoyaltyRewardKind;
  value: number;
  item: string;
  itemProductId: string | null;
  qty: number;
  minBill: number | null;
  // CB-5D part 2 — normalised to null when absent, exactly like itemProductId
  // and minBill above: a resolved milestone states every axis explicitly so a
  // consumer never has to distinguish "absent" from "not configured".
  promoCode: string | null;
  claimWithinDays: number | null;
}

export interface LoyaltyLadder {
  milestones: readonly ResolvedMilestone[];
  cycleLength: number;
}

// Re-exported so a caller of this module never needs to also import
// public-diner.ts just to spell the kind enum (do NOT redeclare it here).
export { LOYALTY_REWARD_KINDS };
export type { LoyaltyRewardKind };

// CB-5D part 2 FINAL — the minted-code list a milestone ladder produces,
// SINGLE-HOMED here so `resolvePromoDiscount` (public-promo.ts) and every
// call site that builds its `mintedCodes` argument derive it identically,
// never re-rolling the normalize+dedupe by hand. Takes either raw
// `LoyaltyMilestoneLike` rows (as read straight off Settings) or already-
// `normalizeMilestones`'d `ResolvedMilestone`s — both carry the same
// `promoCode?: string | null` shape, so either works. Normalizes with
// `normalizePromoCode` (the ONE normalization a code goes through) so a
// milestone spelled " save10 " and a promo row "SAVE10" are one code, and
// dedupes since more than one rung may mint the same code. Rows with no
// `promoCode` configured are skipped entirely — most milestones mint nothing.
export function mintedPromoCodes(
  milestones: readonly Pick<LoyaltyMilestoneLike, "promoCode">[] | undefined,
): string[] {
  const seen = new Set<string>();
  for (const m of milestones ?? []) {
    if (!m.promoCode) continue;
    seen.add(normalizePromoCode(m.promoCode));
  }
  return [...seen];
}

/** Sorts ASC by `at`, drops any row whose `at` isn't a finite positive
 *  integer, and — on a duplicate `at` — keeps the FIRST row in the caller's
 *  own order (owner intent: the row they listed first wins). TOTAL: never
 *  throws, never returns NaN in a field, whatever `rows` contains. */
export function normalizeMilestones(rows: readonly LoyaltyMilestoneLike[]): ResolvedMilestone[] {
  const seenAt = new Set<number>();
  const kept: ResolvedMilestone[] = [];
  // Index-stable pass in caller order first, so "keep the first" is decided
  // before the sort below reorders anything.
  rows.forEach((row) => {
    if (!Number.isInteger(row.at) || row.at <= 0) return;
    if (seenAt.has(row.at)) return;
    seenAt.add(row.at);
    kept.push({
      at: row.at,
      kind: row.kind,
      value: row.value,
      item: row.item,
      itemProductId: row.itemProductId ?? null,
      // Absent/null qty normalises to the DEFAULT (1), never 0 — a rung that
      // grants zero dishes is not a reward, and every pre-D11 row is absent.
      // A stored non-integer or <1 value is coerced up for the same reason:
      // normalizeMilestones is TOTAL and never emits a broken field.
      qty:
        Number.isInteger(row.qty) && (row.qty as number) >= LOYALTY_REWARD_QTY_MIN
          ? (row.qty as number)
          : LOYALTY_REWARD_QTY_DEFAULT,
      minBill: row.minBill ?? null,
      // CB-5D part 2 — carried through so the claim path can read them off a
      // ResolvedMilestone. `claimWithinDays` is coerced the same TOTAL way as
      // qty above: a stored non-integer or <1 value is not a window at all, so
      // it normalises to null ("no deadline") rather than emitting a broken
      // number that a date gate would then compare against.
      promoCode: row.promoCode ?? null,
      claimWithinDays:
        Number.isInteger(row.claimWithinDays) && (row.claimWithinDays as number) >= 1
          ? (row.claimWithinDays as number)
          : null,
    });
  });
  return kept.sort((a, b) => a.at - b.at);
}

/** Builds the ladder from raw rows: cycleLength is 0 for an empty ladder
 *  (nothing to cycle), else the LAST milestone's `at`.
 *
 *  `cardSize` (CB-5C) OVERRIDES that derivation — it is the number of boxes the
 *  owner drew on the stamp card, which may sit ABOVE the last reward (a card of
 *  8 whose only rewards are at 3 and 5 still takes 8 stamps to come round).
 *  Threaded through this ONE function on purpose: `cycleLength` is what every
 *  progress number downstream divides by, so a second place deciding it would
 *  be two identity sources for one quantity. Ignored when absent or when it
 *  would sit BELOW the last reward, which would make that reward unreachable —
 *  the stored rows stay authoritative over a stale or corrupt size. */
export function ladderOf(
  rows: readonly LoyaltyMilestoneLike[],
  cardSize?: number | null,
): LoyaltyLadder {
  const milestones = normalizeMilestones(rows);
  // A card with no rewards on it is NOT a cycle, however many boxes the owner
  // drew: with no rung to reach there is nothing to come round to, and letting
  // a bare size through here would have ladderProgress count completedCycles
  // and a cyclePosition for a diner who can never earn anything.
  if (milestones.length === 0) return { milestones, cycleLength: 0 };

  const lastAt = milestones[milestones.length - 1]!.at;
  const sized =
    typeof cardSize === "number" && Number.isFinite(cardSize) && Math.floor(cardSize) >= lastAt
      ? Math.floor(cardSize)
      : 0;
  const cycleLength = sized > 0 ? sized : lastAt;
  return { milestones, cycleLength };
}

export interface LadderProgress {
  cyclePosition: number;
  completedCycles: number;
  nextAt: number | null;
  toNext: number;
  reachedThisCycle: number;
}

/** TOTAL progress math over a ladder: a `cycleLength <= 0` ladder (no
 *  milestones) reports every number as 0 and `nextAt: null` rather than
 *  dividing by zero. Negative or non-finite `stamps` are clamped to 0 first
 *  so a corrupt stored value can never produce NaN downstream. */
export function ladderProgress(stamps: number, ladder: LoyaltyLadder): LadderProgress {
  const safeStamps = Number.isFinite(stamps) && stamps > 0 ? Math.floor(stamps) : 0;

  if (ladder.cycleLength <= 0) {
    return { cyclePosition: 0, completedCycles: 0, nextAt: null, toNext: 0, reachedThisCycle: 0 };
  }

  const cyclePosition = safeStamps % ladder.cycleLength;
  const completedCycles = Math.floor(safeStamps / ladder.cycleLength);
  const reachedThisCycle = ladder.milestones.filter((m) => m.at <= cyclePosition).length;
  const upcoming = ladder.milestones.find((m) => m.at > cyclePosition);
  const nextAt = upcoming ? upcoming.at : null;
  const toNext = upcoming ? upcoming.at - cyclePosition : 0;

  return { cyclePosition, completedCycles, nextAt, toNext, reachedThisCycle };
}
