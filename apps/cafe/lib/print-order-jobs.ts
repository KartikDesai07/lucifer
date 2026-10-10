import { PRINT_HOST_KEY, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_BILL_PRINTER_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_LEASE_HEADER,
  PRINT_READY_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { printerIdsOf } from "@pos/shared/print-printers";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { announcesQueuedJob, printLineIsFree, printsDirectAtCreation, type PrintJobAskingTab } from "@/lib/print-direct";
import { insertPrintJob } from "@/lib/print-job-insert";
import { createRoutedPrintJobs, printPayloadProductIds } from "@/lib/print-printer-jobs";
import { printJobKeyOf } from "@/lib/print-queue";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
import { readPrintRouting } from "@/lib/print-routing-context";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";
import { opensWithToken, tokenPrintJob } from "@/lib/print-routing";
import { orderSkipsKitchen, roundSkipsKitchen, type KitchenFlagged, type KitchenRoundLine } from "@/lib/kitchen-lines";

// Printing redesign, Phase 1 Session 1B (spec §7.4): server-side job creation. An order route whose
// call site opts in (PRINT_AGENT_HEADER) creates, in the same request and right after its order write
// landed, the slips that call site would otherwise print itself. Simple mode (§6.6): the current host
// prints everything; with no host the asking device prints its own.
//
// Keys stay today's (printJobKeyOf): simple mode has one job per slip, so a server-made job and an old
// tab's enqueue of the same slip collide on the unique jobKey instead of printing twice. Printers mode
// (Session 2C, lib/print-printer-jobs.ts) adds each job's printer and part to the slip's key.
//
// createOrderPrintJobs NEVER throws: an order that landed must still answer success. A job that did
// not get made is covered by the repair sweep (print-repair.ts) for KOT rounds, and by the client's own
// enqueue of any slip its response did not name (Session 1C). Never calls connectDB(). No console.*.

export interface PrintIntent {
  /** The asking device (x-pos-device-id). With no host it prints its own slips (§6.6). */
  deviceId: string;
  /** PRINT_BILL_HEADER: this call site also prints the bill (Pay Now, the POS settle). */
  bill: boolean;
  /** Session 2B (PRINT_LEASE_HEADER, spec §7.11): the asking tab drains this device's slips and can print
   *  now, so a slip that prints on this device may be made already leased to it. */
  leaseTabId?: string;
  /** Session 2C (PRINT_READY_HEADER): the printers that tab can print on now (printers mode, decision 15). */
  readyPrinterIds?: string[];
  /** Session 2C (PRINT_BILL_PRINTER_HEADER, decision 7): this device's own bill printer. */
  billPrinterId?: string;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
 *  order write: the server then prints nothing, exactly as for a tab from before Phase 1. */
export function printIntentOf(req: Request): PrintIntent | null {
  if (req.headers.get(PRINT_AGENT_HEADER)?.trim() !== PRINT_HEADER_ON) return null;
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  const leaseTabId = req.headers.get(PRINT_LEASE_HEADER)?.trim() ?? "";
  const readyPrinterIds = printerIdsOf(req.headers.get(PRINT_READY_HEADER));
  const billPrinterId = printerIdsOf(req.headers.get(PRINT_BILL_PRINTER_HEADER))[0];
  return {
    deviceId,
    bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON,
    // An unusable tab id only means no direct print: the slips are made queued, as in Phase 1.
    ...(leaseTabId !== "" && leaseTabId.length <= PRINT_HOST_TAB_ID_MAX_CHARS ? { leaseTabId } : {}),
    // Unusable printer ids only mean fewer ready printers, or the default bill printer (Session 2C).
    ...(readyPrinterIds.length > 0 ? { readyPrinterIds } : {}),
    ...(billPrinterId !== undefined ? { billPrinterId } : {}),
  };
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
  | { kind: "token" }
  | { kind: "void" }
  | { kind: "moved"; meta: { from?: string; movedBy: string; movedAt: string } };

/** Kind order inside one request (§7.6 "KOT before bill"); creates run in this order, so createdAt does too. */
const SLIP_ORDER: Record<OrderPrintSlip["kind"], number> = { kot: 0, token: 1, void: 2, moved: 3, bill: 4 };

/** The slips a new round opens with: its KOT, then (round 1 of an order with a token number, S7) the
 *  customer's token slip. The ONE list for every round-opening job site (order create, request accept,
 *  the self-order kot-claim), so the token can never print with one and not another. */
export function openingSlipsOf(order: unknown, round: number): OrderPrintSlip[] {
  const kot: OrderPrintSlip = { kind: "kot", round };
  const tokenOf = typeof order === "object" && order !== null ? (order as { tokenNumber?: unknown }) : {};
  return opensWithToken(tokenOf, round) ? [kot, { kind: "token" }] : [kot];
}

/** Skip-KOT: the slips that still make sense for this order. A KOT whose round has only no-kitchen lines, a
 *  void slip for a no-kitchen line (the newest void entry, the one this request pushed) and a moved slip
 *  for an order whose every fired line skips the kitchen are dropped; the token and the bill never are.
 *  The SAME array comes back when nothing is dropped, so an ordinary order is untouched. */
export function kitchenSlipsOf(
  order: { items: readonly KitchenRoundLine[]; voids?: readonly KitchenFlagged[] },
  slips: OrderPrintSlip[],
): OrderPrintSlip[] {
  const kept = slips.filter((slip) => {
    switch (slip.kind) {
      case "kot":
        return !roundSkipsKitchen(order.items, slip.round);
      case "void":
        return order.voids?.at(-1)?.noKot !== true;
      case "moved":
        return !orderSkipsKitchen(order);
      case "bill":
      case "token":
        return true;
    }
  });
  return kept.length === slips.length ? slips : kept;
}

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
      case "token":
        return tokenPrintJob(order, { reprint: false });
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

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1.
 *  Session 2B (spec §7.11, decisions 15 and 16): when the slips print on the asking device and its draining
 *  tab can print now (`leaseTabId`), the first one is made leased to that tab if nothing older waits on its
 *  line; the rest follow it through the ack's `more`, so none of them is announced to the device printing.
 *  Session 2C (spec §8): in printers mode every slip is routed to printers (lib/print-printer-jobs.ts), the
 *  host plays no part, and the same rules apply per printer line.
 *  The token fix (print-direct.ts): a token is never the slip made leased; it is made queued, and the asking tab
 *  leases it from the answer (or the KOT ack's `more`). */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only when no device asked (the public auto-accept, from Session 1C: final review C1). */
  originDeviceId?: string;
  leaseTabId?: string;
  readyPrinterIds?: string[];
  billPrinterId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  const refs: PrintJobRef[] = [];
  if (input.slips.length === 0) return refs;
  try {
    const order = wireOrderOf(input.order);
    const wanted = kitchenSlipsOf(order, input.slips);
    if (wanted.length === 0) return refs;
    const slips = [...wanted].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    const requests = slips.map((slip) => requestOf(order, slip)).filter((request): request is PrintJobRequest => request !== null);
    // One small read in simple mode (spec §6.6); printers mode adds the stations of these slips' lines.
    const routing = await readPrintRouting({
      productIds: requests.flatMap((request) => printPayloadProductIds(request.payload)),
      ...(input.billPrinterId !== undefined ? { billPrinterId: input.billPrinterId } : {}),
      nowMs: input.nowMs,
    });
    if (routing !== null) {
      const { jobs } = await createRoutedPrintJobs({
        routing,
        requests,
        baseKeyOf: (request) => printJobKeyOf(request.payload),
        originDeviceId: input.originDeviceId,
        leaseTabId: input.leaseTabId,
        readyPrinterIds: input.readyPrinterIds,
        queuedBy: input.queuedBy,
        nowMs: input.nowMs,
      });
      return jobs.map((job) => job.ref);
    }
    const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
    // With neither a host nor an asking device nothing is made: the self-order kot-claim lane prints it.
    const target = host?.deviceId ?? input.originDeviceId;
    if (target === undefined) return refs;
    // The asking tab counts only when the slips print on its own device (the host's own order, or no host).
    const leaseTabId = target === input.originDeviceId ? input.leaseTabId : undefined;
    const lineFree = leaseTabId !== undefined && (await printLineIsFree(target, input.nowMs));
    let directOnLine = false;
    let made = 0;
    for (const request of requests) {
      // Only the first slip of this request on the line may be leased now (§7.6: one writer, oldest first);
      // the rest are made as in Phase 1, so a collision on them never reads a payload (the 2B review, M-1).
      // The token fix (print-direct.ts): a token is never made leased; still the asking tab's, it leases it from the
      // answer, so nothing on the line is announced to it (decision 16).
      const tokenForTab = leaseTabId !== undefined && refs.length === 0 && !printsDirectAtCreation(request.payload.kind);
      const tab = leaseTabId === undefined || refs.length > 0 || tokenForTab ? {} : { tab: { tabId: leaseTabId, direct: lineFree } };
      const job = await insertPrintJob({ request, targetDeviceId: target, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, ...tab, nowMs: input.nowMs });
      if (job === null) continue;
      refs.push(job.ref);
      if (job.ref.leased !== undefined || tokenForTab) directOnLine = true;
      if (announcesQueuedJob(job, directOnLine)) {
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
 *  key rules as enqueuePrintJob, so a retried POST is one job. Session 2B: `tab` as in insertPrintJob. */
export async function enqueueOwnPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId: string;
  tab?: PrintJobAskingTab;
  nowMs: number;
}): Promise<PrintJobEnqueueResult> {
  const jobKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const job = await insertPrintJob({
    request: { payload: input.payload, label: input.label },
    targetDeviceId: input.originDeviceId,
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    ...(jobKey !== undefined ? { jobKey } : {}),
    ...(input.tab !== undefined ? { tab: input.tab } : {}),
    nowMs: input.nowMs,
  });
  if (job === null) return { outcome: "too-large" };
  // Session 2B: leased to the asking tab (made so now, or still so from a send whose answer was lost): it
  // prints there at once, and nothing is announced to the device that is printing it.
  if (job.ref.leased !== undefined) return { outcome: "queued", id: job.ref.id, duplicate: !job.created, leased: job.ref.leased };
  // A resolved job under this key already printed (or was dismissed): never report it as fresh.
  if (!job.created && job.status !== "queued") return { outcome: "already-resolved", id: job.ref.id };
  if (job.created) publishPrintStatus({ id: job.ref.id, status: "queued", target: input.originDeviceId });
  return { outcome: "queued", id: job.ref.id, duplicate: !job.created };
}

/** POST /api/print-jobs from the tab that drains the asking device's slips and can print now (Session 2B,
 *  spec §7.11). When the slip prints on the asking device (no host, or the asking device is the host), it is
 *  made leased to that tab if nothing older waits on its line, and a slip still leased to that tab (its first
 *  answer was lost) is handed back. null: another device is the host, so Phase 1's enqueue makes it for it; or the
 *  slip is a token, never made leased at creation (the token fix, print-direct.ts), so Phase 1's enqueue makes it
 *  queued (for the host, else this device's own) and the asking tab leases it from the answer. */
export async function enqueueDirectPrintJob(
  input: Omit<Parameters<typeof enqueueOwnPrintJob>[0], "tab"> & { leaseTabId: string },
): Promise<PrintJobEnqueueResult | null> {
  if (!printsDirectAtCreation(input.payload.kind)) return null;
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  if (host !== null && host.deviceId !== input.originDeviceId) return null;
  const { leaseTabId, ...own } = input;
  return enqueueOwnPrintJob({ ...own, tab: { tabId: leaseTabId, direct: await printLineIsFree(input.originDeviceId, input.nowMs) } });
}

/** A route's answer: the order exactly as before, plus `printJobs` when the request opted in. */
export function withPrintJobs<T>(order: T, printJobs: PrintJobRef[] | null): T | (Order & { printJobs: PrintJobRef[] }) {
  return printJobs === null ? order : { ...wireOrderOf(order), printJobs };
}
