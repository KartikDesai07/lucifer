import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { PRINTER_NOT_LOCAL_MESSAGE } from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { laneKeyOfTarget } from "@/lib/printer/lane-writes";

// Printing Phase 6 Session 6A (spec §9 ruling 24): the copies of one leased job, moved out of lib/print-agent-printers.ts.

/** A kitchen order's copies on a two-step lane are one draw whose bytes are written N times (the KOT renderers read no
 *  clock, so a copy is the same bytes: lib/print-copies.test.ts pins it). A bill, and every other slip, keeps a draw per
 *  copy: a bill reads the time. A printer written by name (the Windows app's printer) has no lane, so none either. */
export function copiesDrawnOnce(job: Pick<LeasedPrintJob, "kind" | "copies">, target: SlipPrintTarget | undefined): boolean {
  return job.kind === "kot" && (job.copies ?? 1) > 1 && laneKeyOfTarget(target) !== null;
}

/** One leased job on this device (spec §6.3 copies, plan decision 2): a printer job is refused (sent:"no", never
 *  counted) when its printer is not this device's printer; otherwise every copy is written in its one lease, one
 *  after another. A failure after the first copy may already have put paper out, so it is "maybe" (the REPRINT
 *  repeats every copy, labelled). A job of the device's own simple-mode line prints once, as today.
 *  `bytesOnce` (Phase 6, ruling 24): the first draw is asked for every copy (`printOnce(copies)`) and answers how many
 *  it wrote (`written`, absent = 1); a slip that was not handed off writes one, and the rest are one draw each, so a
 *  copy is never lost and never doubled. */
export async function printJobCopies(
  job: Pick<LeasedPrintJob, "printerId" | "copies" | "kind">,
  localIds: readonly string[],
  printOnce: (writes: number) => Promise<PrintAgentResult>,
  bytesOnce: boolean,
): Promise<PrintAgentResult> {
  if (job.printerId !== undefined && !localIds.includes(job.printerId)) return { ok: false, error: new PrintWriteError(PRINTER_NOT_LOCAL_MESSAGE, "no") };
  const copies = job.copies ?? 1;
  let done = 0;
  while (done < copies) {
    const ask = bytesOnce && done === 0 ? copies : 1;
    const result = await printOnce(ask);
    if (!result.ok) return done === 0 ? result : { ok: false, error: new PrintWriteError(printWriteOutcomeOf(result.error).message, "maybe") };
    done += Math.min(Math.max(result.written ?? 1, 1), ask);
  }
  return { ok: true };
}
