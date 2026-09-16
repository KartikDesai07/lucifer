/**
 * F2 §5 sweep — Steps F–G: the forced ≥70% roll-forward (box 7) and the
 * multi-month fan-out + honest-partial legs (box 5). The stats gauge is the
 * FORCED input (that is what "forcing to ≥70%" means); registry read, CAS
 * flip write, standby ping and every order/doc byte are live M0.
 * Ops CLI harness — console output intentional.
 */
import { Types } from "mongoose";
import { ObjectId } from "mongodb";

import { disconnectAll, getConn } from "@/lib/cluster-registry";
import {
  __resetRouterForTests,
  CLUSTER_REGISTRY_COLLECTION,
  ledgerForWrite,
  ledgersForDate,
  type LedgerRef,
} from "@/lib/cluster-router";
import { createOrder } from "@/lib/order-create";
import { orderIdDayRange } from "@/lib/order-read";
import { readOrdersInDayRangeMerged, reportFanout, type ReportFanoutSpec } from "@/lib/report-fanout";
import { recomputeCustomer } from "@/lib/customer-rollup";
import { scaleCheck, __setScaleDepsForTests } from "@/lib/ledger-scale";
import { M0_QUOTA_BYTES } from "@/lib/ledger-scale-plan";
import { buildOrderId, getOrderModel } from "@/models/order.ledger";
import { itestDb, poll, type Ctx } from "./util";
import { EXPECT_A, PRODUCTS, TODAY_A_GROSS, mkInput } from "./steps-core";

const dayKey = (s: string | null | undefined): string => (s ?? "").replace(/-/g, "");

/** Historical walk-ins inserted directly on ledger A (read-path fixtures). */
export const HIST: Array<{ day: string; total: number; productId: Types.ObjectId }> = [
  { day: "20260401", total: 11_000, productId: PRODUCTS.p1 },
  { day: "20260401", total: 9_000, productId: PRODUCTS.p2 },
  { day: "20260501", total: 8_000, productId: PRODUCTS.p1 },
  { day: "20260501", total: 7_000, productId: PRODUCTS.p3 },
  { day: "20260501", total: 6_000, productId: PRODUCTS.p3 },
  { day: "20260615", total: 5_000, productId: PRODUCTS.p2 },
  { day: "20260615", total: 4_000, productId: PRODUCTS.p1 },
];
export const HIST_GROSS = HIST.reduce((s, h) => s + h.total, 0);
export const A2_ORDER_TOTAL = 10_000; // ×2 customer Cash creates post-flip

const sumSpec = (lo: string, hi: string): ReportFanoutSpec<"sum"> => ({
  collection: "Order",
  merge: "sum",
  pipeline: (L: LedgerRef) =>
    [
      { $match: { _id: orderIdDayRange(L.tag, lo, hi) } },
      { $group: { _id: null, revenue: { $sum: "$total" }, n: { $sum: 1 } } },
    ] as never,
});

