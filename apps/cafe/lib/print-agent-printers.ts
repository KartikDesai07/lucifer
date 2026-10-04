import type { LeasedPrintJob, PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing redesign, Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which
// of them it prints on its one local printer (several printers per device arrive in Session 2E). Pure and
// client-safe; hooks/use-agent-printers.ts reads it on every printers read and every change of this device's
// printer.

/** The refusal a leased job gets when its printer is not this device's printer (sent:"no", never counted). */
export const PRINTER_NOT_LOCAL_MESSAGE = "This printer is not connected to this device.";

/** A printer this device writes is printed here only when it IS this device's one printer: a LAN printer whose
 *  host:port is the app's selected network printer, a device printer whose transport and address match the
 *  saved one, a Windows printer on the Windows app. Anything else would put a bar's slips on the kitchen's paper. */
export function printerIsLocal(printer: PrinterConfig, local: DevicePrinter | null, desktop: boolean): boolean {
  const connection = printer.connection;
  if (connection.kind === "lan") {
    return local?.kind === "native" && local.transport === "tcp" && local.printerId === `tcp:${connection.host}:${connection.port}`;
  }
  switch (connection.transport) {
    case "windows":
      return desktop;
    case "bt-classic":
    case "ble":
    case "usb":
      // The app names its printer "<transport>:<id>" (Kotlin PrinterIds: "bt-classic:<MAC>", "ble:<MAC>",
      // "usb:<vendor>:<product>"); the setup's address is the bare id (§6.3), or the app's whole id as it reported
      // it (Session 2C's final review, I-1).
      return (
        local?.kind === "native" &&
        local.transport === connection.transport &&
        (local.printerId === `${connection.transport}:${connection.address}` || local.printerId === connection.address)
      );
    case "web-bluetooth":
      return local?.kind === "ble" && local.deviceId === connection.address;
    case "web-serial":
      // A Chrome tab drives at most one serial printer (spec §9.7), which has no stable address.
      return local?.kind === "serial";
  }
}

export interface AgentPrinters {
  /** An enabled printer takes a slip (spec §6.6): every slip is routed to printers. */
  printersMode: boolean;
  /** This device writes a routable printer: it drains and polls the wake in printers mode, host or not. */
  isWriter: boolean;
  /** The routable printers this device writes that ARE its local printer: the lines it leases and prints. */
  localIds: string[];
}

export function agentPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: boolean): AgentPrinters {
  const mine = deviceId === "" ? [] : routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === deviceId);
  return {
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: mine.filter((printer) => printerIsLocal(printer, local, desktop)).map((printer) => printer.id),
  };
}

/** Session 2C (the 2C gate's review, I-2, and its emulator run): the device's printer list is stale when a missed
 *  print-setup frame left it behind the setup. Either a printer job aimed at it is on a printer it does not print
 *  on (it was just made that printer's writer), or the wake says the setup no longer names a writer it believes
 *  it is (its printer removed or moved). A host in simple mode is not a writer, so the wake's false means nothing. */
export function printerListLooksStale(input: {
  ready: readonly string[];
  isWriter: boolean;
  jobsForMe?: PrintJobsForMe;
  writesPrinters?: boolean;
}): boolean {
  if (input.jobsForMe?.printerIds?.some((id) => !input.ready.includes(id)) === true) return true;
  return input.isWriter && input.writesPrinters === false;
}

/** Session 2C's final review (I-2): jobs-for-me counts every job aimed at the device, including ones on a printer
 *  it does not print on (a second printer it writes, before Session 2E; a printer whose address is not its own),
 *  which its lease never names. A kick on those leased nothing on every pulse and every wake, and kept the wake's
 *  fast cadence: only its own line's jobs, or a printer it prints here, kick it. A printer it does not know of yet
 *  is read again by printerListLooksStale; the new list nudges the agent. */
export function jobsForMeLeasable(jobs: PrintJobsForMe | undefined, ready: readonly string[]): boolean {
  if (jobs === undefined || jobs.count === 0) return false;
  if (jobs.printerIds === undefined || jobs.ownLine === true) return true;
  return jobs.printerIds.some((id) => ready.includes(id));
}

/** One leased job on this device (spec §6.3 copies, plan decision 2): a printer job is refused (sent:"no", never
 *  counted) when its printer is not this device's printer; otherwise every copy is written in its one lease, one
 *  after another. A failure after the first copy may already have put paper out, so it is "maybe" (the REPRINT
 *  repeats every copy, labelled). A job of the device's own simple-mode line prints once, as today. */
export async function printJobCopies(
  job: Pick<LeasedPrintJob, "printerId" | "copies">,
  localIds: readonly string[],
  printOnce: () => Promise<PrintAgentResult>,
): Promise<PrintAgentResult> {
  if (job.printerId !== undefined && !localIds.includes(job.printerId)) return { ok: false, error: new PrintWriteError(PRINTER_NOT_LOCAL_MESSAGE, "no") };
  const copies = job.copies ?? 1;
  for (let copy = 1; copy <= copies; copy++) {
    const result = await printOnce();
    if (!result.ok) return copy === 1 ? result : { ok: false, error: new PrintWriteError(printWriteOutcomeOf(result.error).message, "maybe") };
  }
  return { ok: true };
}
