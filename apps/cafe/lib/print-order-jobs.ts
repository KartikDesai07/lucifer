import { isDuplicateKeyError } from "@pos/shared/api";
import {
  PRINT_HOST_KEY,
  printJobPayloadWithinCap,
  type PrintJobEnqueueResult,
  type PrintJobStatus,
} from "@pos/shared/print-job";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";

// Printing redesign, Phase 1 Session 1B (spec §7.4): server-side job creation. An order route whose
// call site opts in (PRINT_AGENT_HEADER) creates, in the same request and right after its order write
// landed, the slips that call site would otherwise print itself. Simple mode (§6.6): the current host
// prints everything; with no host the asking device prints its own.
//
// Keys stay today's (printJobKeyOf): simple mode has one job per slip, so a server-made job and an old
// tab's enqueue of the same slip collide on the unique jobKey instead of printing twice. The printer
// and copy parts of spec §6.5's key arrive with Phase 2 printers.
//
// createOrderPrintJobs NEVER throws: an order that landed must still answer success. A job that did
// not get made is covered by the repair sweep (print-repair.ts) for KOT rounds, and by the client's own
// enqueue of any slip its response did not name (Session 1C). Never calls connectDB(). No console.*.

export interface PrintIntent {
  /** The asking device (x-pos-device-id). With no host it prints its own slips (§6.6). */
  deviceId: string;
  /** PRINT_BILL_HEADER: this call site also prints the bill (Pay Now, the POS settle). */
  bill: boolean;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
 *  order write: the server then prints nothing, exactly as for a tab from before Phase 1. */
export function printIntentOf(req: Request): PrintIntent | null {
  if (req.headers.get(PRINT_AGENT_HEADER)?.trim() !== PRINT_HEADER_ON) return null;
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  return { deviceId, bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON };
}

/** The tab's kotPrintDevices after firing `round` for `deviceId`. Positional, the kotIdemKeys idiom:
 *  index round-1 gets the device, earlier slots keep their own or "" (printed by its tab). No device →
 *  undefined, so the route writes nothing (omit-empty). */
export function buildKotPrintDevices(
  old: readonly string[] | undefined,
  round: number,
  deviceId: string | undefined,
): string[] | undefined {
  if (!deviceId) return undefined;
  return Array.from({ length: round }, (_, i) => (i === round - 1 ? deviceId : (old?.[i] ?? "")));
}

/** One slip an order request asks for. "void" is the newest entry of the order's void trail, the one
 *  this request pushed. */
export type OrderPrintSlip =
  | { kind: "kot"; round: number }
  | { kind: "bill" }
  | { kind: "void" }
  | { kind: "moved"; meta: { from?: string; movedBy: string; movedAt: string } };

const UNNAMED_STAFF = "Staff";

/** Kind order inside one request (§7.6 "KOT before bill"); creates run in this order, so createdAt does too. */
const SLIP_ORDER: Record<OrderPrintSlip["kind"], number> = { kot: 0, void: 1, moved: 2, bill: 3 };

/** A lean or hydrated Order as the wire Order the client builders read: through JSON, exactly as the
 *  response sends it, so a server-made slip is the slip the device would have built (§7.4). */
export function wireOrderOf(order: unknown): Order {
  return JSON.parse(JSON.stringify(order)) as Order;
}

function requestOf(order: Order, slip: OrderPrintSlip): PrintJobRequest | null {
  try {
    switch (slip.kind) {
      case "kot":
        return kotPrintJob(order, slip.round);
      case "bill":
        return billPrintJob(order, { reprint: false });
      case "void": {
        const entry = order.voids?.at(-1);
        return entry === undefined ? null : voidPrintJob(order, entry, { reprint: false });
      }
      case "moved":
        return movedPrintJob(order, slip.meta, { reprint: false });
    }
  } catch {
    // An order the snapshot cannot read (deploy skew): nothing to create.
    return null;
  }
}

/** One job made, or the one its key already names (a racing replay, an old tab's enqueue, a repair). */
export interface InsertedPrintJob {
  ref: PrintJobRef;
  created: boolean;
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws. */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  targetDeviceId: string;
  originDeviceId?: string;
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`. */
  jobKey?: string;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
  if (!parsed.success) return null;
  const payload: PrintJobPayload = parsed.data;
  const json = JSON.stringify(payload);
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
      payload: json,
      label: input.request.label,
      // A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
      queuedBy: input.queuedBy.trim() || UNNAMED_STAFF,
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      targetDeviceId: input.targetDeviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      ...printJobLifecycleInit(input.nowMs, printJobInitialLabels(payload)),
      log: [printJobCreatedLog(input.nowMs, input.originDeviceId)],
    });
    const ref: PrintJobRef = { id: String(created._id), kind: payload.kind, targetDeviceId: input.targetDeviceId, label: input.request.label };
    return { ref, created: true, status: "queued" };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey }).select("kind status label targetDeviceId").lean();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
    };
    return { ref, created: false, status: existing.status };
  }
}

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only for the public auto-accept: no device asked. */
  originDeviceId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  const refs: PrintJobRef[] = [];
  if (input.slips.length === 0) return refs;
  try {
    const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
    // With neither a host nor an asking device nothing is made: the self-order kot-claim lane prints it.
    const target = host?.deviceId ?? input.originDeviceId;
    if (target === undefined) return refs;
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    let made = 0;
    for (const slip of slips) {
      const request = requestOf(order, slip);
      if (request === null) continue;
      const job = await insertPrintJob({ request, targetDeviceId: target, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, nowMs: input.nowMs });
      if (job === null) continue;
      refs.push(job.ref);
      if (job.created) {
        made += 1;
        publishPrintStatus({ id: job.ref.id, status: "queued", target });
      }
    }
    if (made > 0 && host !== null) publishCafeEvent("print-job");
  } catch {
    // Never fails the order write that landed: the repair sweep or the client's own enqueue covers it.
  }
  return refs;
}

/** POST /api/print-jobs with no host, from an agent tab (spec §6.6): the asking device prints its own
 *  client-started slip (a reprint, End of day, a cancel notice) through the lifecycle, under the same
 *  key rules as enqueuePrintJob, so a retried POST is one job. */
export async function enqueueOwnPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId: string;
  nowMs: number;
}): Promise<PrintJobEnqueueResult> {
  const jobKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const job = await insertPrintJob({
    request: { payload: input.payload, label: input.label },
    targetDeviceId: input.originDeviceId,
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    ...(jobKey !== undefined ? { jobKey } : {}),
    nowMs: input.nowMs,
  });
  if (job === null) return { outcome: "too-large" };
  // A resolved job under this key already printed (or was dismissed): never report it as fresh.
  if (!job.created && job.status !== "queued") return { outcome: "already-resolved", id: job.ref.id };
  if (job.created) publishPrintStatus({ id: job.ref.id, status: "queued", target: input.originDeviceId });
  return { outcome: "queued", id: job.ref.id, duplicate: !job.created };
}

/** A route's answer: the order exactly as before, plus `printJobs` when the request opted in. */
export function withPrintJobs<T>(order: T, printJobs: PrintJobRef[] | null): T | (Order & { printJobs: PrintJobRef[] }) {
  return printJobs === null ? order : { ...wireOrderOf(order), printJobs };
}