export async function stepFlip(ctx: Ctx): Promise<void> {
  const { report: r, raw } = ctx;
  r.step("F. forced ≥70% flip: contiguous windows, NO data moved (box 7)");

  // Historical fixtures land on A before it retires.
  const active = await ledgerForWrite();
  const OrderA = getOrderModel(await getConn(active));
  const perDay = new Map<string, number>();
  for (const h of HIST) {
    const seq = (perDay.get(h.day) ?? 0) + 1;
    perDay.set(h.day, seq);
    await OrderA.create({
      _id: buildOrderId("A", h.day, seq),
      customerName: "Walk-in",
      items: [{ productId: h.productId, name: "ITest Item", price: h.total, qty: 1 }],
      subtotal: h.total,
      total: h.total,
      paidAmount: h.total,
      payment: "Online",
      status: "Completed",
      receiver: "itest",
    });
  }
  const ordersA = itestDb(raw, ctx.dbs.la).collection(ctx.colls.orders);
  const idsBefore = (await ordersA.find({}).project({ _id: 1 }).toArray())
    .map((d) => String(d._id))
    .sort();
  r.check("18 orders on ledger A pre-flip (11 today + 7 historical)", idsBefore.length === 18);

  // Live gauge first: real db.stats drives an 'ok' verdict + a stats-only write.
  const regColl = itestDb(raw, ctx.dbs.core).collection(CLUSTER_REGISTRY_COLLECTION);
  const first = await scaleCheck();
  r.check("real-gauge scaleCheck → 'ok' (tiny fill, no bootstrap)", first.status === "ok" && !first.bootstrap);
  const stamped = (await regColl.findOne({})) as {
    ledgers: Array<{ tag: string; fillPct?: number; sizeBytes?: number }>;
  } | null;
  r.check(
    "live db.stats persisted onto the manifest (fillPct + sizeBytes > 0)",
    typeof stamped?.ledgers[0]?.fillPct === "number" && (stamped?.ledgers[0]?.sizeBytes ?? 0) > 0,
    JSON.stringify(stamped?.ledgers[0]?.sizeBytes),
  );

  // Force the gauge ≥70%; everything else (doc read, ping, CAS write) stays live.
  __setScaleDepsForTests({
    readStats: async () => ({ dataSize: Math.ceil(M0_QUOTA_BYTES * 0.72), indexSize: 0 }),
  });
  const flipped = await scaleCheck();
  __setScaleDepsForTests(null);
  r.check(
    "forced ≥70% with a warm standby → 'flipped' A→A2",
    flipped.status === "flipped" && flipped.flip?.fromTag === "A" && flipped.flip?.toTag === "A2",
    JSON.stringify(flipped.flip),
  );
  r.check(
    "one-day overlap: newFrom=TODAY, oldTo=TOMORROW (contiguous windows)",
    dayKey(flipped.flip?.newFrom) === ctx.today && dayKey(flipped.flip?.oldTo) === ctx.tomorrow,
  );

  const doc = (await regColl.findOne({})) as {
    ledgers: Array<{ id: string; tag: string; from?: string | null; to?: string | null; active?: boolean; empty?: boolean }>;
    standby?: unknown[];
  } | null;
  const a = doc?.ledgers.find((l) => l.tag === "A");
  const a2 = doc?.ledgers.find((l) => l.tag === "A2");
  r.check(
    "manifest: A retired (active:false, to=overlap end), A2 active (from=overlap start, to=null)",
    a?.active === false && dayKey(a?.to) === ctx.tomorrow &&
      a2?.active === true && dayKey(a2?.from) === ctx.today && a2?.to === null &&
      !("empty" in (a2 ?? {})) && (doc?.standby ?? []).length === 0,
  );

  const idsAfter = (await ordersA.find({}).project({ _id: 1 }).toArray())
    .map((d) => String(d._id))
    .sort();
  const lbCount = await itestDb(raw, ctx.dbs.lb).collection(ctx.colls.orders).countDocuments();
  const counterA = await itestDb(raw, ctx.dbs.la).collection("counters").findOne({ _id: `order-${ctx.today}` as never });
  r.check(
    "NO existing data moved: A's 18 orders byte-identical in place, A2 empty, A's counter intact",
    idsAfter.join() === idsBefore.join() && lbCount === 0 && (counterA as { seq?: number } | null)?.seq === 11,
  );

  // The router serves the flipped manifest; new writes land on A2 with a FRESH sequence.
  __resetRouterForTests();
  const promoted = await ledgerForWrite();
  r.check("ledgerForWrite() now resolves the promoted A2", promoted.tag === "A2");
  const a2o1 = await createOrder(mkInput(
    { total: A2_ORDER_TOTAL, paid: A2_ORDER_TOTAL, payment: "Cash", withCustomer: true, productId: PRODUCTS.p1 },
    ctx.customerId,
  ));
  const a2o2 = await createOrder(mkInput(
    { total: A2_ORDER_TOTAL, paid: A2_ORDER_TOTAL, payment: "Cash", withCustomer: true, productId: PRODUCTS.p1 },
    ctx.customerId,
  ));
  ctx.orderIdsA2.push(a2o1._id, a2o2._id);
  r.check(
    "post-flip creates: ORD-A2-<today>-001/002 from A2's OWN counter (per-ledger sequencing)",
    a2o1._id === buildOrderId("A2", ctx.today, 1) && a2o2._id === buildOrderId("A2", ctx.today, 2),
  );
  r.check(
    "A2 orders persisted on the NEW cluster; A untouched",
    (await itestDb(raw, ctx.dbs.lb).collection(ctx.colls.orders).countDocuments()) === 2 &&
      (await ordersA.countDocuments()) === 18,
  );
  const oldRead = (await import("@/lib/order-read")).readOrderById;
  r.check("old-tag point read still targets retired A", (await oldRead(ctx.orderIdsA[0]))?._id === ctx.orderIdsA[0]);

  // Cross-ledger authority: incremental applies (A2 enqueuer) then recompute parity.
  const customers = itestDb(raw, ctx.dbs.core).collection(ctx.colls.customers);
  const custFilter = { _id: new ObjectId(ctx.customerId) as never };
  await poll(
    "A2 rollups converged (visits=6)",
    async () => (await customers.findOne(custFilter))?.visits === EXPECT_A.visits + 2,
  );
  const rc = await recomputeCustomer(ctx.customerId);
  r.check(
    "recompute sums ACROSS ledgers (A + A2) and matches the incremental applies",
    rc.applied &&
      rc.totals.visits === EXPECT_A.visits + 2 &&
      rc.totals.spendPaise === EXPECT_A.spendPaise + 2 * A2_ORDER_TOTAL &&
      rc.totals.duePaise === EXPECT_A.duePaise,
    JSON.stringify(rc),
  );
}

