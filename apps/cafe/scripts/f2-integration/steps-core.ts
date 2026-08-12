/**
 * F2 §5 sweep — Steps A–C: seed, K-pool/lazy-socket proofs (boxes 1–2), atomic
 * order-create + per-ledger sequencing + concurrency (box 3), and the
 * idempotent customer-rollup apply ×2 (box 6, first half).
 * Ops CLI harness — console output intentional.
 */
import mongoose, { Types, type Connection, type Model } from "mongoose";
import { ObjectId, type Document } from "mongodb";

import type { PaymentMode } from "@/lib/constants";
import {
  __setConnectionOpenerForTests,
  getConn,
  modelFor,
} from "@/lib/cluster-registry";
import {
  core,
  coreModel,
  ledgerForWrite,
  CLUSTER_REGISTRY_COLLECTION,
  CLUSTER_REGISTRY_ID,
  type StoredClusterRegistry,
} from "@/lib/cluster-router";
import { createOrder, type NewOrderInput } from "@/lib/order-create";
import { applyCustomerRollup } from "@/lib/customer-rollup";
import {
  getOrderModel,
  buildOrderId,
  orderDayOf,
  ORDER_ID_RE,
} from "@/models/order.ledger";
import type { ICustomer } from "@/models/Customer";
import { dropItestDb, itestDb, nextDayKey, poll, type Ctx } from "./util";

/** Stable product ids shared across the pass (rollup counters key on them). */
export const PRODUCTS = {
  p1: new Types.ObjectId(),
  p2: new Types.ObjectId(),
  p3: new Types.ObjectId(),
};

interface Planned {
  total: number; // paise; also the single item's price (qty 1)
  paid: number;
  payment: PaymentMode;
  withCustomer: boolean;
  productId: Types.ObjectId;
}

/** The solo first order (seq 001) + the 10-way concurrent batch (seqs 002–011). */
export const ORDER1: Planned = {
  total: 55_000, paid: 55_000, payment: "Cash", withCustomer: true, productId: PRODUCTS.p1,
};
export const TODAY_BATCH: Planned[] = [
  { total: 30_000, paid: 30_000, payment: "Cash", withCustomer: true, productId: PRODUCTS.p1 },
  { total: 25_000, paid: 25_000, payment: "Cash", withCustomer: true, productId: PRODUCTS.p2 },
  { total: 40_000, paid: 15_000, payment: "Due", withCustomer: true, productId: PRODUCTS.p2 },
  { total: 20_000, paid: 0, payment: "Unpaid", withCustomer: true, productId: PRODUCTS.p3 },
  ...Array.from({ length: 6 }, (): Planned => ({
    total: 12_000, paid: 12_000, payment: "Online", withCustomer: false, productId: PRODUCTS.p3,
  })),
];
/** Expected CORE projection after ORDER1 + TODAY_BATCH (Unpaid contributes zero). */
export const EXPECT_A = { visits: 4, spendPaise: 150_000, duePaise: 25_000 };
export const TODAY_A_GROSS = ORDER1.total + TODAY_BATCH.reduce((s, p) => s + p.total, 0);

export function mkInput(p: Planned, customerId: string): NewOrderInput {
  return {
    ...(p.withCustomer ? { customerId: new Types.ObjectId(customerId) } : {}),
    customerName: p.withCustomer ? "F2 ITest Customer" : "Walk-in",
    items: [{ productId: p.productId, name: "ITest Item", price: p.total, qty: 1 }],
    subtotal: p.total,
    total: p.total,
    paidAmount: p.paid,
    payment: p.payment,
    status: p.payment === "Unpaid" ? "Pending" : "Completed",
    receiver: "itest",
  };
}

const clusterConnMap = (): Map<string, Connection> | undefined =>
  (globalThis as { __clusterConns?: Map<string, Connection> }).__clusterConns;

/** Wrap the REAL `mongoose.createConnection` with open/socket tracking (the
 *  opener stays live — this is instrumentation, not a fake). */
