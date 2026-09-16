import { LOYALTY_STAMP_ORDERS_MAX } from "@pos/shared/public-diner";
import { Customer } from "@/models/Customer";
import type { ISettings } from "@/models/Settings";
import { billEarnsStamp, resolveLoyaltyConfig } from "@/lib/diner-loyalty";
import { dinerLoyaltyOn } from "@/lib/diner-route-guard";

// CB-4 — granting ONE stamp for ONE settled bill, exactly once.
//
// This is the WRITE half of the stamp card; lib/diner-loyalty.ts holds the
// pure rules (and stays DB-free so it can be unit-tested without Mongo).
//
// The idempotency mechanism is build-rule #60, the SAME shape
// lib/customer-rollup.ts already uses for visits/totalSpend: the marker lives
// in the update FILTER (`stampOrders: { $ne: orderId }`), which is what makes
// the sibling `$inc` conditional. An `$addToSet` beside the `$inc` does NOT —
// it de-dups the array element while the `$inc` fires anyway, which is a real,
// documented double-credit bug, not a theoretical one.
//
// `stampOrders` is deliberately a DIFFERENT array from `appliedOrders`: that
// one gates the money rollup's own `$inc`, so sharing a single marker array
// would make whichever writer landed first silently cancel the other's guard.

export type StampGrantResult =
  | { granted: true }
  | { granted: false; reason: "loyalty-off" | "no-customer" | "below-min-bill" | "already-stamped" };

/**
 * Best-effort, exactly-once-per-order stamp grant for a settled bill.
 *
 * `billTotal` is in RUPEES — the caller passes the v1 `models/Order.ts` total,
 * which is a plain rupee Number. (The Int32 PAISE shape lives on
 * `models/order.ledger.ts`; the settle route never reads it.) Converting here
 * would make either every bill or no bill qualify.
 *
 * Errors PROPAGATE: the caller decides whether a failed stamp may fail the
 * request. It must not — a settled bill is the source of truth and a missing
 * stamp is a support question, never a reason to reject money that was taken.
 */
export async function grantStampForSettledOrder(
  settings: ISettings | null,
  customerId: string | null | undefined,
  orderId: string,
  billTotal: number,
  now: number = Date.now(),
): Promise<StampGrantResult> {
  if (!dinerLoyaltyOn(settings)) return { granted: false, reason: "loyalty-off" };
  // A walk-in with no Customer row has nothing to stamp. Not an error: most
  // counter bills are exactly this.
  if (!customerId) return { granted: false, reason: "no-customer" };

  const config = resolveLoyaltyConfig(settings);
  if (!billEarnsStamp(billTotal, config)) {
    return { granted: false, reason: "below-min-bill" };
  }

  // CB-5D part 2 — this bill's stamp lands on `stamps + 1`. Read ONLY to
  // compute that candidate key; this read is NOT the guard (the filter
  // below still is) — see the update's own comment for the race this
  // accepts. A customer without a `stamps` field yet is about to earn their
  // first, hence `?? 0`.
  const before = await Customer.findById(customerId).select("stamps").lean();
  const nextCount = (before?.stamps ?? 0) + 1;
  // Only stamp an earn moment when `nextCount` actually IS a configured
  // rung — otherwise this map would grow one key per bill, unbounded.
  const isRung = config.ladder.milestones.some((m) => m.at === nextCount);

  const res = await Customer.updateOne(
    // THE guard (#60): the predicate is what makes the whole update
    // conditional. matchedCount === 0 IS the no-op.
    { _id: customerId, stampOrders: { $ne: orderId } },
    {
      $inc: { stamps: 1, stampsLifetime: 1 },
      // `$push` + `$slice` rather than `$addToSet`: the filter above already
      // gives set semantics, and `$addToSet` cannot BOUND the array. Newest
      // last, oldest pruned — the horizon only has to outlive a duplicate
      // -apply window, not the customer's lifetime.
      $push: { stampOrders: { $each: [orderId], $slice: -LOYALTY_STAMP_ORDERS_MAX } },
      // Rides in the SAME update as the guarded `$inc` above — a second
      // write would need its own guard and this field has none of its own.
      // `nextCount` was computed from a read that happened BEFORE this
      // update runs, so it is a race, not a fence: if a concurrent grant for
      // the same customer lands between that read and this write, the worst
      // case is this timestamp landing against a NEIGHBOURING rung (off by
      // one bill) rather than the one this bill actually reached. That can
      // only ever shift a claim DEADLINE by one bill's worth of time — it
      // can never move money or grant a stamp, because the balance itself
      // (`stamps`) is still fenced by claimRewardStamps's own `$gte` filter.
      ...(isRung ? { $set: { [`rungEarnedAt.${String(nextCount)}`]: new Date(now) } } : {}),
    },
  );

  if (res.matchedCount === 0) return { granted: false, reason: "already-stamped" };
  return { granted: true };
}
