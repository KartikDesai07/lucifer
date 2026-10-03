/**
 * Phase 1 Session 1D live leg — the one waiting-slips panel's feed (af), against a REAL MongoDB: which
 * rows every device's pulse carries, in what order, and how it is bounded. Session 1E leg (ag): the
 * owner's retention after Session 1D (waiting slips 3 h unless acted on lately, finished slips 45 min,
 * device rows unseen for 7 days). Run by scripts/verify-print-host-live.ts after legs ad–ae.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_JOB_QUEUED_RETENTION_MS, PRINT_JOB_RESOLVED_RETENTION_MS } from "@pos/shared/print-job";
import { PRINT_DEVICE_PRUNE_MS, PRINT_KOT_ALARM_MS } from "@pos/shared/print-lifecycle";
import { PrintDevice } from "@/models/PrintDevice";
import { PrintJob } from "@/models/PrintJob";
import { printAttentionFilter, readPrintAttention } from "@/lib/print-attention";
import { prunePrintJobs } from "@/lib/print-queue";
import { backdatePrintJob, check } from "./harness";
import { HOST, freshHost, lease, queueBill, queueKot, setRaw } from "./lifecycle";

const MIN = 60_000;

export async function legAF(nowMs: number): Promise<void> {
  console.log("\n(af) the waiting-slips feed: what waits for a person, cafe-wide, bounded");
  await freshHost(nowMs);
  const fresh = await queueKot(nowMs);
  const waiting = await queueKot(nowMs);
  await backdatePrintJob(waiting, new Date(nowMs - PRINT_KOT_ALARM_MS - 5_000));
  await setRaw(waiting, { lastError: "The printer is not connected.", originDeviceId: "phone-1" });
  const bill = await queueBill(nowMs);
  await setRaw(bill, { status: "needs-confirm" });
  const failed = await queueKot(nowMs);
  await setRaw(failed, { status: "failed", lastError: "This slip is too long to print." });
  const printed = await queueKot(nowMs);
  await backdatePrintJob(printed, new Date(nowMs - 60_000));
  await setRaw(printed, { status: "printed" });
  const old = await queueKot(nowMs);
  await backdatePrintJob(old, new Date(nowMs - PRINT_ATTENTION_WINDOW_MS - 60_000));
  await setRaw(old, { status: "failed" });

  let feed = await readPrintAttention(nowMs);
  const ids = feed.rows.map((row) => row.id);
  check("(af) a slip made just now is not waiting yet (it has 20 s to print)", !ids.includes(fresh));
  check("(af) a slip still queued after 20 s waits, with why and who asked", ids.includes(waiting) && feed.rows.find((r) => r.id === waiting)?.lastError === "The printer is not connected." && feed.rows.find((r) => r.id === waiting)?.originDeviceId === "phone-1");
  check("(af) a bill to check and a slip that could not print wait too, with where they print", ids.includes(bill) && ids.includes(failed) && feed.rows.find((r) => r.id === failed)?.targetDeviceId === HOST);
  check("(af) a printed slip and one older than the queued retention (3 h) never show", !ids.includes(printed) && !ids.includes(old));
  check("(af) the oldest waits first", ids[0] === waiting);

  // A slip being printed right now waits for nobody.
  await backdatePrintJob(fresh, new Date(nowMs - PRINT_KOT_ALARM_MS - 1_000));
  await PrintJob.updateMany({ _id: { $in: [waiting] } }, { $set: { status: "dismissed" } });
  const leased = await lease(nowMs);
  feed = await readPrintAttention(nowMs);
  check("(af) a leased slip leaves the feed while it prints", leased.jobs[0]?.id === fresh && !feed.rows.some((r) => r.id === fresh));

  // Bounded: one read of at most PRINT_ATTENTION_LIMIT rows, and it says when it was cut.
  const backlog: string[] = [];
  for (let i = 0; i < PRINT_ATTENTION_LIMIT + 1; i++) {
    const id = await queueKot(nowMs);
    await backdatePrintJob(id, new Date(nowMs - 10 * MIN + i * 1_000));
    await setRaw(id, { status: "failed" });
    backlog.push(id);
  }
  feed = await readPrintAttention(nowMs);
  check("(af) a long backlog is cut at the limit and says so", feed.rows.length === PRINT_ATTENTION_LIMIT && feed.truncated);

  // Owner, after Session 1D (I-1 option A): a new problem always shows, however long the backlog.
  const newest = await queueKot(nowMs);
  await setRaw(newest, { status: "failed" });
  feed = await readPrintAttention(nowMs);
  const after = feed.rows.map((row) => row.id);
  check("(af) a new failure behind a full backlog still shows (the newest rows are read)", after.includes(newest) && feed.truncated);
  check("(af) the rows are still shown oldest first: the new failure is last", after[after.length - 1] === newest);
  check("(af) the oldest of the backlog is the one left to the count", !after.includes(backlog[0] ?? ""));
  check("(af) oldest first throughout", feed.rows.every((row, i) => i === 0 || Date.parse(feed.rows[i - 1]?.createdAt ?? "") <= Date.parse(row.createdAt)));

  // The Phase 1 final gate (M5): exactly the limit waiting is all of them, not "20+" (the read takes one row more
  // than it shows, so a cut is a real cut).
  const all = await PrintJob.find(printAttentionFilter(nowMs)).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
  for (const row of all.slice(0, all.length - PRINT_ATTENTION_LIMIT)) await setRaw(String(row._id), { status: "dismissed" });
  feed = await readPrintAttention(nowMs);
  check("(af) exactly the limit waiting: every one shown, and not cut (final gate M5)", feed.rows.length === PRINT_ATTENTION_LIMIT && !feed.truncated);
}

export async function legAG(nowMs: number): Promise<void> {
  console.log("\n(ag) retention (owner, after Session 1D): waiting 3 h unless acted on lately, finished 45 min, devices 7 days");
  await freshHost(nowMs);
  const pastWaiting = new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS - MIN);
  const unattended = await queueKot(nowMs);
  await backdatePrintJob(unattended, pastWaiting);
  const tappedLately = await queueKot(nowMs);
  await backdatePrintJob(tappedLately, pastWaiting);
  await setRaw(tappedLately, { approvedAt: new Date(nowMs - MIN) });
  const tappedLongAgo = await queueKot(nowMs);
  await backdatePrintJob(tappedLongAgo, pastWaiting);
  await setRaw(tappedLongAgo, { status: "failed", approvedAt: new Date(nowMs - 20 * MIN) });
  const printingNow = await queueKot(nowMs);
  await backdatePrintJob(printingNow, pastWaiting);
  await setRaw(printingNow, { status: "leased", lease: { deviceId: HOST, tabId: "tab-a", epoch: 1, expiresAt: new Date(nowMs + MIN) } });
  const billInWindow = await queueBill(nowMs);
  await backdatePrintJob(billInWindow, new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS + MIN));
  await setRaw(billInWindow, { status: "needs-confirm" });
  const printedOld = await queueKot(nowMs);
  await backdatePrintJob(printedOld, new Date(nowMs - PRINT_JOB_RESOLVED_RETENTION_MS - MIN));
  await setRaw(printedOld, { status: "printed" });
  const printedYoung = await queueKot(nowMs);
  await backdatePrintJob(printedYoung, new Date(nowMs - PRINT_JOB_RESOLVED_RETENTION_MS + MIN));
  await setRaw(printedYoung, { status: "printed" });
  const dismissedOld = await queueKot(nowMs);
  await backdatePrintJob(dismissedOld, new Date(nowMs - PRINT_JOB_RESOLVED_RETENTION_MS - MIN));
  await setRaw(dismissedOld, { status: "dismissed" });
  const device = (id: string, lastSeenAt: Date) => ({
    deviceId: id,
    label: id,
    shell: "android",
    capabilities: { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false },
    lastSeenAt,
    createdAt: lastSeenAt,
    updatedAt: lastSeenAt,
  });
  await PrintDevice.collection.insertMany([
    device("gone-device", new Date(nowMs - PRINT_DEVICE_PRUNE_MS - MIN)),
    device("away-device", new Date(nowMs - PRINT_DEVICE_PRUNE_MS + 60 * MIN)),
  ]);

  const feed = await readPrintAttention(nowMs);
  check("(ag) the feed shows a bill to check made just inside the 3 h window", feed.rows.some((row) => row.id === billInWindow));

  await prunePrintJobs(nowMs);
  const left = new Set((await PrintJob.find({}).select("_id").lean()).map((row) => String(row._id)));
  check("(ag) a waiting slip nobody acted on for 3 h is deleted", !left.has(unattended));
  check("(ag) one staff tapped a minute ago gets its try (kept)", left.has(tappedLately));
  check("(ag) one tapped 20 min ago that still has not printed is deleted", !left.has(tappedLongAgo));
  check("(ag) one being printed right now is never deleted mid-print", left.has(printingNow));
  check("(ag) a waiting slip inside the 3 h window stays", left.has(billInWindow));
  check("(ag) finished slips older than 45 min are deleted (printed and dismissed)", !left.has(printedOld) && !left.has(dismissedOld));
  check("(ag) a finished slip younger than 45 min stays (the KOT repair window is 30 min)", left.has(printedYoung));
  const devices = new Set((await PrintDevice.find({}).select("deviceId").lean()).map((row) => row.deviceId));
  check("(ag) a device row not seen for 7 days is deleted; one seen within them stays", !devices.has("gone-device") && devices.has("away-device"));
}
