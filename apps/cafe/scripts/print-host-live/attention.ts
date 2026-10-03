/**
 * Phase 1 Session 1D live leg — the one waiting-slips panel's feed (af), against a REAL MongoDB: which
 * rows every device's pulse carries, in what order, and how it is bounded. Run by
 * scripts/verify-print-host-live.ts after legs ad–ae.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_KOT_ALARM_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { readPrintAttention } from "@/lib/print-attention";
import { backdatePrintJob, check } from "./harness";
import { HOST, freshHost, lease, queueBill, queueKot, setRaw } from "./lifecycle";

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
  check("(af) a printed slip and one older than the queued retention never show", !ids.includes(printed) && !ids.includes(old));
  check("(af) the oldest waits first", ids[0] === waiting);

  // A slip being printed right now waits for nobody.
  await backdatePrintJob(fresh, new Date(nowMs - PRINT_KOT_ALARM_MS - 1_000));
  await PrintJob.updateMany({ _id: { $in: [waiting] } }, { $set: { status: "dismissed" } });
  const leased = await lease(nowMs);
  feed = await readPrintAttention(nowMs);
  check("(af) a leased slip leaves the feed while it prints", leased.jobs[0]?.id === fresh && !feed.rows.some((r) => r.id === fresh));

  // Bounded: one read of at most PRINT_ATTENTION_LIMIT rows, and it says when it was cut.
  for (let i = 0; i < PRINT_ATTENTION_LIMIT + 1; i++) {
    const id = await queueKot(nowMs);
    await setRaw(id, { status: "failed" });
  }
  feed = await readPrintAttention(nowMs);
  check("(af) a long backlog is cut at the limit and says so", feed.rows.length === PRINT_ATTENTION_LIMIT && feed.truncated);
}
