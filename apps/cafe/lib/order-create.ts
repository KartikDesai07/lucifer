import { type Connection, type Model } from "mongoose";

import { ledgerForWrite } from "@/lib/cluster-router";
import { getConn } from "@/lib/cluster-registry";
import { customerRollupEnqueuer } from "@/lib/customer-rollup";
import { nextOrderSequence, nextSlipSequence, type SlipSeries } from "@/models/Counter";
import { printedSlipNumber } from "@/lib/print";
import { getOrderModel, buildOrderId, type IOrder } from "@/models/order.ledger";
import { cafeDateString } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.3 — the cluster-scoped order-create service (the hot path).
//
// This is the ONE place a new order is minted across the federation. It composes
// the F2.1 registry + the F2.2 router + F2c's canonical Order model + the (now
// connection-aware) atomic Counter into the single guarantee F2 promises: an order
// is created ATOMICALLY ON EXACTLY ONE cluster — the active LEDGER — carrying
// `ORD-<activeLedgerTag>-YYYYMMDD-NNN` (#5), its sequence drawn from that ledger's
// OWN co-located Counter (#4, no cross-cluster coordination), so a later read-by-id
// is targetable to that one cluster via the tag (never scatter-gather).
//
// Boundary — what this service deliberately is NOT (held to P2 #44/#45):
//   • It does NOT compute money / derive payment / snapshot GST. The caller (P2's
//     create-route rewrite) feeds an already-validated, paise-encoded, omit-empty
//     payload (the shared codec's `encodeOrderForWrite` output + status/lifecycle).
//   • It does NOT do the F4 exactly-once dedupe. F4 §3 COMPOSES with this create
//     (findOne({idemKey}) → claim-seq → create), wrapping this service (#34).
//   • The CRM rollup (F2.5, `lib/customer-rollup.ts`) is best-effort: the order
//     is the source of truth and the Customer projection cannot share a
//     transaction with the ledger write (it lives on CORE — a different cluster,
//     #14/§2.6), so it is eventually-consistent with `recomputeCustomer` as the
//     authority. The real enqueuer is the default here; the seam remains for tests.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The stored Order payload MINUS the two fields this service generates: `_id` (the
 * orderId, stamped from the active ledger tag + cafe-day + atomic sequence) and the
 * schema-version `v` (defaulted by the model, #10). The caller supplies everything
 * else already in stored shape — Int32 paise, omit-empty optionals, ObjectId-
 * castable id strings — plus the lifecycle fields (`status`, etc.).
 */
export type NewOrderInput = Omit<IOrder, "_id" | "v">;

// ── CRM rollup seam (WIRED by F2.5; default = the real enqueuer) ──────────────
/** Best-effort, idempotent Customer projection enqueued after a successful create. */
export type CustomerRollupEnqueuer = (order: IOrder) => void;
let enqueueCustomerRollup: CustomerRollupEnqueuer = customerRollupEnqueuer;
/** Override the enqueuer (tests install a no-op/spy for isolation); `null`
 *  restores the F2.5 production default (`customerRollupEnqueuer`). */
export function setCustomerRollupEnqueuer(fn: CustomerRollupEnqueuer | null): void {
  enqueueCustomerRollup = fn ?? customerRollupEnqueuer;
}

// ── Injectable DB collaborators (DB-free test seam) ───────────────────────────
// The create COMPOSITION (resolve active ledger → dial its pool → stamp tag/day/seq
// → atomic create on ONE cluster → enqueue rollup) is proven DB-free by overriding
// these; production wires the real counter + Order model. The live socket round-trip
// + the atomic-$inc concurrency guarantee are asserted against a seeded M0 in F2's
// integration pass (the static-now / live-later split used across F2). `ledgerForWrite`
// + `getConn` stay direct so the test exercises the REAL router resolution and proves
// the create dialed the ACTIVE ledger's pool (via the registry's fake opener).
interface CreateDeps {
  now: () => Date;
  nextOrderSequence: (conn: Connection, date: Date) => Promise<number>;
  nextSlipSequence: (
    series: SlipSeries,
    conn: Connection,
    date: Date,
  ) => Promise<number>;
  getOrderModel: (conn: Connection) => Model<IOrder>;
}
const realDeps: CreateDeps = {
  now: () => new Date(),
  nextOrderSequence: (conn, date) => nextOrderSequence(conn, date),
  nextSlipSequence: (series, conn, date) => nextSlipSequence(series, conn, date),
  getOrderModel,
};
let deps: CreateDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores production. */
export function __setOrderCreateDepsForTests(
  overrides: Partial<CreateDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

/**
 * Create one order on the active LEDGER cluster. Atomic on exactly one cluster;
 * returns the stored order (paise/ObjectId shape — the caller decodes for the
 * client). Throws if there is no single active ledger (corrupt manifest) or the
 * create itself fails (e.g. a duplicate `_id` on an F4 idemKey replay) — the route
 * handles those. A rollup-enqueue failure NEVER fails the committed create.
 */
// Which printed slips this create should allocate a number for. The cafe's
// configured starting numbers live in Settings on CORE, which the ROUTE has
// already read; the counters live on the LEDGER, which only this function can
// reach. So the decision comes in and the allocation happens here.
//
// Omitting a series means "do not number it": the cafe has slip numbering
// switched off, or — for `bill` — this order is an open tab and no bill has
// been issued yet, so it must not burn a number out of the day's series.
export interface SlipNumbering {
  kot?: { start: number };
  bill?: { start: number };
}

export async function createOrder(
  input: NewOrderInput,
  slips: SlipNumbering = {},
): Promise<IOrder> {
  // Resolve the active write-ledger ONCE: the tag stamped into the orderId and the
  // connection the order + counter are written to MUST be the same ledger. A second
  // `ledgerForWrite()` could disagree across a 30s-TTL roll-forward (#18).
  const ledger = await ledgerForWrite();
  const conn = await getConn(ledger);

  // ONE `new Date()` feeds BOTH the counter day-key and the orderId's YYYYMMDD, so a
  // create straddling IST midnight can't bank the sequence under one cafe-day while
  // stamping the other day into the id.
  const now = deps.now();
  const yyyymmdd = cafeDateString(now).replace(/-/g, "");

  // Atomic per-ledger, per-cafe-day sequence ($inc on the active ledger's OWN
  // Counter — no read-then-write race, no cross-cluster coordination, #4).
  const seq = await deps.nextOrderSequence(conn, now);
  const orderId = buildOrderId(ledger.tag, yyyymmdd, seq);

  // Printed-slip numbers, on the SAME connection and the SAME `now` as the order
  // sequence above — so a create straddling IST midnight files all three series
  // under one cafe-day. Each is a separate atomic $inc; the cafe's configured
  // start is folded in HERE and the resolved figure is what gets stored, so a
  // reprint always reproduces the paper the customer was handed.
  // The opening items are round 1, hence a single-element array.
  const kotNumbers = slips.kot
    ? [
        printedSlipNumber(
          await deps.nextSlipSequence("kot", conn, now),
          slips.kot.start,
        ),
      ]
    : undefined;
  const billNumber = slips.bill
    ? printedSlipNumber(
        await deps.nextSlipSequence("bill", conn, now),
        slips.bill.start,
      )
    : undefined;

  // Atomic create on exactly ONE cluster (the active ledger). orderId IS the `_id`
  // (#5); the model defaults `v` (#10) and `status`.
  const OrderModel = deps.getOrderModel(conn);
  const created = await OrderModel.create({
    ...input,
    _id: orderId,
    ...(kotNumbers ? { kotNumbers } : {}),
    ...(billNumber !== undefined ? { billNumber } : {}),
  });
  const order = created.toObject() as IOrder;

  // Best-effort, idempotent CRM projection on CORE (§2.6). Fire-and-forget: the
  // order is already the source of truth, so a rollup failure must NEVER fail the
  // create (a retry would duplicate the order); the nightly recompute is the
  // authority. The try/catch guards a synchronous throw — F2.5's real enqueuer owns
  // its own async error handling.
  try {
    enqueueCustomerRollup(order);
  } catch (err) {
    console.error("[order-create] customer rollup enqueue failed (best-effort):", err);
  }

  return order;
}
