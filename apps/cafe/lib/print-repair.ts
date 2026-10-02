import { PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { PRINT_REPAIR_WINDOW_MS } from "@pos/shared/print-lifecycle";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { createOrderPrintJobs } from "./print-order-jobs";

// Printing redesign, Phase 1 Session 1B (spec §7.4, sweep step 2): the repair. A request can die
// between its order write and its job create (a timeout, a crash), or its create can fail. For a KOT
// round the SERVER owns (Order.kotPrintDevices, written by the same order CAS), a missing job is
// re-created with the same key, so a racing create is a no-op and the slip never prints twice. A
// round its tab printed itself ("" or no marker) is never touched. Bills, voids and moves are not
// repaired: the cashier is at the counter, and the client re-sends any slip its answer did not name
// (Session 1C). Never calls connectDB(). No console.*.

/** Each sweep reads at most this many orders, newest first. It covers a rush's half hour (a busy day's
 *  average at 4x, twice over: print-repair.test.ts), because most candidates already have their jobs
 *  and a smaller batch would never reach an older tab's missing round in time (final review I1). */
export const PRINT_REPAIR_BATCH = 100;
/** The name a repaired job is queued under (PrintJob.queuedBy). */
export const PRINT_REPAIR_ACTOR = "Repair";

interface RepairCandidate {
  _id: unknown;
  createdAt: Date;
  kotRounds?: number;
  kotFiredAt?: Date[];
  kotPrintDevices?: string[];
  items: Array<{ kotRound?: number }>;
}

export interface MissingKotJob {
  orderId: string;
  round: number;
  deviceId: string;
  jobKey: string;
}

/** Pure: the server-owned rounds of these orders that fired inside the repair window and still have
 *  lines, each with the jobKey its job carries (printJobKeyOf's KOT key; print-order-jobs.test.ts pins
 *  the two together). A wholly voided round has nothing to print. */
export function expectedKotJobs(orders: readonly RepairCandidate[], nowMs: number): MissingKotJob[] {
  const since = nowMs - PRINT_REPAIR_WINDOW_MS;
  const out: MissingKotJob[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    for (let round = 1; round <= (order.kotRounds ?? 0); round++) {
      const deviceId = order.kotPrintDevices?.[round - 1] ?? "";
      if (deviceId === "") continue;
      // Round 1 of a new order carries no kotFiredAt slot: it fired when the order was created.
      const firedAt = order.kotFiredAt?.[round - 1] ?? order.createdAt;
      if (firedAt.getTime() < since) continue;
      if (!order.items.some((item) => item.kotRound === round)) continue;
      out.push({ orderId, round, deviceId, jobKey: `kot:${orderId}:${round}` });
    }
  }
  return out;
}

/** Re-creates the missing jobs of server-owned KOT rounds fired in the last 30 min. Returns how many it
 *  made. Indexed on createdAt; a tab older than the queued retention is past saving anyway. */
export async function repairMissingKotJobs(nowMs: number): Promise<number> {
  const since = new Date(nowMs - PRINT_REPAIR_WINDOW_MS);
  const candidates = await Order.find({
    createdAt: { $gte: new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS) },
    status: { $ne: "Cancelled" },
    kotPrintDevices: { $exists: true },
    $or: [{ createdAt: { $gte: since } }, { kotFiredAt: { $elemMatch: { $gte: since } } }],
  })
    .select("_id createdAt kotRounds kotFiredAt kotPrintDevices items.kotRound")
    .sort({ createdAt: -1 })
    .limit(PRINT_REPAIR_BATCH)
    .lean<RepairCandidate[]>();
  const expected = expectedKotJobs(candidates, nowMs);
  if (expected.length === 0) return 0;
  const present = await PrintJob.find({ jobKey: { $in: expected.map((job) => job.jobKey) } })
    .select("jobKey")
    .lean<Array<{ jobKey?: string }>>();
  const have = new Set(present.map((row) => row.jobKey));
  let repaired = 0;
  for (const missing of expected) {
    if (have.has(missing.jobKey)) continue;
    const order = await Order.findById(missing.orderId).lean();
    if (order === null) continue;
    const refs = await createOrderPrintJobs({
      order,
      slips: [{ kind: "kot", round: missing.round }],
      originDeviceId: missing.deviceId,
      queuedBy: PRINT_REPAIR_ACTOR,
      nowMs,
    });
    repaired += refs.length;
  }
  return repaired;
}
