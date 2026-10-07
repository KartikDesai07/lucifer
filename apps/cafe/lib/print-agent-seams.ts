import { PRINT_HEADER_ON, PRINT_PULSE_TOKENS_PARAM, type LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { PrinterHealthReport } from "@pos/shared/print-failover";

// Printing redesign: the in-page print agent's module seams (client-only, never throw). The call sites and the
// pulse reach this page's one agent through them, with no React context: an order answer that named a job (a
// kick), the agent naming itself on the pulse, and since Phase 2 Session 2B (spec §7.11) the tab that can print
// its own slips at once and the leased jobs its answers carry. Split out of print-agent.ts at the 2A review gate
// to keep that file near its ~300-line budget; print-agent.ts re-exports every name.

const kickListeners = new Set<(printerId?: string) => void>();

/** An order answer named a job this device prints: lease it now, no poll (spec §9.1). The 2E review gate (M-1): with
 *  its printer, so a job on a printer this tab does not lease now leases nothing. */
export function kickPrintAgent(printerId?: string): void {
  for (const listener of [...kickListeners]) listener(printerId);
}

export function onPrintAgentKick(listener: (printerId?: string) => void): () => void {
  kickListeners.add(listener);
  return () => void kickListeners.delete(listener);
}

let pulseDevice: string | null = null;

/** The agent with no host names itself on the existing 20 s pulse (?device=), so a job the server
 *  re-queued or sent home reaches it within one tick even with the socket down. Not the host: it polls
 *  the wake, which answers the same. */
export function setPulsePrintDevice(deviceId: string | null): void {
  pulseDevice = deviceId;
}

/** Session 3B (the token fix's M-2): the agent also says it prints token slips (&tokens=1), so the pulse counts them. */
export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}&${PRINT_PULSE_TOKENS_PARAM}=${PRINT_HEADER_ON}`;
}

let healthSource: (() => PrinterHealthReport[]) | null = null;

/** Session 3B (spec §10): the agent registers how it reads the health of the printers it prints here, for the wake's
 *  beat. The returned function unregisters it, unless another agent registered since. */
export function setPrinterHealthSource(source: () => PrinterHealthReport[]): () => void {
  healthSource = source;
  return () => {
    if (healthSource === source) healthSource = null;
  };
}

/** The health the wake's beat carries; [] with no agent. */
export function printerHealthReports(): PrinterHealthReport[] {
  try {
    return healthSource?.() ?? [];
  } catch {
    return [];
  }
}

let takenOver: readonly string[] = [];
const takenOverListeners = new Set<() => void>();

/** Session 3B (spec §9.3): the network printers the wake says this device writes now for another device (taken over while
 *  their primary is offline or cannot reach them), so its top-bar dot counts them while it writes them. */
export function setTakenOverPrinters(ids: readonly string[]): void {
  if (ids.join(",") === takenOver.join(",")) return;
  takenOver = [...ids];
  for (const listener of [...takenOverListeners]) listener();
}

export function takenOverPrinterIds(): readonly string[] {
  return takenOver;
}

export function onTakenOverChange(listener: () => void): () => void {
  takenOverListeners.add(listener);
  return () => void takenOverListeners.delete(listener);
}

const writing = new Map<string, number>();
const writingListeners = new Set<() => void>();
let writingKey = "";

/** Session 3B (the final Phase 2 gate, (a) item 4): a job is being written to this POS app printer (its app id) now, or
 *  no longer, so the page's removal of a network printer it added waits until that print is done. */
export function markPrinterWriting(nativeId: string, on: boolean): void {
  const count = (writing.get(nativeId) ?? 0) + (on ? 1 : -1);
  if (count > 0) writing.set(nativeId, count);
  else writing.delete(nativeId);
  const key = [...writing.keys()].sort().join(",");
  if (key === writingKey) return;
  writingKey = key;
  for (const listener of [...writingListeners]) listener();
}

/** The app printers being written to now, as one key ("" for none). */
export function printersBeingWritten(): string {
  return writingKey;
}

export function onPrintersWritingChange(listener: () => void): () => void {
  writingListeners.add(listener);
  return () => void writingListeners.delete(listener);
}

let readySource: (() => readonly string[]) | null = null;

/** Session 2C: the agent of the tab that drains this device's slips registers the printers it prints on (the
 *  routable ones this device writes that are its local printer). Unregistered as setDirectPrintSource is. */
export function setReadyPrintersSource(source: () => readonly string[]): () => void {
  readySource = source;
  return () => {
    if (readySource === source) readySource = null;
  };
}

/** The printers this tab prints on (printers mode); [] in simple mode or with no agent. */
export function readyPrinterIds(): string[] {
  try {
    return [...(readySource?.() ?? [])];
  } catch {
    return [];
  }
}

let directSource: (() => string | null) | null = null;

/** Session 2B: the agent of the tab that drains this device's slips registers how it answers directPrintTab().
 *  The returned function unregisters it, unless another agent registered since. */
export function setDirectPrintSource(source: () => string | null): () => void {
  directSource = source;
  return () => {
    if (directSource === source) directSource = null;
  };
}

/** This tab's id while it drains this device's slips and its printer can print right now; null otherwise.
 *  The requests that make slips then name it (PRINT_LEASE_HEADER), so a slip this device prints can be made
 *  already leased to this tab (spec §7.11). */
export function directPrintTab(): string | null {
  try {
    return directSource?.() ?? null;
  } catch {
    return null;
  }
}

const leasedListeners = new Set<(job: LeasedPrintJob) => void>();

/** An answer carried a job already leased to this tab (Session 2B): the agent prints it now, with no lease
 *  request. With no agent listening it is dropped, and its lease expires (KOT: REPRINT; bill: the cashier). */
export function deliverLeasedJob(job: LeasedPrintJob): void {
  for (const listener of [...leasedListeners]) listener(job);
}

export function onLeasedJob(listener: (job: LeasedPrintJob) => void): () => void {
  leasedListeners.add(listener);
  return () => void leasedListeners.delete(listener);
}
