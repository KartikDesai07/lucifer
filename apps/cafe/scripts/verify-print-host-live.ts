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
import { PrintDevice } from "@/models/PrintDevice";
import { SCRATCH_PREFIX, DEFAULT_URI, counts } from "./print-host-live/harness";
import { legA, legsBC, legD, legI, legK } from "./print-host-live/jobs";
import { legE, legJ, legL } from "./print-host-live/feeds";
import { legF, legM } from "./print-host-live/prune";
import { legG, legH, legN, legP } from "./print-host-live/host";
import { legQ, legR, legS, legT, legU } from "./print-host-live/lifecycle";
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";
import { legAF, legAG } from "./print-host-live/attention";
import { legAH, legAI, legAJ } from "./print-host-live/printers";
import { legAK, legAL, legAM } from "./print-host-live/direct";
import { legAN, legAO, legAP, legAQ } from "./print-host-live/printers-mode";
import { legAR, legAS, legAT } from "./print-host-live/setup-2d";
import { legAU, legAV } from "./print-host-live/setup-2e";
import { Station } from "@/models/Station";
import { Printer } from "@/models/Printer";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([PrintJob.createIndexes(), PrintHost.createIndexes(), Order.createIndexes(), PrintDevice.createIndexes()]);
  // Phase 2: the unique station and printer names are what the setup legs (ah, ai) lean on.
  await Promise.all([Station.createIndexes(), Printer.createIndexes(), Category.createIndexes(), Product.createIndexes()]);

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
    await legP(Date.now());
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
    // Phase 1 lifecycle legs (plan 2026-10-02-phase-1-lifecycle.md Task 8). They run AFTER leg m,
    // because the sweep arms the prune throttle that leg m must fire first.
    await legQ(Date.now());
    await legR(Date.now());
    await legS(Date.now());
    await legT(Date.now());
    await legU(Date.now());
    await legV(Date.now());
    await legW(Date.now());
    await legX(Date.now());
    // Phase 1 Session 1B legs (server-side creation, repair, host changes, the lease fence).
    await legY(Date.now());
    await legZ(Date.now());
    await legAA(Date.now());
    await legAB(Date.now());
    // Session 1B final review I1: the repair reads past a rush.
    await legAC(Date.now());
    // Phase 1 Session 1C legs (the owner's two-attempt rule; the job-aware self-order lane).
    await legAD(Date.now());
    await legAE(Date.now());
    // Phase 1 Session 1D leg (the waiting-slips feed every device's pulse carries).
    await legAF(Date.now());
    // Phase 1 Session 1E leg (the owner's retention after Session 1D).
    await legAG(Date.now());
    // Phase 2 Session 2A legs (stations, printers, the routing read over a real catalog).
    await legAH();
    await legAI();
    await legAJ();
    // Phase 2 Session 2B legs (direct print on the asking device; the ack's more).
    await legAK(Date.now());
    await legAL(Date.now());
    await legAM(Date.now());
    // Phase 2 Session 2C legs (printers mode: creation, a lease per printer line, the sweep, the repair).
    await legAN(Date.now());
    await legAO(Date.now());
    await legAP(Date.now());
    await legAQ(Date.now());
    // Phase 2 Session 2D legs (the setup screens' server half: Test print, station writes, one printer per device,
    // the devices list).
    await legAR(Date.now());
    await legAS();
    await legAT(Date.now());
    // Phase 2 Session 2E legs (several printers on one Windows PC: the setup by name, a lease per named line).
    await legAU();
    await legAV(Date.now());
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
