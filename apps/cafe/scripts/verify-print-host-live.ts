/**
 * PH-10 Slice F live leg — proves the print-host queue (PrintJob/PrintHost)
 * against a REAL MongoDB: enqueue dedupe/CAS races, the claim CAS, the
 * dismiss CAS, the three feed chains' own query plans, the retention sweep,
 * the host designate/beat CAS races, and the DELETE teardown's exact
 * lib-call sequence. Mirrors scripts/verify-self-order-alert-live.ts's own
 * conventions (env/URI handling, the scratch-DB-prefix guard, numbered
 * PASS/FAIL, full drop at start+end) — read that file's header first.
 *
 * SCOPE — drives enqueuePrintJob/claimPrintJob/dismissPrintJob/prunePrintJobs/
 * designatePrintHost/beatPrintHost/clearPrintHost/readPrintJobFeeds directly.
 * It does NOT stand up the HTTP routes (no auth, no BotID) — those stay in
 * the route/unit-test layer; legs (m) and (n) instead replicate each route's
 * own lib-call sequence verbatim.
 *
 *   npm run verify:print:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { SCRATCH_PREFIX, DEFAULT_URI, counts } from "./print-host-live/harness";
import { legA, legsBC, legD, legI, legK } from "./print-host-live/jobs";
import { legE, legJ, legL } from "./print-host-live/feeds";
import { legF, legM } from "./print-host-live/prune";
import { legG, legH, legN } from "./print-host-live/host";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([PrintJob.createIndexes(), PrintHost.createIndexes(), Order.createIndexes()]);

  console.log(`\nPH-10 print-host live legs — live against ${dbName}\n`);

  try {
    // Each leg re-seeds what it needs and cleans PrintJob/PrintHost between
    // legs (resetCollections -> deleteMany({})) so legs are independent.
    // nowMs is passed explicitly everywhere — one Date.now() per leg.
    await legA(Date.now());
    await legsBC(Date.now());
    await legD(Date.now());
    await legE(Date.now());
    await legF(Date.now());
    await legG(Date.now());
    await legH(Date.now());
    await legI(Date.now());
    await legJ(Date.now());
    await legK(Date.now());
    await legL(Date.now());
    // Leg m fires the FIRST prunePrintJobsThrottled call of this run (no
    // earlier throttled call happened above — jobs.ts/feeds.ts/host.ts never
    // call prunePrintJobsThrottled, only prunePrintJobs directly), so it need
    // not add the min-interval offset.
    await legM(Date.now(), false);
    await legN(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  const { passed, failed } = counts();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
