/**
 * F2 §5 sweep — Steps I–J: the F2.9-deferred live `?stats=1` heartbeat
 * round-trip (in-process route invocation — the full HTTP ride is F3's
 * Worker), and the box-13 hot-add: a manifest edit served after the 30s
 * router TTL with NO reset and NO redeploy.
 * Ops CLI harness — console output intentional.
 */
import { disconnectAll } from "@/lib/cluster-registry";
import {
  __resetRouterForTests,
  CLUSTER_REGISTRY_COLLECTION,
  ledgerForWrite,
  ledgersForDate,
} from "@/lib/cluster-router";
import { createOrder } from "@/lib/order-create";
import { readOrdersInDayRangeMerged } from "@/lib/report-fanout";
import { scaleCheck, __setScaleDepsForTests } from "@/lib/ledger-scale";
import { M0_QUOTA_BYTES } from "@/lib/ledger-scale-plan";
import { buildHeartbeat } from "@/lib/heartbeat";
import { buildOrderId } from "@/models/order.ledger";
import { itestDb, sleep, type Ctx } from "./util";
import { PRODUCTS, mkInput } from "./steps-core";

export async function stepHealth(ctx: Ctx): Promise<void> {
  const { report: r, raw, uris } = ctx;
  r.step("I. live heartbeat + /api/health?stats=1 (F2.9 deferral)");

  const hb = await buildHeartbeat();
  const byName = new Map(hb.clusters.map((c) => [c.name, c]));
  const coreRow = byName.get("core");
  const aRow = byName.get("itest-la");
  const a2Row = byName.get("itest-lb");
  r.check(
    "heartbeat gauges every owned cluster live (core + 2 ledgers, no bootstrap flag)",
    hb.tenant === "f2itest" && !hb.bootstrap && hb.clusters.length === 3,
  );
  r.check(
    "rows carry live db.stats: state ok, usedPct number, dataSize > 0",
    coreRow?.state === "ok" && typeof coreRow.usedPct === "number" &&
      aRow?.state === "ok" && (aRow.dataSize ?? 0) > 0 && aRow.active === false &&
      a2Row?.state === "ok" && a2Row.active === true,
    JSON.stringify(hb.clusters),
  );

  // The route itself, invoked in-process (the F1 Worker contract + the stats fold-in).
  const { GET } = await import("../../app/api/health/route");
  const { NextRequest } = await import("next/server");
  const plain = await GET(new NextRequest("http://localhost/api/health"));
  const pj = (await plain.json()) as Record<string, unknown>;
  r.check(
    "plain /api/health is byte-shape identical to the F1 contract (no stats leak)",
    plain.status === 200 && pj.ok === true && pj.db === "up" && pj.tenant === "f2itest" &&
      Object.keys(pj).sort().join() === "db,ok,tenant,ts",
    JSON.stringify(pj),
  );
  const stats = await GET(new NextRequest("http://localhost/api/health?stats=1"));
  const sj = (await stats.json()) as { clusters?: unknown[] };
  r.check(
    "?stats=1 folds the heartbeat in (3 cluster rows)",
    stats.status === 200 && Array.isArray(sj.clusters) && sj.clusters.length === 3,
  );

  process.env.HEALTH_STATS_TOKEN = "itest-token";
  const denied = await GET(new NextRequest("http://localhost/api/health?stats=1"));
  const dj = (await denied.json()) as Record<string, unknown>;
  const granted = await GET(
    new NextRequest("http://localhost/api/health?stats=1", {
      headers: { "x-stats-token": "itest-token" },
    }),
  );
  const gj = (await granted.json()) as { clusters?: unknown[] };
  delete process.env.HEALTH_STATS_TOKEN;
  r.check(
    "HEALTH_STATS_TOKEN gate: mismatch → stats:'denied' (health unaffected); match → clusters",
    denied.status === 200 && dj.stats === "denied" && !("clusters" in dj) &&
      Array.isArray(gj.clusters),
  );

  // A dead cluster degrades to state:'error' ONLY — raw driver strings stay server-side.
  const regColl = itestDb(raw, ctx.dbs.core).collection(CLUSTER_REGISTRY_COLLECTION);
  await disconnectAll();
  await regColl.updateOne({}, { $set: { "ledgers.$[l].uri": uris.dead } }, { arrayFilters: [{ "l.tag": "A" }] });
  __resetRouterForTests();
  const hbErr = await buildHeartbeat();
  const errRow = hbErr.clusters.find((c) => c.name === "itest-la");
  const wire = JSON.stringify(hbErr);
  r.check(
    "dead cluster → state:'error' row only; no usedPct, no raw driver text on the wire",
    errRow?.state === "error" && !("usedPct" in (errRow ?? {})) &&
      !/ECONNREFUSED|127\.0\.0\.1|timed out|MongoServerSelectionError/i.test(wire),
  );
  await regColl.updateOne({}, { $set: { "ledgers.$[l].uri": uris.la } }, { arrayFilters: [{ "l.tag": "A" }] });
  await disconnectAll();
  __resetRouterForTests();
}

