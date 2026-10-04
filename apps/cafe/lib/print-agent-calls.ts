import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  PRINT_LEASE_HEADER,
  PRINT_READY_HEADER,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
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
 *  Session 2C (printers mode): `ready`, the printers that tab prints on, so a slip routed to one of them can be. */
export function printAgentHeaders(
  deviceId: string,
  bill = false,
  leaseTab: string | null = directPrintTab(),
  ready: readonly string[] = readyPrinterIds(),
): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
    ...(leaseTab !== null ? { [PRINT_LEASE_HEADER]: leaseTab } : {}),
    ...(leaseTab !== null && ready.length > 0 ? { [PRINT_READY_HEADER]: ready.join(",") } : {}),
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

/** The job an order answer made for one kind of slip, or null: then the call site enqueues it. Session 2C: a slip
 *  routed to several printers has a ref per printer; the one leased to this tab (at most one) must reach its agent,
 *  and each other one is printed by its own printer's writer. */
export function printJobRefOf(order: unknown, kind: PrintJobKind): PrintJobRef | null {
  const refs = (order as { printJobs?: unknown } | null | undefined)?.printJobs;
  if (!Array.isArray(refs)) return null;
  const ofKind = refs.filter((ref): ref is PrintJobRef => isPrintJobRef(ref) && ref.kind === kind);
  return ofKind.find((ref) => ref.leased !== undefined) ?? ofKind[0] ?? null;
}
