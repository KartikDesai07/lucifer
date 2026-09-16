import { Customer } from "@/models/Customer";
import { redemptionSnapshotOf, type RedeemedReward } from "@pos/shared/reward-redemption";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-5B S3 — the redemption WRITE half of the stamp card (S1's
// packages/shared/src/reward-redemption.ts holds the pure snapshot shape;
// lib/diner-loyalty-earn.ts is this module's earn-side sibling and states
// the same idempotency mechanism this file mirrors). Split into a pure
// decision function (DB-free, directly unit-testable) plus the two Mongo
// writers, the same shape as lib/order-request-accept-promo.ts's
// claim/release pair.

export type DecideRedemptionResult =
  | { ok: true; cost: number; reward: RedeemedReward }
  | { ok: false; reason: "no-milestone" | "insufficient-stamps" | "below-min-bill" };

/**
 * PURE decision: given a diner's current stamp balance, a resolved milestone
 * (or none), and the bill total in RUPEES, decide whether a redemption may
 * proceed and at what cost. No DB, no Mongoose — unit-testable without Mongo.
 *
 * D5 REVERSAL (2026-09-13): the owner reversed D5/A1 — `kind:"item"` IS
 * redeemable through this path now (a free dish becomes a priced-but-
 * untotalled bill line, S12), so there is no longer a kind-based rejection
 * here. `packages/shared/src/reward-redemption.ts` still EXPORTS
 * `isRedeemableRewardKind` (CB-7 is already scoped to reintroduce a narrower
 * redeemability axis for product/category-scoped rewards) — this decision
 * simply does not consult it any more.
 *
 * Check ORDER (most specific/actionable reason first):
 *   1. no milestone at all -> "no-milestone" (nothing to redeem).
 *   2. insufficient balance -> "insufficient-stamps" (the diner's own
 *      constraint, checked before the bill's) — this now ALSO gates item
 *      rungs: an item rung with too few stamps reads "insufficient-stamps",
 *      not silently invisible as it was pre-reversal.
 *   3. bill too small for this milestone's own minBill gate ->
 *      "below-min-bill" (a per-milestone CB-5A gate, evaluated last because
 *      it depends on what the STAFF/diner is currently ordering, not the
 *      diner's account state).
 */
export function decideRedemption(
  stamps: number,
  milestone: ResolvedMilestone | undefined,
  billTotal: number,
): DecideRedemptionResult {
  if (!milestone) return { ok: false, reason: "no-milestone" };

  const cost = milestone.at;
  if (stamps < cost) return { ok: false, reason: "insufficient-stamps" };
  if (milestone.minBill != null && billTotal < milestone.minBill) {
    return { ok: false, reason: "below-min-bill" };
  }

  return { ok: true, cost, reward: redemptionSnapshotOf(milestone) };
}

/**
 * Spend `cost` stamps against `customerId` for `orderId`, exactly once.
 * Returns true iff THIS call did the spending.
 *
 * The `stamps: {$gte: cost}` term lives in the FILTER, never a JS
 * read-then-write — that is what makes the balance check atomic against a
 * concurrent redemption from another device racing the same customer.
 * `matchedCount === 0` IS the no-op (build-rule #60, same shape
 * grantStampForSettledOrder uses for stampOrders).
 *
 * `$push` + `$slice`, never `$addToSet`: the filter's `redeemedOrders:
 * {$ne: orderId}` already gives set semantics, and pairing `$addToSet` with
 * a sibling `$inc` is the documented double-credit bug (diner-loyalty-earn
 * .ts) — `$addToSet` de-dups the array element while the `$inc` still fires
 * on a retried call. `stampsLifetime` is never touched here: it counts
 * stamps EARNED, and a redemption is a spend, not an un-earn.
 *
 * Errors PROPAGATE — the caller decides whether a failed claim may fail the
 * request (mirrors grantStampForSettledOrder's own contract). Unlike the
 * earn side, a redemption changes the bill BEFORE money is taken, so most
 * callers will choose to fail closed on a false/thrown result rather than
 * treat it as best-effort.
 */
/** CB-5D — what a claim HANDS the diner, when the claimed rung mints a promo
 *  code. Built by the caller from the milestone's own `promoCode` plus the
 *  code's configured `validDays`, so this writer never re-reads Settings and
 *  never re-derives an expiry: it stores exactly what it was given.
 *
 *  Passed INTO claimRewardStamps rather than written by a second call on
 *  purpose. The stamp debit and the assignment have to land in ONE update:
 *  two writes would let a crash between them take the stamps and hand back
 *  nothing (or, reversed, hand out a code nobody paid for), and there are FOUR
 *  call sites that would each have to get that sequencing right. */
export interface RewardAssignment {
  code: string; // the Settings promo code this rung mints, already normalized
  at: number; // WHICH rung earned it — the milestone's stamp count
  kind: string; // the promo kind snapshotted at assignment
  assignedAt: Date;
  expiresAt?: Date; // absent = never expires (the code carried no validDays)
}

export async function claimRewardStamps(
  customerId: string,
  orderId: string,
  cost: number,
  // OPTIONAL so the three non-minting call sites are unchanged — a rung with
  // no promoCode assigns nothing and this writer behaves exactly as before.
  assignment?: RewardAssignment,
): Promise<boolean> {
  const res = await Customer.updateOne(
    {
      _id: customerId,
      stamps: { $gte: cost },
      // "Never spent for this order, OR spent and since RETURNED." The second
      // arm is load-bearing, not defensive: a claim whose write then lost its
      // CAS returns the stamps but leaves the orderId in `redeemedOrders`, so
      // a bare `{$ne: orderId}` refuses the operator's retry of that very
      // order forever — live-probed: balance correctly back at 20, retry of
      // the same orderId returns false, and the counter reads "Not enough
      // stamps" at a full card. The reciprocal-guard rule cuts both ways:
      // an array that fences a writer must be cleared by its counterpart.
      $or: [{ redeemedOrders: { $ne: orderId } }, { returnedOrders: orderId }],
    },
    {
      $inc: { stamps: -cost },
      // `$addToSet`, not `$push` + `$slice`, ONLY because the $or above admits
      // an orderId that may ALREADY sit in this array (the returned case), and
      // Mongo rejects `$pull` and `$push` on one path in a single update —
      // live-probed: "Updating the path 'redeemedOrders' would create a
      // conflict at 'redeemedOrders'". So de-duping moves into the operator
      // itself. This does NOT reintroduce the $addToSet double-credit bug
      // (diner-loyalty-earn.ts:61): there the array's uniqueness was the only
      // thing fencing a sibling $inc, whereas here the FILTER ($or +
      // returnedOrders) is the fence and it is evaluated before any write.
      // COST, stated plainly: $addToSet cannot carry $slice, so this array is
      // no longer bounded at LOYALTY_STAMP_ORDERS_MAX. It grows by one entry
      // per REDEEMED order (far rarer than the earn side's every-bill push),
      // and a re-claim adds nothing. Bounding it needs a second write, which
      // would not be atomic with this one — booked as debt rather than traded
      // for a race on the money path.
      $addToSet: {
        redeemedOrders: orderId,
        // CB-5D — the assigned code rides in the SAME update as the debit, so
        // a diner can never be charged stamps without receiving the code (or
        // handed a code without paying for it). $addToSet, matching its
        // sibling above: the $or filter admits a RETRY of this same order, and
        // on that retry the identical element must not be appended twice.
        // Element equality is whole-document here, so `assignedAt` is supplied
        // by the CALLER (never re-stamped per attempt) — a fresh Date on a
        // retry would make the element unequal and duplicate the reward.
        ...(assignment ? { rewards: assignment } : {}),
      },
      // Clear the returned marker as we re-spend, so this order is back to
      // "spent, not returned" — exactly the state returnRewardStamps requires
      // to fire once more if THIS attempt also loses its race. Different path
      // from the $addToSet above, so the two coexist in one update.
      $pull: { returnedOrders: orderId },
    },
  );
  return res.matchedCount > 0;
}

/**
 * Compensating release: refund `cost` stamps for a redemption that landed
 * but must now be reversed (cancel). Returns true iff THIS call refunded.
 *
 * Filter requires `redeemedOrders: orderId` (a return may only fire against
 * a spend that actually landed) AND `returnedOrders: {$ne: orderId}` (at most
 * once) — the same reciprocal-guard discipline as the claim above, on the
 * SECOND marker array.
 *
 * Permitted only after a DEFINITE no-order/cancelled outcome — the
 * `releasePromoRedemption` discipline (order-request-accept-promo.ts): never
 * called on a bare throw (never-revert-on-write-throw). The caller must have
 * already confirmed the order is genuinely gone/cancelled before calling
 * this, not inferred it from an exception.
 */
export async function returnRewardStamps(
  customerId: string,
  orderId: string,
  cost: number,
  // CB-5D part 2 DEFECT FIX (review-found, live-probed): the assignment the
  // matching claim handed out, so this compensation can take it BACK.
  //
  // Without it the reversal was ASYMMETRIC and repeatably exploitable: the
  // claim debited stamps AND minted a code in one update, while the return
  // refunded only the stamps. Probed against real mongod — claim 8 stamps ->
  // stamps 0, rewards 1; cancel -> stamps 8, rewards STILL 1. The customer
  // ends with both the stamps and a live code, and can repeat it by
  // cancelling again (a re-claim then appends a SECOND grant, since its
  // `assignedAt` differs). Whatever a claim writes, its compensation must
  // unwrite.
  //
  // OPTIONAL, mirroring claimRewardStamps's own 4th parameter: a rung that
  // minted nothing returns nothing, and the three non-minting call sites are
  // unchanged.
  assignment?: RewardAssignment,
): Promise<boolean> {
  const res = await Customer.updateOne(
    { _id: customerId, redeemedOrders: orderId, returnedOrders: { $ne: orderId } },
    {
      $inc: { stamps: cost },
      // Pull back the EXACT element the claim added. Matched on the whole
      // identifying tuple including `assignedAt` — which is caller-supplied
      // and stable across a retry (the same property that makes $addToSet
      // de-dupe on the claim side), so this can only ever remove the grant
      // THIS order paid for, never an older grant of the same code the diner
      // still legitimately holds.
      //
      // `usedAt: {$exists: false}` is load-bearing: a code already SPENT must
      // NOT be silently removed from the customer's history by a later
      // cancel. Its PromoRedemption fence row stays burned either way (this
      // array is display, never authority), so pulling a spent grant would
      // only erase the audit trail of something that really happened.
      ...(assignment
        ? {
            $pull: {
              rewards: {
                code: assignment.code,
                at: assignment.at,
                assignedAt: assignment.assignedAt,
                usedAt: { $exists: false },
              },
            },
          }
        : {}),
      // $push, never $addToSet (the documented double-credit shape) — and
      // deliberately UNBOUNDED, no $slice.
      //
      // This array is this function's ONLY guard: the filter above has no
      // re-entry arm, so `returnedOrders: {$ne: orderId}` is the single thing
      // standing between a diner and a second refund. A $slice cap made that
      // guard FORGET, while its partner `redeemedOrders` (uncapped since the
      // claim side moved to $addToSet) remembers forever — so once an orderId
      // aged out of the capped array, BOTH filter terms passed again and a
      // second refund fired, minting stamps nobody spent. Live-probed against
      // real mongod: at $slice:-200, the 201st distinct return evicts ORD-1,
      // after which a repeat return of ORD-1 matches and credits +8.
      //
      // The two arrays are a matched pair and must have the SAME memory. The
      // growth is bounded in practice by how often a redemption is cancelled
      // (far rarer than the earn side's every-bill push), which is the same
      // trade already accepted and booked for redeemedOrders.
      $push: { returnedOrders: orderId },
    },
  );
  return res.matchedCount > 0;
}
