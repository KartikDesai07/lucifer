/**
 * F2 §5 CHECKPOINT SWEEP — seeded-M0 integration pass (phase-F2 §5).
 *
 * Run:  node --env-file=.env.local --import tsx scripts/f2-integration/run.ts
 *       (wired as `npm run itest:f2`)
 *
 * Walks the §5 boxes against a REAL Atlas M0 using isolated `f2itest_*`
 * databases on the same cluster (one physical M0 stands in for K clusters —
 * distinct URIs/db-names give K independent driver pools; the cross-CLUSTER
 * legs that need real second hardware are the owner-blocked boxes 8/12).
 * Production data is untouched: every URI this pass builds points only at
 * `f2itest_*` db names, and drops are prefix-guarded. All test dbs are
 * dropped in teardown.
 *
 * Env is prepared HERE, before any '@/lib' module is evaluated (the dynamic
 * import below is what sequences that): the router's CORE bootstrap must see
 * the f2itest core, never the real db.
 */
import { deriveDbUri } from "./util";

async function bootstrap(): Promise<void> {
  const base = process.env.MONGODB_URI;
  if (!base) {
    throw new Error("MONGODB_URI is required — run with --env-file=.env.local");
  }

  process.env.CORE_MONGODB_URI = deriveDbUri(base, "f2itest_core");
  process.env.TENANT_ID = "f2itest";
  delete process.env.HEALTH_STATS_TOKEN;

  // Loaded ONLY after env is prepared — '@/lib' modules ride this import.
  const { main } = await import("./main");
  await main(base);
}

void bootstrap().catch((err) => {
  console.error("f2-integration bootstrap failed:", err);
  process.exit(1);
});