export function installOpenerTap(ctx: Ctx): void {
  __setConnectionOpenerForTests((uri, opts) => {
    ctx.opens.push({ uri, maxPoolSize: opts.maxPoolSize });
    const conn = mongoose.createConnection(uri, opts);
    void conn
      .asPromise()
      .then(() => {
        conn.getClient().on("connectionCreated", () => {
          ctx.sockets.set(uri, (ctx.sockets.get(uri) ?? 0) + 1);
        });
      })
      .catch(() => {
        /* failed dials are asserted where the dead-leg steps expect them */
      });
    return conn;
  });
}

export async function stepSeed(ctx: Ctx): Promise<void> {
  const { report: r, raw } = ctx;
  r.step("A. seed f2itest_* registry + clean slate");
  for (const name of Object.values(ctx.dbs)) await dropItestDb(raw, name);
  const doc: StoredClusterRegistry = {
    _id: CLUSTER_REGISTRY_ID,
    core: { id: "core", uri: ctx.uris.core, tag: "C" },
    ledgers: [
      { id: "itest-la", uri: ctx.uris.la, tag: "A", from: null, to: null, active: true },
    ],
    standby: [{ id: "itest-lb", uri: ctx.uris.lb, tag: "A2", empty: true }],
  };
  await itestDb(raw, ctx.dbs.core)
    .collection(CLUSTER_REGISTRY_COLLECTION)
    .insertOne(doc as unknown as Document);
  r.check("registry doc seeded on f2itest_core (1 active ledger A + standby A2)", true);
}