export async function stepFanout(ctx: Ctx): Promise<void> {
  const { report: r, raw, uris } = ctx;
  r.step("G. multi-month fan-out + honest partial on a dead leg (box 5)");
  const ALL_GROSS = HIST_GROSS + TODAY_A_GROSS + 2 * A2_ORDER_TOTAL;

  const legsToday = await ledgersForDate(ctx.today, ctx.today);
  const legsSpring = await ledgersForDate("20260401", "20260531");
  const legsFuture = await ledgersForDate(ctx.tomorrow, ctx.tomorrow);
  r.check(
    "window routing: flip-day=2 legs (A+A2), Apr–May=1 leg (A), tomorrow=1 leg (A2)",
    legsToday.length === 2 && legsSpring.length === 1 && legsSpring[0].tag === "A" &&
      legsFuture.length === 1 && legsFuture[0].tag === "A2",
  );

  const spring = await reportFanout(sumSpec("20260401", "20260531"), "20260401", "20260531");
  const springData = spring.data as { revenue?: number; n?: number };
  r.check(
    "two-month report touches ONLY ledger A and sums exactly (₹410, 5 orders)",
    !spring.partial && springData.revenue === 41_000 && springData.n === 5,
    JSON.stringify(spring.data),
  );
  const all = await reportFanout(sumSpec("20260401", ctx.today), "20260401", ctx.today);
  const allData = all.data as { revenue?: number; n?: number };
  r.check(
    "multi-month fan-out over BOTH legs merges exactly (20 orders)",
    !all.partial && allData.revenue === ALL_GROSS && allData.n === 20,
    JSON.stringify(all.data),
  );

  const merged = await readOrdersInDayRangeMerged(ctx.today, ctx.today);
  const sortedDesc = merged.orders.every((o, i, a) => i === 0 || a[i - 1]._id > o._id);
  r.check(
    "flip-day merged read: 2 legs, 13 orders, re-sorted _id desc, partial:false",
    merged.ledgers.length === 2 && merged.orders.length === 13 && sortedDesc && !merged.partial,
  );
  const top5 = await readOrdersInDayRangeMerged(ctx.today, ctx.today, { limit: 5 });
  r.check(
    "scatter-gather top-k: limit 5 = the merged head",
    top5.orders.length === 5 &&
      top5.orders.map((o) => o._id).join() === merged.orders.slice(0, 5).map((o) => o._id).join(),
  );

  // Kill retired A (unroutable URI), prove honest degradation everywhere.
  const regColl = itestDb(raw, ctx.dbs.core).collection(CLUSTER_REGISTRY_COLLECTION);
  await disconnectAll();
  await regColl.updateOne({}, { $set: { "ledgers.$[l].uri": uris.dead } }, { arrayFilters: [{ "l.tag": "A" }] });
  __resetRouterForTests();

  const t0 = Date.now();
  const part = await reportFanout(sumSpec(ctx.today, ctx.today), ctx.today, ctx.today);
  const partData = part.data as { revenue?: number };
  r.check(
    "dead ledger → partial:true with the honest A2-only undercount (never a hang)",
    part.partial === true && partData.revenue === 2 * A2_ORDER_TOTAL,
    JSON.stringify(part.data),
  );
  r.check("degraded within the ≤8s route budget", Date.now() - t0 < 8_000, `${Date.now() - t0}ms`);
  const dm = await readOrdersInDayRangeMerged(ctx.today, ctx.today);
  r.check(
    "merged read degrades the same way (2 rows, partial:true)",
    dm.partial === true && dm.orders.length === 2,
  );

  const customers = itestDb(raw, ctx.dbs.core).collection(ctx.colls.customers);
  const custFilter = { _id: new ObjectId(ctx.customerId) as never };
  const preRefusal = await customers.findOne(custFilter);
  const refused = await recomputeCustomer(ctx.customerId);
  const postRefusal = await customers.findOne(custFilter);
  r.check(
    "recompute REFUSES the partial fan-out — the undercount never touches CORE",
    refused.applied === false && refused.reason === "partial" &&
      postRefusal?.visits === preRefusal?.visits && postRefusal?.totalSpend === preRefusal?.totalSpend,
  );

  // Recover the leg; the authority applies again.
  await regColl.updateOne({}, { $set: { "ledgers.$[l].uri": uris.la } }, { arrayFilters: [{ "l.tag": "A" }] });
  await disconnectAll();
  __resetRouterForTests();
  const healed = await recomputeCustomer(ctx.customerId);
  r.check("after leg recovery the recompute applies again", healed.applied === true);
}
