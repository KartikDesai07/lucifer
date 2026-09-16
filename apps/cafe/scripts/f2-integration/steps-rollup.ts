/**
 * F2 §5 sweep — Step H: the F2.10-deferred LIVE rollup round-trip —
 * replaceOne full-replace, bulkWrite counter upserts, the $regex+$nin stale
 * sweep, empty-day absence, fold-invalid refusal and the fold-unbuilt default,
 * all against the seeded M0. The fold wired here is a MECHANICS TEST fold —
 * the CA-pinned financial fold stays P2's (P7-D0).
 * Ops CLI harness — console output intentional.
 */
import type { PaymentMode } from "@/lib/constants";
import { getConn } from "@/lib/cluster-registry";
import { ledgersForDate } from "@/lib/cluster-router";
import {
  recomputeDayRollup,
  setDayRollupFold,
  type DayRollupFold,
} from "@/lib/rollup-recompute";
import { getDailyRollupModel, getProductDayCounterModel } from "@/models/daily-rollup.ledger";
import type { IOrder } from "@/models/order.ledger";
import { itestDb, type Ctx } from "./util";
import { PRODUCTS, TODAY_A_GROSS } from "./steps-core";
import { A2_ORDER_TOTAL } from "./steps-scale";

/** Minimal PURE fold: order count, gross=Σtotal, per-mode payment buckets,
 *  per-product counters. Purity is what makes the replace-write idempotent. */
const testFold: DayRollupFold = {
  fold: (orders: IOrder[]) => {
    const byMode = new Map<string, { amount: number; orders: number }>();
    const byProd = new Map<string, { sold: number; revenue: number }>();
    let gross = 0;
    for (const o of orders) {
      gross += o.total;
      const m = byMode.get(o.payment) ?? { amount: 0, orders: 0 };
      m.amount += o.total;
      m.orders += 1;
      byMode.set(o.payment, m);
      for (const it of o.items) {
        const k = String(it.productId);
        const p = byProd.get(k) ?? { sold: 0, revenue: 0 };
        p.sold += it.qty;
        p.revenue += it.price * it.qty;
        byProd.set(k, p);
      }
    }
    return {
      rollup: {
        orders: orders.length,
        gross,
        payments: [...byMode.entries()].map(([mode, v]) => ({
          mode: mode as PaymentMode,
          ...v,
        })),
      },
      counters: [...byProd.entries()].map(([productId, v]) => ({ productId, ...v })),
    };
  },
};