export async function stepPoolsAndCreates(ctx: Ctx): Promise<void> {
  const { report: r, raw, uris } = ctx;
  r.step("B+C. K-cluster pools, lazy sockets, atomic create + sequencing (boxes 1–3)");
  installOpenerTap(ctx);

  r.check("no pools open before first touch (lazy)", (clusterConnMap()?.size ?? 0) === 0);

  // CORE touch: bind Customer + create the test customer.
  const CustomerM = (await coreModel("Customer")) as unknown as Model<ICustomer>;
  const cust = await CustomerM.create({ name: "F2 ITest Customer", mobile: "9998887001" });
  ctx.customerId = String(cust._id);
  ctx.colls.customers = CustomerM.collection.name;
  r.check(
    "CORE touch opens ONLY the core pool; ledger + standby still zero sockets",
    clusterConnMap()?.size === 1 &&
      ctx.opens.length === 1 &&
      ctx.opens[0].uri === uris.core,
  );
  const m1 = await modelFor(core(), "Customer");
  const m2 = await modelFor(core(), "Customer");
  r.check("second modelFor() reuses the cached model (no recompile)", m1 === m2);

  // Solo create (seq 001), then the 10-way concurrent batch.
  const order1 = await createOrder(mkInput(ORDER1, ctx.customerId));
  ctx.today = orderDayOf(order1._id) ?? "";
  ctx.tomorrow = nextDayKey(ctx.today);
  ctx.orderIdsA.push(order1._id);
  r.check(
    "first create = ORD-A-<today>-001 (active ledger tag + day + seq)",
    order1._id === buildOrderId("A", ctx.today, 1),
    order1._id,
  );
  r.check(
    "create dialed the ACTIVE ledger lazily (pools now: core + itest-la, standby untouched)",
    clusterConnMap()?.size === 2 &&
      ctx.opens.some((o) => o.uri === uris.la) &&
      !ctx.opens.some((o) => o.uri === uris.lb),
  );
  r.check(
    "every pool dialed with maxPoolSize 5 (bounded, <500/cluster by construction)",
    ctx.opens.every((o) => o.maxPoolSize === 5),
  );

  const batch = await Promise.all(
    TODAY_BATCH.map((p) => createOrder(mkInput(p, ctx.customerId))),
  );
  ctx.orderIdsA.push(...batch.map((o) => o._id));
  const seqs = ctx.orderIdsA
    .map((id) => Number(ORDER_ID_RE.exec(id)?.[3]))
    .sort((a, b) => a - b);
  r.check(
    "10 concurrent creates: 11 DISTINCT ids, contiguous seqs 1–11 (no collision)",
    new Set(ctx.orderIdsA).size === 11 && seqs.join(",") === "1,2,3,4,5,6,7,8,9,10,11",
    seqs.join(","),
  );

  // Raw on-server shape checks (the F2c live $type assertion).
  const ledger = await ledgerForWrite();
  const OrderM = getOrderModel(await getConn(ledger));
  ctx.colls.orders = OrderM.collection.name;
  const ordersColl = itestDb(raw, ctx.dbs.la).collection(ctx.colls.orders);
  r.check("all 11 orders persisted on ledger A", (await ordersColl.countDocuments()) === 11);
  const typed = await ordersColl.findOne({
    _id: order1._id as never,
    total: { $type: "int" },
    subtotal: { $type: "int" },
    paidAmount: { $type: "int" },
    v: { $type: "int" },
    "items.0.price": { $type: "int" },
  });
  r.check("money paths are BSON Int32 ON-SERVER ($type:'int')", typed !== null);
  const walkInId = ctx.orderIdsA[ctx.orderIdsA.length - 1];
  const omitted = await ordersColl.findOne({
    _id: walkInId as never,
    customerId: { $exists: false },
    discount: { $exists: false },
    splitCash: { $exists: false },
    frozen: { $exists: false },
  });
  r.check("omit-empty stored shape (walk-in: no customerId/discount/split/frozen)", omitted !== null);

  const counter = await itestDb(raw, ctx.dbs.la)
    .collection("counters")
    .findOne({ _id: `order-${ctx.today}` as never });
  r.check(
    "sequence came from ledger A's OWN Counter (order-<day> seq=11)",
    (counter as { seq?: number } | null)?.seq === 11,
  );

  await Promise.all(
    Array.from({ length: 25 }, () => OrderM.find({}).limit(1).lean()),
  );
  const laSockets = ctx.sockets.get(uris.la) ?? 0;
  r.check(
    "25-way concurrent burst stayed within maxPoolSize (≤5 operational sockets)",
    laSockets <= 5,
    `sockets=${laSockets}`,
  );
  r.check(
    "one pool per cluster (itest-la opened exactly once — concurrent getConn coalesced)",
    ctx.opens.filter((o) => o.uri === uris.la).length === 1,
  );

  // Box 6 first half: the fire-and-forget enqueuer landed each order exactly once.
  const customers = itestDb(raw, ctx.dbs.core).collection(ctx.colls.customers);
  const custFilter = { _id: new ObjectId(ctx.customerId) as never };
  await poll(
    "customer rollup converged (visits=4)",
    async () => (await customers.findOne(custFilter))?.visits === EXPECT_A.visits,
  );
  const snap = await customers.findOne(custFilter);
  r.check(
    "incremental rollup: visits=4, totalSpend=₹1500, totalDue=₹250 (Unpaid contributed ZERO)",
    snap?.visits === EXPECT_A.visits &&
      snap?.totalSpend === EXPECT_A.spendPaise / 100 &&
      snap?.totalDue === EXPECT_A.duePaise / 100,
    JSON.stringify({ v: snap?.visits, s: snap?.totalSpend, d: snap?.totalDue }),
  );
  const applied = (snap?.appliedOrders ?? []) as string[];
  const unpaidId = batch.find((o) => o.payment === "Unpaid")?._id ?? "";
  r.check(
    "appliedOrders marks the 4 contributing orders — NOT the held Unpaid tab",
    applied.length === 4 && !applied.includes(unpaidId),
  );

  const again = await applyCustomerRollup({
    _id: order1._id,
    customerId: new Types.ObjectId(ctx.customerId),
    payment: "Cash",
    total: ORDER1.total,
    paidAmount: ORDER1.paid,
    status: "Completed",
  });
  const after = await customers.findOne(custFilter);
  r.check(
    "applying the SAME orderId twice increments ONCE (predicate no-op)",
    again.applied === false &&
      again.reason === "already-applied-or-missing" &&
      after?.visits === EXPECT_A.visits &&
      after?.totalSpend === EXPECT_A.spendPaise / 100,
  );
  const unpaidAgain = await applyCustomerRollup({
    _id: unpaidId,
    customerId: new Types.ObjectId(ctx.customerId),
    payment: "Unpaid",
    total: 20_000,
    paidAmount: 0,
    status: "Pending", // a held Unpaid tab is still Pending (steps-core's own mapping)
  });
  r.check(
    "held Unpaid tab re-apply → zero-contribution (unmarked, settle-time apply not swallowed)",
    unpaidAgain.applied === false && unpaidAgain.reason === "zero-contribution",
  );
}
