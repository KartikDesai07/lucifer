/**
 * PH-10 Slice F — legs g, h, n: the PrintHost singleton's designate race (with
 * the amendment (g) debug-counter observation), the beat CAS full-suppression
 * pin, and the DELETE-host teardown's exact 3-call lib sequence.
 */
import mongoose from "mongoose";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { designatePrintHost, beatPrintHost, clearPrintHost, readPrintHostState } from "@/lib/print-host";
import { prunePrintJobs, dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import { billPrintJob } from "@/lib/print-routing";
import { check, resetCollections, baseOrderFields } from "./harness";

export async function legG(nowMs: number): Promise<void> {
  console.log("\nLeg g — two concurrent designatePrintHost calls on an EMPTY PrintHost collection\n");
  await resetCollections();

  // Amendment (g): observe the retry with a mongoose debug counter on
  // findOneAndUpdate against the printhosts collection during the race, print
  // the observed count (never assert on it — timing-dependent), then reset.
  let findOneAndUpdateCalls = 0;
  mongoose.set("debug", (collectionName: string, method: string) => {
    if (collectionName === "printhosts" && method === "findOneAndUpdate") findOneAndUpdateCalls += 1;
  });

  const [resultA, resultB] = await Promise.all([
    designatePrintHost({ deviceId: "A", label: "PC A", setBy: "Admin" }, nowMs),
    designatePrintHost({ deviceId: "B", label: "PC B", setBy: "Admin" }, nowMs),
  ]);

  mongoose.set("debug", false);
  console.log(`  observed findOneAndUpdate calls on printhosts during the race: ${findOneAndUpdateCalls}`);

  const count = await PrintHost.countDocuments({ key: PRINT_HOST_KEY });
  check("leg g: exactly one PrintHost doc exists after the race", count === 1);
  check("leg g: both results report ok:true (the built-in retry absorbs any E11000)", resultA.ok === true && resultB.ok === true);

  const survivor = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  check('leg g: the surviving deviceId is "A" or "B" (winner is nondeterministic)', survivor?.deviceId === "A" || survivor?.deviceId === "B");
}

export async function legH(nowMs: number): Promise<void> {
  console.log("\nLeg h — beatPrintHost from a DEMOTED device is fully suppressed (isHost:false, no write)\n");
  await resetCollections();

  const designateA = await designatePrintHost({ deviceId: "A", label: "PC A", setBy: "Admin" }, nowMs);
  check("leg h: designating A succeeds", designateA.ok === true);

  const designateB = await designatePrintHost({ deviceId: "B", label: "PC B", setBy: "Admin" }, nowMs + 1000);
  check("leg h: designating B succeeds", designateB.ok === true);

  const snapshot = await PrintHost.findOne({ key: PRINT_HOST_KEY }).lean();

  const laterNowMs = nowMs + 5000;
  const beat = await beatPrintHost({ deviceId: "A", silentMode: true, silentProbeMs: 42 }, laterNowMs);
  check("leg h: A's beat is refused — isHost:false (A was demoted by B's designation)", beat.isHost === false);

  const reread = await PrintHost.findOne({ key: PRINT_HOST_KEY }).lean();
  check(
    "leg h: lastSeenAt is byte-identical to the post-B-designation snapshot",
    snapshot?.lastSeenAt instanceof Date &&
      reread?.lastSeenAt instanceof Date &&
      snapshot.lastSeenAt.getTime() === reread.lastSeenAt.getTime(),
  );
  check("leg h: silentMode is STILL absent (the demoted device's beat wrote nothing)", reread?.silentMode === undefined);
  check("leg h: silentProbeMs is STILL absent", reread?.silentProbeMs === undefined);
}

export async function legN(nowMs: number): Promise<void> {
  console.log("\nLeg n — DELETE /api/print-host's exact 3-call sequence: clearPrintHost -> prunePrintJobs -> dismissQueuedPrintJobsForClearedHost\n");
  await resetCollections();

  await designatePrintHost({ deviceId: "HOST-1", label: "Counter PC", setBy: "Admin" }, nowMs);

  // Several queued unclaimed jobs.
  const order1 = baseOrderFields({ _id: "order-n1", orderId: "ORD-N1" });
  const order2 = baseOrderFields({ _id: "order-n2", orderId: "ORD-N2" });
  const order3 = baseOrderFields({ _id: "order-n3", orderId: "ORD-N3" });
  const enq1 = await enqueuePrintJob({ ...billPrintJob(order1, { reprint: false }), queuedBy: "Staff" });
  const enq2 = await enqueuePrintJob({ ...billPrintJob(order2, { reprint: false }), queuedBy: "Staff" });
  const enq3 = await enqueuePrintJob({ ...billPrintJob(order3, { reprint: false }), queuedBy: "Staff" });
  if (enq1.outcome !== "queued" || enq2.outcome !== "queued" || enq3.outcome !== "queued") {
    throw new Error("leg n: setup enqueues did not all queue");
  }

  // One already-claimed job — must be untouched by the teardown.
  const orderClaimed = baseOrderFields({ _id: "order-n-claimed", orderId: "ORD-N-CLAIMED" });
  const enqClaimed = await enqueuePrintJob({ ...billPrintJob(orderClaimed, { reprint: false }), queuedBy: "Staff" });
  if (enqClaimed.outcome !== "queued") throw new Error("leg n: claimed-fixture enqueue did not queue");
  await PrintJob.findOneAndUpdate(
    { _id: enqClaimed.id },
    { $set: { status: "printed", claimedAt: new Date(nowMs), claimedBy: "HOST-1:tabA" } },
  );

  const unclaimedIds = [enq1.id, enq2.id, enq3.id];

  // The exact IN-ORDER sequence app/api/print-host/route.ts's DELETE runs.
  const { cleared } = await clearPrintHost();
  check("leg n: clearPrintHost() reports cleared:true", cleared === true);
  await prunePrintJobs(nowMs);
  const dismissedCount = await dismissQueuedPrintJobsForClearedHost("Staff");

  check("leg n: PrintHost count is 0 after the teardown", (await PrintHost.countDocuments({ key: PRINT_HOST_KEY })) === 0);

  const unclaimedDocs = await PrintJob.find({ _id: { $in: unclaimedIds } }).select("status dismissReason dismissedBy").lean();
  check(
    'leg n: every previously-queued-unclaimed job is now status:"dismissed"',
    unclaimedDocs.length === 3 && unclaimedDocs.every((d) => d.status === "dismissed"),
  );
  check(
    'leg n: every one carries dismissReason:"host-cleared"',
    unclaimedDocs.every((d) => d.dismissReason === "host-cleared"),
  );
  check("leg n: every one carries a stamped dismissedBy", unclaimedDocs.every((d) => typeof d.dismissedBy === "string" && d.dismissedBy.length > 0));

  const claimedDoc = await PrintJob.findById(enqClaimed.id).select("status").lean();
  check('leg n: the claimed job is UNTOUCHED — still "printed"', claimedDoc?.status === "printed");

  const state = await readPrintHostState(nowMs);
  check("leg n: readPrintHostState(nowMs).configured is false", state.configured === false);

  check("leg n: the returned dismissed count equals the number of unclaimed queued jobs (3)", dismissedCount === 3);
}