export async function stepRollupRoundTrip(ctx: Ctx): Promise<void> {
  const { report: r, raw } = ctx;
  r.step("H. LIVE rollup round-trip: replaceOne / bulkWrite / stale sweep (F2.10 deferral)");

  // Pin the anti-pluralization collection names against the LIVE binding.
  const [todayLeg] = await ledgersForDate(ctx.today, ctx.today);
  const conn = await getConn(todayLeg);
  r.check(
    "collection names pinned live: dailyRollup / productDayCounter (no pluralization)",
    getDailyRollupModel(conn).collection.name === ctx.colls.rollup &&
      getProductDayCounterModel(conn).collection.name === ctx.colls.pdc,
  );

  setDayRollupFold(testFold);
  const rr = await recomputeDayRollup(ctx.today);
  const byTag = new Map(rr.legs.map((l) => [l.leg.tag, l]));
  const aLeg = byTag.get("A");
  const a2Leg = byTag.get("A2");
  r.check(
    "flip-day recompute ran BOTH legs independently (A: 11 orders, A2: 2)",
    rr.applied &&
      aLeg?.applied === true && aLeg.orders === 11 &&
      a2Leg?.applied === true && a2Leg.orders === 2,
    // leg.uri carries credentials — log tag/outcome only (the redaction rule).
    JSON.stringify(rr.legs.map((l) => ({ tag: l.leg.tag, applied: l.applied, ...(l.applied ? { orders: l.orders } : { reason: l.reason }) }))),
  );

  const rollupA = itestDb(raw, ctx.dbs.la).collection(ctx.colls.rollup);
  const rollupA2 = itestDb(raw, ctx.dbs.lb).collection(ctx.colls.rollup);
  const pdcA = itestDb(raw, ctx.dbs.la).collection(ctx.colls.pdc);
  const rowA = await rollupA.findOne({ _id: ctx.today as never, gross: { $type: "int" } });
  const rowA2 = await rollupA2.findOne({ _id: ctx.today as never });
  r.check(
    "each cluster carries ITS OWN slice of the day (Int32 gross on-server)",
    (rowA as { orders?: number; gross?: number } | null)?.orders === 11 &&
      (rowA as { gross?: number } | null)?.gross === TODAY_A_GROSS &&
      (rowA2 as { orders?: number; gross?: number } | null)?.orders === 2 &&
      (rowA2 as { gross?: number } | null)?.gross === 2 * A2_ORDER_TOTAL,
  );
  const p1Id = `${PRODUCTS.p1.toHexString()}-${ctx.today}`;
  const p1Row = await pdcA.findOne({ _id: p1Id as never });
  const countersA = await pdcA.countDocuments({ _id: { $regex: `^[0-9a-f]{24}-${ctx.today}$` } as never });
  r.check(
    "bulkWrite counters live: 3 product rows on A; p1 = sold 2 / revenue 85000",
    countersA === 3 &&
      (p1Row as { sold?: number; revenue?: number } | null)?.sold === 2 &&
      (p1Row as { revenue?: number } | null)?.revenue === 85_000,
  );

  // Idempotency: a re-run converges on identical bytes.
  const snapshot = JSON.stringify({
    a: await rollupA.findOne({ _id: ctx.today as never }),
    a2: await rollupA2.findOne({ _id: ctx.today as never }),
    c: await pdcA.find({}).sort({ _id: 1 }).toArray(),
  });
  await recomputeDayRollup(ctx.today);
  const snapshot2 = JSON.stringify({
    a: await rollupA.findOne({ _id: ctx.today as never }),
    a2: await rollupA2.findOne({ _id: ctx.today as never }),
    c: await pdcA.find({}).sort({ _id: 1 }).toArray(),
  });
  r.check("re-run is byte-identical (pure fold + replaceOne idempotency)", snapshot === snapshot2);

  // Stale sweep: a counter whose product left the day's order set must drop.
  await pdcA.insertOne({
    _id: `ffffffffffffffffffffffff-${ctx.today}` as never,
    sold: 5,
    revenue: 5,
    v: 1,
  });
  await recomputeDayRollup(ctx.today);
  r.check(
    "$regex+$nin stale sweep removed the orphan counter, kept the 3 legit rows",
    (await pdcA.findOne({ _id: `ffffffffffffffffffffffff-${ctx.today}` as never })) === null &&
      (await pdcA.countDocuments({ _id: { $regex: `-${ctx.today}$` } as never })) === 3,
  );

  // fold-invalid: an out-of-Int32-range gross is REFUSED before any write.
  setDayRollupFold({
    fold: () => ({ rollup: { orders: 1, gross: 3_000_000_000 }, counters: [] }),
  });
  const bad = await recomputeDayRollup("20260401");
  r.check(
    "out-of-Int32-range fold output → 'fold-invalid', NOTHING written",
    !bad.applied &&
      bad.legs.every((l) => !l.applied && l.reason === "fold-invalid") &&
      (await rollupA.findOne({ _id: "20260401" as never })) === null,
  );
  setDayRollupFold(testFold);
  const apr = await recomputeDayRollup("20260401");
  r.check(
    "historical single-leg day recomputes exactly (Apr 1: 2 orders, ₹200 gross)",
    apr.applied &&
      ((await rollupA.findOne({ _id: "20260401" as never })) as { gross?: number } | null)?.gross === 20_000,
  );

  // Empty-day heal: a stale row for a day with zero orders is DELETED (absence, not zero-rows).
  await rollupA.insertOne({ _id: "20260320" as never, orders: 9, gross: 9, v: 1 });
  const empty = await recomputeDayRollup("20260320");
  r.check(
    "empty day recomputes to ABSENCE — the stale row was deleted (deleteOne live)",
    empty.applied &&
      empty.legs[0]?.applied === true && empty.legs[0].orders === 0 &&
      (await rollupA.findOne({ _id: "20260320" as never })) === null,
  );

  // The refusal default: unwiring the fold blocks the writer without touching data.
  setDayRollupFold(null);
  const refused = await recomputeDayRollup(ctx.today);
  r.check(
    "fold-unbuilt default REFUSES every leg; the last good rows stay untouched",
    !refused.applied &&
      refused.legs.every((l) => !l.applied && l.reason === "fold-unbuilt") &&
      ((await rollupA.findOne({ _id: ctx.today as never })) as { gross?: number } | null)?.gross === TODAY_A_GROSS,
  );
}
