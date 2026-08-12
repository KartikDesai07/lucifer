/**
 * F2 §5 sweep orchestrator. `run.ts` prepares env BEFORE this module (and its
 * '@/lib' imports) is evaluated. Teardown ALWAYS runs: seams restored, pools
 * closed, every f2itest_* db dropped (prefix-guarded).
 * Ops CLI harness — console output intentional.
 */
import { MongoClient } from "mongodb";

import { disconnectAll, __setConnectionOpenerForTests } from "@/lib/cluster-registry";
import { __resetRouterForTests } from "@/lib/cluster-router";
import { __setScaleDepsForTests } from "@/lib/ledger-scale";
import { setDayRollupFold } from "@/lib/rollup-recompute";
import { deriveDbUri, dropItestDb, FailError, Reporter, type Ctx } from "./util";
import { stepSeed, stepPoolsAndCreates } from "./steps-core";
import { stepTargetedReads, stepRecomputeParity } from "./steps-reads";
import { stepFlip, stepFanout } from "./steps-scale";
import { stepRollupRoundTrip } from "./steps-rollup";
import { stepHealth, stepHotAdd, stepOwnerBlocked } from "./steps-live";

export async function main(baseUri: string): Promise<void> {
  const report = new Reporter();
  const raw = new MongoClient(deriveDbUri(baseUri, "f2itest_core"));
  await raw.connect();

  const ctx: Ctx = {
    raw,
    uris: {
      core: deriveDbUri(baseUri, "f2itest_core"),
      la: deriveDbUri(baseUri, "f2itest_la"),
      lb: deriveDbUri(baseUri, "f2itest_lb"),
      lc: deriveDbUri(baseUri, "f2itest_lc"),
      // Unroutable on purpose — the dead-leg fixture (connection refused locally).
      dead: "mongodb://127.0.0.1:9/f2itest_dead?directConnection=true",
    },
    dbs: { core: "f2itest_core", la: "f2itest_la", lb: "f2itest_lb", lc: "f2itest_lc" },
    colls: {
      orders: "orders",
      counters: "counters",
      customers: "customers",
      rollup: "dailyRollup",
      pdc: "productDayCounter",
    },
    customerId: "",
    today: "",
    tomorrow: "",
    orderIdsA: [],
    orderIdsA2: [],
    report,
    opens: [],
    sockets: new Map(),
  };

  let failed = false;
  try {
    await stepSeed(ctx);
    await stepPoolsAndCreates(ctx);
    await stepTargetedReads(ctx);
    await stepRecomputeParity(ctx);
    await stepFlip(ctx);
    await stepFanout(ctx);
    await stepRollupRoundTrip(ctx);
    await stepHealth(ctx);
    await stepHotAdd(ctx);
    stepOwnerBlocked(ctx);
  } catch (err) {
    failed = true;
    if (err instanceof FailError) {
      console.error(`\nSWEEP FAILED at: ${err.message}`);
    } else {
      console.error("\nSWEEP FAILED unexpectedly:", err);
    }
  } finally {
    try {
      setDayRollupFold(null);
      __setScaleDepsForTests(null);
      __setConnectionOpenerForTests(null);
      __resetRouterForTests();
      delete process.env.HEALTH_STATS_TOKEN;
      await disconnectAll();
      for (const name of Object.values(ctx.dbs)) await dropItestDb(raw, name);
      await raw.close();
      console.log("\nteardown: pools closed, f2itest_* dbs dropped");
    } catch (tErr) {
      failed = true;
      console.error("teardown error (test dbs may need a manual drop):", tErr);
    }
  }

  const { failed: failCount } = report.summary();
  process.exit(failed || failCount > 0 ? 1 : 0);
}
