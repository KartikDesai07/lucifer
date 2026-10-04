import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_BILL_PRINTER_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  PRINT_LEASE_HEADER,
  PRINT_READY_HEADER,
  type LeasedPrintJob,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { readBillPrinterId } from "@/lib/print-bill-printer";
import { directPrintTab, readyPrinterIds } from "@/lib/print-agent-seams";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
// the agent. An order request whose call site prints its slips says so (R1's headers), and the server
// makes those slips in the same request; the answer names each job (`printJobs`). The call site then
// follows that job and never prints the slip itself. A slip the answer did not name (a replay, a
// failed create) is enqueued by the call site under today's job key, so it is still one job.

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. Session 2B (spec §7.11): `leaseTab`, this tab while
 *  it drains this device's slips and can print now, lets a slip this device prints be made leased to it.
 *  Session 2C (printers mode): `ready`, the printers that tab prints on, so a slip routed to one of them can be.
 *  Session 2D (decision 7): `billPrinter`, this device's own bill printer, for its bills and End of day. */
export function printAgentHeaders(
  deviceId: string,
  bill = false,
  leaseTab: string | null = directPrintTab(),
  ready: readonly string[] = readyPrinterIds(),
  billPrinter: string | null = readBillPrinterId(),
): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
    ...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),
    ...(leaseTab !== null && ready.length > 0 ? { [PRINT_READY_HEADER]: ready.join(",") } : {}),
    ...(billPrinter !== null ? { [PRINT_BILL_PRINTER_HEADER]: billPrinter } : {}),
  };
}

/** apiSend's options for an order request whose call site prints the slips it makes. */
export function printAgentRequestOptions(bill = false): { headers?: Record<string, string> } {
  const headers = printAgentHeaders(readDeviceId(), bill);
  return Object.keys(headers).length === 0 ? {} : { headers };
}

/** A client-started print (POST /api/print-jobs) from an agent: the opt-in, so with no host the job is
 *  this device's own (1B enqueueOwnPrintJob), plus an Idempotency-Key, so a keyless repeat (a reprint,
 *  End of day, a cancel notice) is one job even if its POST is sent twice (spec §6.5). */
export function printAgentEnqueueHeaders(deviceId: string): Record<string, string> {
  const key = mintTabId();
  return { ...printAgentHeaders(deviceId), ...(PRINT_IDEMPOTENCY_KEY_PATTERN.test(key) ? { [PRINT_IDEMPOTENCY_HEADER]: key } : {}) };
}

function isPrintJobRef(value: unknown): value is PrintJobRef {
  const ref = value as Partial<PrintJobRef> | null;
  return typeof ref === "object" && ref !== null && typeof ref.id === "string" && typeof ref.kind === "string" && typeof ref.status === "string";
}

/** Session 2E (spec §9.2): the ref a call site follows, and every other job of that slip leased to this tab. */
export type FollowedPrintJobRef = PrintJobRef & { alsoLeased?: LeasedPrintJob[] };

/** Session 2E (spec §9.2, decision 15): the jobs of one slip an answer leased to this tab, each once. A slip routed to
 *  several printers this device prints is leased once per printer line (the first slip of each line). */
export function leasedJobsOf(refs: readonly { leased?: LeasedPrintJob }[]): LeasedPrintJob[] {
  const out: LeasedPrintJob[] = [];
  for (const ref of refs) {
    const job = ref.leased;
    if (job !== undefined && !out.some((seen) => seen.id === job.id && seen.epoch === job.epoch)) out.push(job);
  }
  return out;
}

/** The job an order answer made for one kind of slip, or null: then the call site enqueues it. Session 2C: a slip
 *  routed to several printers has a ref per printer; the one leased to this tab must reach its agent, and each other
 *  one is printed by its own printer's writer. Session 2E: with several printers on this device, the slip's other jobs
 *  leased to this tab ride beside it (alsoLeased), and each reaches the agent too. */
export function printJobRefOf(order: unknown, kind: PrintJobKind): FollowedPrintJobRef | null {
  const refs = (order as { printJobs?: unknown } | null | undefined)?.printJobs;
  if (!Array.isArray(refs)) return null;
  const ofKind = refs.filter((ref): ref is PrintJobRef => isPrintJobRef(ref) && ref.kind === kind);
  const chosen = ofKind.find((ref) => ref.leased !== undefined) ?? ofKind[0] ?? null;
  if (chosen === null) return null;
  const alsoLeased = leasedJobsOf(ofKind.filter((ref) => ref !== chosen));
  return alsoLeased.length === 0 ? chosen : { ...chosen, alsoLeased };
}
