import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";
import { normalizePromoCode, promoExpiryFrom, type PromoCodeConfig } from "@pos/shared/public-promo";
import type { RewardAssignment } from "@/lib/reward-redemption";

// CB-5D part 2 — the PURE (DB-free) builder that turns a claimed milestone
// into what claimRewardStamps stores. Split out of reward-claim.ts so this
// one small, directly unit-testable function is the ONLY place a milestone's
// `promoCode` gets resolved against the cafe's promo list — reward-claim.ts
// and order-request-accept-reward.ts both just call this and pass the result
// straight through to claimRewardStamps.

/**
 * Build the `RewardAssignment` a claimed rung mints, or `undefined` when it
 * mints nothing.
 *
 * `undefined` covers THREE cases, all deliberately silent (a stale/deleted
 * code must never surface as a claim failure — the stamps were still validly
 * spent on the rung's ordinary benefit):
 *   1. `milestone.promoCode` is null/absent — the overwhelmingly common case,
 *      a rung that mints nothing.
 *   2. the named code is no longer in the cafe's promo list (the owner
 *      deleted it after configuring the milestone).
 *   3. the named code IS present but `active === false` (the owner disabled
 *      it) — an assignment must never hand out a code that cannot be
 *      resolved/used later.
 *
 * Looked up via Array.prototype.find on the NORMALIZED code, never a keyed
 * object lookup — the same prototype-safety `resolvePromoDiscount` documents
 * (a code literally named "constructor" must be judged purely by array
 * membership).
 */
export function buildRewardAssignment(
  milestone: ResolvedMilestone,
  promoCodes: PromoCodeConfig[] | undefined,
  assignedAt: Date,
): RewardAssignment | undefined {
  if (!milestone.promoCode) return undefined;

  const wanted = normalizePromoCode(milestone.promoCode);
  const matched = (promoCodes ?? []).find((c) => c.code === wanted);
  if (!matched || matched.active === false) return undefined;

  const expiresAtMs = promoExpiryFrom(assignedAt.getTime(), matched.validDays);
  return {
    code: wanted,
    at: milestone.at,
    kind: matched.kind,
    assignedAt,
    // Omit-empty: a code with no validDays never expires, so the subdoc
    // carries no `expiresAt` key at all rather than an explicit undefined.
    ...(expiresAtMs === null ? {} : { expiresAt: new Date(expiresAtMs) }),
  };
}
