import { Customer, type IAssignedReward } from "@/models/Customer";
import { isAssignedRewardExpired, PROMO_EXPIRED, canonicalPromoMobile } from "@pos/shared/public-promo";

// CB-5D part 2 DEFECT FIX — an ASSIGNED reward code's `validDays` expiry was
// stored (Customer.rewards[].expiresAt, models/Customer.ts) and DISPLAYED
// (app/api/public/diner/me/route.ts's dinerRewardOf filter) but never
// ENFORCED: none of the three promo-resolution paths (resolveRequestPromo,
// resolveEditPromo, resolveAcceptPromo) ever reads Customer.rewards, so a
// diner who kept an expired code from the "my rewards" list could still type
// it into the free-text promo box and have it apply at full value. This is
// the SINGLE-HOMED money gate all three call — three copies of this predicate
// is the reciprocal-guard failure this repo has already paid for.
//
// SINGLE-HOMED ON PURPOSE, mirroring promoIsClaimable's own comment
// (order-request-accept-promo.ts): quote time (create/edit) and accept time
// both need the exact same answer, or a code refused at quote could slip
// through at accept (or vice versa) purely because two copies drifted apart.
//
// DEFAULT (load-bearing): a code with NO matching assigned-reward row is an
// ORDINARY Settings promo code — never assigned to anyone, never carrying an
// expiry — and this gate must not touch it. Only a code that was actually
// ASSIGNED (claimed via a milestone) carries an `expiresAt`, and only THAT
// code can ever be refused here.

/** Pure predicate half: given the (possibly absent) rewards already loaded
 *  for a customer, decide whether `code` is refused for having expired.
 *  Split out from the DB lookup below so the decision itself is unit-testable
 *  without touching Mongo — the same pure/thin-glue split
 *  resolveAcceptPromo/resolvePromoDiscount already use.
 *
 *  MULTIPLE MATCHES (a diner holding two grants of the same code, in
 *  principle): usable if ANY matching entry is unexpired — an older grant
 *  having lapsed must never refuse a newer, still-live one. */
export function assignedRewardRefusalOf(
  rewards: Pick<IAssignedReward, "code" | "expiresAt">[] | undefined,
  code: string,
  now: number,
): string | undefined {
  const matches = (rewards ?? []).filter((r) => r.code === code);
  if (matches.length === 0) return undefined;
  const anyUnexpired = matches.some(
    (r) => !isAssignedRewardExpired(r.expiresAt?.getTime(), now),
  );
  return anyUnexpired ? undefined : PROMO_EXPIRED;
}

// The DB-touching half. `Customer.mobile` is stored AS TYPED (unlike
// PromoRedemption.mobile, which is canonical), so it cannot be queried by the
// canonical form directly — the fix for that is to widen the CANDIDATES and
// then decide identity canonically, never to canonicalise the filter itself.
export async function assignedRewardRefusal(
  code: string,
  mobile: string,
  now: number,
): Promise<string | undefined> {
  // CB-5D part 2 DEFECT FIX (review-found, live-probed) — match ANY SPELLING
  // of this human's number, not just the one they typed.
  //
  // The earlier exact-match lookup was an EXPIRY BYPASS. `Customer.mobile` is
  // stored as-typed and `normalizePublicMobile` deliberately keeps a leading
  // `+`/`0`, so a diner holding an EXPIRED assigned code simply typed
  // `+919876543210` instead of `9876543210`: `findOne` matched nothing, the
  // `!customer` arm read that as "an ordinary Settings code, allow", and the
  // dead code applied at full value. Probed against real mongod — refused as
  // `9876543210`, ALLOWED as `+91…` and as `0…`.
  //
  // The `!customer` default is still load-bearing and still correct for a
  // genuine walk-in; it just must not also swallow "same human, different
  // spelling". So the CANDIDATES are widened (the stored value cannot be
  // canonicalised in place — that is what the old pin correctly observed),
  // and the canonical form is what decides which rows are really this person.
  // Same identity rule as the PromoRedemption fence and as
  // order-request-reward.ts's own reward binding: compare canonically.
  const canonical = canonicalPromoMobile(mobile);
  // Indexed: `mobile` is unique, so each arm of the $in is an index hit.
  const rows = await Customer.find({ $or: [{ mobile }, { mobile: canonical }, { mobile: `+91${canonical}` }, { mobile: `0${canonical}` }] })
    .select("mobile rewards")
    .lean();
  const mine = rows.filter((r) => canonicalPromoMobile(r.mobile) === canonical);
  if (mine.length === 0) return undefined;
  // A human split across two rows (both spellings stored separately) holds one
  // inventory between them — an expired grant on EITHER row must still refuse,
  // so the rewards are judged as one pooled list rather than per row.
  return assignedRewardRefusalOf(mine.flatMap((r) => r.rewards ?? []), code, now);
}

