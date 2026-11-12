import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { markPrinterWriting } from "@/lib/print-agent-seams";
import { copiesDrawnOnce, printJobCopies } from "@/lib/print-copies";
import { PRINT_AGENT_SLIP_DEADLINE_MS, printAgentSlipOf } from "@/lib/print-agent-slip";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip, type SlipPrintTarget } from "@/lib/print-host-slips";
import type { HostPrintDone } from "@/lib/print-host-tickets";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";

// Printing Phase 6 Session 6A (spec §9 rulings 3, 12, 14): the agent's print step, moved out of hooks/use-print-agent.ts.
// One slip through the host bridge with the 140 s bound of ruling 12: a slip still waiting to be drawn when the bound
// ends is withdrawn and answered sent "no" by its own ticket (never "maybe": it never reached paper); a slip on the
// surface or on its printer's lane is waited for and answered by its own end, which is bounded already (the watchdog and
// grace on the surface, each writer's deadline on the lane). The hook builds the seams from its refs.

export interface AgentPrintSeams {
  /** The bridge's queueSlip: `withdraw()` answers a slip still waiting sent "no" through `done`, at once, and says so. */
  queueSlip(slip: HostPrintSlip, done: HostPrintDone): { withdraw(): boolean };
  /** The Windows printer (or app printer) each printer job of this device prints on, by printer id. */
  targets(): Record<string, SlipPrintTarget>;
  /** The printers this device prints only for another device (Phase 4 §5.3): their slips are pictures. */
  takeovers(): readonly string[];
  /** The printers this device prints here (printJobCopies' `localIds`). */
  ready(): readonly string[];
  today(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** One copy of a leased job as one slip. `writes` > 1: a two-step slip whose bytes are written that many times. */
export function printSlipOnce(seams: AgentPrintSeams, job: LeasedPrintJob, writes: number): Promise<PrintAgentResult> {
  return new Promise((resolve) => {
    let deadline: unknown = null;
    const done: HostPrintDone = (result) => {
      if (deadline !== null) seams.clearTimer(deadline);
      deadline = null;
      resolve(result);
    };
    try {
      const slip = printAgentSlipOf(job, seams.today(), job.printerId === undefined ? undefined : seams.targets()[job.printerId]);
      const marked: HostPrintSlip = job.printerId !== undefined && seams.takeovers().includes(job.printerId) ? { ...slip, takeover: true } : slip;
      let queued: { withdraw(): boolean } | null = null;
      // Ruling 12: at the bound a slip never drawn goes back unprinted (its ticket answers "no"); one drawn is waited for.
      deadline = seams.setTimer(() => {
        deadline = null;
        queued?.withdraw();
      }, PRINT_AGENT_SLIP_DEADLINE_MS);
      queued = seams.queueSlip(writes > 1 ? { ...marked, writes } : marked, done);
    } catch {
      // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
      done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
    }
  });
}

/** Session 2C: a printer job only on this device's own printer, every copy inside its one lease. Session 2E: a Windows
 *  printer that failed is looked up again in the Windows app, so one renamed or removed there stops being this PC's.
 *  Session 3B (the final Phase 2 gate, (a) item 4): the POS app printer it writes to is marked meanwhile, so the page's
 *  removal of a network printer it added waits for the print (hooks/use-agent-printers.ts). */
export function agentPrint(seams: AgentPrintSeams): (job: LeasedPrintJob) => Promise<PrintAgentResult> {
  return async (job) => {
    const target = job.printerId === undefined ? undefined : seams.targets()[job.printerId];
    const nativeId = target?.nativeId;
    if (nativeId !== undefined) markPrinterWriting(nativeId, true);
    try {
      const result = await printJobCopies(job, seams.ready(), (writes) => printSlipOnce(seams, job, writes), copiesDrawnOnce(job, target));
      if (!result.ok && job.printerId !== undefined && seams.targets()[job.printerId]?.printerName !== undefined) void refreshDesktopPrinterChosen();
      return result;
    } finally {
      if (nativeId !== undefined) markPrinterWriting(nativeId, false);
    }
  };
}