export async function stepHotAdd(ctx: Ctx): Promise<void> {
  const { report: r, raw, uris } = ctx;
  r.step("J. hot-added ledger served with NO redeploy (box 13, live 30s TTL)");

  const pre = await ledgerForWrite(); // warms the router's manifest cache NOW
  r.check("pre-hot-add active = A2", pre.tag === "A2");

  // The F3 Connect flow's doc write: paste a standby, then roll forward onto it.
  const regColl = itestDb(raw, ctx.dbs.core).collection(CLUSTER_REGISTRY_COLLECTION);
  await regColl.updateOne({}, {
    $push: { standby: { id: "itest-lc", uri: uris.lc, tag: "A3", empty: true } } as never,
  });
  __setScaleDepsForTests({
    readStats: async () => ({ dataSize: Math.ceil(M0_QUOTA_BYTES * 0.72), indexSize: 0 }),
  });
  const flip2 = await scaleCheck();
  __setScaleDepsForTests(null);
  r.check(
    "pasted standby validated + promoted: second forced flip A2→A3",
    flip2.status === "flipped" && flip2.flip?.fromTag === "A2" && flip2.flip?.toTag === "A3",
    JSON.stringify(flip2.flip),
  );

  const stale = await ledgerForWrite();
  r.check(
    "within the TTL the router still serves the ≤30s-stale manifest (by design, #18)",
    stale.tag === "A2",
  );
  r.note("sleeping 31s across the registry TTL — no reset, no redeploy, no new env...");
  await sleep(31_500);
  const fresh = await ledgerForWrite();
  r.check(
    "after TTL expiry the hot-added ledger is the write target — ZERO redeploys",
    fresh.tag === "A3",
  );

  const o = await createOrder(mkInput(
    { total: 15_000, paid: 15_000, payment: "Cash", withCustomer: false, productId: PRODUCTS.p2 },
    ctx.customerId,
  ));
  r.check(
    "create lands on A3 with its own fresh sequence (ORD-A3-<today>-001)",
    o._id === buildOrderId("A3", ctx.today, 1) &&
      (await itestDb(raw, ctx.dbs.lc).collection(ctx.colls.orders).countDocuments()) === 1,
  );

  const legs3 = await ledgersForDate(ctx.today, ctx.today);
  const merged = await readOrdersInDayRangeMerged(ctx.today, ctx.today);
  r.check(
    "flip-day now resolves 3 overlapping legs; triple-leg merge = 14 orders, partial:false",
    legs3.length === 3 && merged.orders.length === 14 && !merged.partial,
  );
}

/** Boxes that need the OWNER's credentials — recorded, never faked. */
export function stepOwnerBlocked(ctx: Ctx): void {
  const { report: r } = ctx;
  r.step("K. owner-blocked legs (recorded honestly)");
  const sa = process.env.ATLAS_SA_CLIENT_ID && process.env.ATLAS_SA_CLIENT_SECRET && process.env.ATLAS_ORG_ID;
  const r2 = process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET;
  r.note(
    sa
      ? "ATLAS SA creds PRESENT — extend this pass with the live ensureNextStandby leg (box 8)"
      : "box 8 (ensureNextStandby vs a test org): BLOCKED — ATLAS_SA_CLIENT_ID/_SECRET + ATLAS_ORG_ID not set (owner)",
  );
  r.note(
    r2
      ? "R2 creds PRESENT — extend this pass with the live upload/render/delete leg (F2.11)"
      : "F2.11 live R2 round-trip: BLOCKED — R2_* env not set locally (owner bucket + CORS rule)",
  );
}