// CB-5D part 2 (owner decision) — mark an ASSIGNED code as SPENT once the
// order carrying it has actually landed. Best-effort and post-write, the same
// contract as backfillPromoRedemptionOrderId, which every call site invokes
// alongside this one: the MONEY fence is PromoRedemption's unique {code,
// mobile} index, claimed BEFORE the write, so a failure here can never let a
// code be spent twice — it only leaves a spent code sitting in the diner's
// "my rewards" list until someone looks. Never blocking, never a reason to
// undo an order that already exists (never-revert-on-write-throw).
//
// Positional `rewards.$` on the FIRST unspent matching element, not
// `arrayFilters`: a diner holding two grants of one code must have exactly
// ONE of them consumed per order, and `$` updates a single matched element.
// The `usedAt: {$exists: false}` half of the filter is what makes this
// idempotent — a retry of the same order finds that element already marked
// and either moves to the other grant or matches nothing, rather than
// re-stamping a new date over a spend that already happened.
export async function markAssignedRewardUsed(
  code: string,
  mobile: string,
  orderId: string,
  usedAt: Date,
): Promise<void> {
  // Mobile matched by ANY SPELLING, for the same reason assignedRewardRefusal
  // above does: an exact-match filter silently matched NOTHING when the diner
  // typed `+91…` while their Customer row held the bare number, leaving a
  // spent code sitting in their "my rewards" list forever. Not a double-spend
  // (the PromoRedemption fence is canonical and holds regardless), but the
  // list would keep offering a code that always 409s.
  const canonical = canonicalPromoMobile(mobile);
  try {
    await Customer.updateOne(
      {
        $or: [{ mobile }, { mobile: canonical }, { mobile: `+91${canonical}` }, { mobile: `0${canonical}` }],
        rewards: { $elemMatch: { code, usedAt: { $exists: false } } },
      },
      { $set: { "rewards.$.usedAt": usedAt, "rewards.$.orderId": orderId } },
    );
  } catch {
    /* best-effort — see comment above */
  }
}

// CB-5D part 2 DEFECT FIX — the CANCEL path's half of the reversal.
//
// `returnRewardStamps` pulls the EXACT element it was handed (matched on
// `assignedAt`, which the claim supplied). The cancel route cannot do that:
// the Order stores `rewardAt`/`rewardStamps` but never the assignment's
// `assignedAt`, so there is nothing precise to match on. It matches instead
// on the RUNG plus "not yet spent", which is the strongest identifier that
// survives in stored state.
//
// Consequences, stated plainly rather than hidden:
//  - `usedAt: {$exists:false}` keeps a SPENT code untouched — its fence row
//    stays burned, and erasing the row would only destroy the audit trail.
//  - if a diner somehow holds TWO unspent grants of the same rung, this pulls
//    the first. That is the correct direction (a cancel must give back at
//    most one), and the pair can only exist because a prior cancel already
//    failed to pull — i.e. it self-heals rather than compounds.
// Best-effort and swallowed, matching the cancel route's own discipline: the
// cancel is already committed and the operator has been told it worked.
export async function releaseAssignedRewardForRung(
  customerId: string,
  at: number,
): Promise<void> {
  try {
    await Customer.updateOne(
      { _id: customerId },
      { $pull: { rewards: { at, usedAt: { $exists: false } } } },
    );
  } catch {
    /* best-effort — see comment above */
  }
}
