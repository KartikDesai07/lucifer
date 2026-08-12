import { coreModel } from "@/lib/cluster-router";
import { ledgerContribution } from "@/lib/order";
import cache from "@/lib/cache";
import { type IOrder } from "@/models/order.ledger";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.5 — the idempotent CRM rollup + the recompute AUTHORITY (§2.6).
//
// An order lives on a LEDGER cluster; the Customer projection (visits/totalSpend/
// totalDue) lives on CORE — a DIFFERENT cluster, so they can never share a
// transaction (#14). The contract that replaces atomicity:
//   • the Order is the SOURCE OF TRUTH (already committed when we run);
//   • `applyCustomerRollup` is a BEST-EFFORT projection, made retry-safe by a
//     FILTER-PREDICATE idempotency guard — `{_id, appliedOrders:{$ne:orderId}}`
//     gates the `$inc` so `matchedCount===0` is the no-op (build-rule #60: the
//     guard MUST live in the update FILTER; an `$addToSet` in the same update doc
//     as the `$inc` does NOT make the `$inc` conditional);
//   • `recomputeCustomer` is the AUTHORITY — a from-scratch fan-out sum over the
//     ledgers that heals any drift a lost/duplicated best-effort apply left.
//
// Ownership of `Customer.appliedOrders` (F2 §4 F2.5 vs build-rule #60 / P5-C,
// reconciled 2026-07-02): F2.5 LANDS the field — the spec says so, and this
// module's filter/`$push` would be silently STRIPPED by strict mode without the
// schema path (a vanished guard, not an error). P5 RETAINS `appliedLoyaltyOrders`
// + the `reconcileLedger` rewrite onto this predicate form + the Customer v:2
// paise migration. The writers never collide on the shared array — application
// moments are mutually exclusive per order: an "Unpaid" tab contributes ZERO and
// is NOT marked (contribution + marker land once at settlement); P2-era
// compensating docs (void/refund) carry their OWN orderId, hence their own marker.
//
// UNIT BOUNDARY (the 100× landmine, #13/#45): the stored Order is Int32 PAISE
// (F2c) but the live CORE Customer is still the v1 RUPEE shape (the paise
// migration is P5's Customer v:2), so contributions convert paise→₹ HERE, at the
// CORE write boundary. When P5 lands v:2 this conversion flips with it — do not
// "fix" the division without that migration.
//
// CR1.4 extends this boundary: `duesPaidTotal` (lib/due-payment.ts) reads
// DuePayment — CORE, already RUPEES — so it is subtracted AFTER the ledger's
// paise→₹ division, never before and never in paise. Mixing the two units in
// one expression is the same landmine one field over.
// ─────────────────────────────────────────────────────────────────────────────

/** How many applied orderIds a customer keeps (newest last; `$slice` prunes the
 *  oldest). The horizon only has to outlive duplicate-apply windows — enqueue
 *  retries (seconds) and a held tab's create→settle span — not the customer's
 *  lifetime; `recomputeCustomer` is the safety net past it (F2 §4 F2.5). */
export const APPLIED_ORDERS_MAX = 200;

/** The slice of the stored (paise-shaped) Order the rollup consumes. */
export type RollupOrder = Pick<
  IOrder,
  "_id" | "customerId" | "payment" | "total" | "paidAmount" | "status"
>;

export type RollupApplyResult =
  | { applied: true }
  // no-customer: walk-in order. zero-contribution: a held "Unpaid" tab (nothing
  // to project yet — and NO marker, or settlement's apply would be swallowed).
  // already-applied-or-missing: the predicate no-op and a deleted customer are
  // indistinguishable without a second read; both are safe to ignore (§2.6).
  | {
      applied: false;
      reason: "no-customer" | "zero-contribution" | "already-applied-or-missing";
    };

// ── Injectable DB collaborators (DB-free test seam — the F2.3 pattern) ────────
// The op SHAPE (filter predicate + $inc + bounded $push) is proven DB-free by
// overriding these; production binds Customer on CORE via the router (live
// round-trip: F2's seeded-M0 integration pass).
interface CustomerLedgerWriter {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount: number; modifiedCount: number }>;
}
interface RollupDeps {
  getCustomerWriter: () => Promise<CustomerLedgerWriter>;
  invalidateCustomersCache: () => void;
}
const realDeps: RollupDeps = {
  getCustomerWriter: async () =>
    (await coreModel("Customer")) as unknown as CustomerLedgerWriter,
  invalidateCustomersCache: () => {
    // v1's create route del'd the customers list cache after its inline $inc;
    // the rollup now owns that write, so it owns the invalidation (§9).
    cache.del("customers");
  },
};
let deps: RollupDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores production. */
export function __setCustomerRollupDepsForTests(
  overrides: Partial<RollupDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}
/** CROSS-MODULE SEAM — `customer-recompute.ts`'s AUTHORITY half shares this same
 *  `deps` binding (so `__setCustomerRollupDepsForTests` overrides BOTH halves at
 *  once, as the tests rely on); a function call, not an exported `let`, sidesteps
 *  any live-binding ambiguity across the module split. */
export function getRollupDeps(): RollupDeps {
  return deps;
}

/**
 * Apply one order's contribution to its customer's CORE projection, exactly once
 * per orderId. Retry-safe: the `appliedOrders:{$ne}` FILTER gates the `$inc`, so
 * a re-fire sees the committed marker and no-ops (`matchedCount 0`). Correctness
 * does NOT hang on engine write-conflict internals for a same-instant race —
 * `recomputeCustomer` is the authority either way; the live race is exercised
 * against a seeded M0 in F2's integration pass. Errors PROPAGATE — fire-and-forget
 * (swallow + log) belongs to `customerRollupEnqueuer`, not the unit of work.
 */
export async function applyCustomerRollup(
  order: RollupOrder,
): Promise<RollupApplyResult> {
  if (!order.customerId) return { applied: false, reason: "no-customer" };

  // v1's exact contribution semantics, reused not re-derived: Unpaid → zero (a
  // held tab is neither a sale nor a receivable until settled), else one visit +
  // full total as spend + any unpaid balance as due. Fed paise, returns paise.
  const c = ledgerContribution(order);
  if (!c.visits && !c.spend && !c.due) {
    return { applied: false, reason: "zero-contribution" };
  }

  const writer = await deps.getCustomerWriter();
  const res = await writer.updateOne(
    // THE guard (#60): the predicate makes the whole update conditional.
    { _id: order.customerId, appliedOrders: { $ne: order._id } },
    {
      // paise → v1 rupees at the CORE boundary (see the unit-boundary header).
      $inc: {
        visits: c.visits,
        totalSpend: c.spend / 100,
        totalDue: c.due / 100,
      },
      // Record the marker AFTER the gate. `$push`+`$slice` (not `$addToSet`): the
      // filter already guarantees set-semantics, and `$addToSet` cannot bound the
      // array — `$slice: -N` keeps newest N (F2 §4 F2.5 "capped"; #60 "bounds").
      $push: {
        appliedOrders: { $each: [order._id], $slice: -APPLIED_ORDERS_MAX },
      },
    },
  );

  if (res.matchedCount === 0) {
    return { applied: false, reason: "already-applied-or-missing" };
  }
  deps.invalidateCustomersCache();
  return { applied: true };
}

/**
 * The production enqueuer wired as order-create's default (F2.3's seam): strictly
 * fire-and-forget — a rollup failure is logged and LOST (never fails or delays the
 * committed create; a retry there would duplicate the order). The recompute
 * authority heals whatever this drops.
 */
export function customerRollupEnqueuer(order: IOrder): void {
  void applyCustomerRollup(order).catch((err) => {
    console.error(
      "[customer-rollup] best-effort apply failed (recompute heals):",
      err,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// recomputeCustomer — the AUTHORITY (F2 §2.6 / the P7-D0-F2 CORE analogue) —
// lives in `lib/customer-recompute.ts` (CR1.4 split: this file was already at
// the ~300-line guide before the dues-subtraction fix pushed it further past
// it). Re-exported here so every existing `@/lib/customer-rollup` / relative
// `./customer-rollup` import path keeps resolving unchanged.
// ─────────────────────────────────────────────────────────────────────────────
export {
  recomputeCustomer,
  setReportFanout,
  setDuesPaidTotalFetcher,
  ALL_TIME_FROM,
  ALL_TIME_TO,
  type RecomputedTotals,
  type RecomputeFanoutSpec,
  type ReportFanout,
  type DuesPaidTotalFetcher,
  type RecomputeResult,
} from "./customer-recompute";
