import type { PrinterHealthReport, PrinterLinkState } from "@pos/shared/print-failover";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import type { PoolPrinter } from "@/lib/printer/native-pool";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake (the heartbeat; no
// request of its own) for the printers it prints here. The server keeps a report only from the device that writes that
// printer now, and only when it changed (lib/print-health.ts); a writer's "disconnected" for a network printer also skips
// it there, and its "connected" ends that skip (lib/print-failover.ts). Pure and client-safe.

/** The link a printer settled on. A printer still connecting (the POS app's probe of a down network printer, every 30 s)
 *  keeps the last settled link, so a dead printer's words never flicker and its health is never re-written for a probe
 *  (the 3A review gate, m-5); with none settled yet it says nothing. A printer another tab owns, or none, says nothing. */
export function settledLinkOf(memory: Map<string, PrinterLinkState>, key: string, status: PrinterStatus): PrinterLinkState | null {
  if (status === "connected" || status === "disconnected" || status === "needs-tap") {
    const link: PrinterLinkState = status === "connected" ? "connected" : "disconnected";
    memory.set(key, link);
    return link;
  }
  return status === "connecting" ? (memory.get(key) ?? null) : null;
}

/** One report per printer this device prints here: one of the POS app's printers (bridge v2) by its own state, with the
 *  paper, cover and error the app says (Session 3C's DLE EOT; absent before it); on every other device its one printer
 *  by the device printer's state. The Windows app reports nothing until it can tell (1.12.0, Session 3E). */
export function printerHealthReportsOf(
  input: {
    localIds: readonly string[];
    targets: Readonly<Record<string, SlipPrintTarget>>;
    pool: readonly PoolPrinter[] | null;
    device: PrinterStatus;
    windows: boolean;
  },
  memory: Map<string, PrinterLinkState>,
): PrinterHealthReport[] {
  const out: PrinterHealthReport[] = [];
  for (const printerId of input.localIds) {
    const target = input.targets[printerId];
    if (target?.nativeId !== undefined) {
      const entry = input.pool?.find((printer) => printer.id === target.nativeId);
      const link = entry === undefined ? null : settledLinkOf(memory, entry.id, entry.status);
      if (entry === undefined || link === null) continue;
      out.push({
        printerId,
        link,
        ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
        ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
        ...(entry.error === true ? { error: true as const } : {}),
      });
    } else if (target === undefined && !input.windows) {
      const link = settledLinkOf(memory, `device:${printerId}`, input.device);
      if (link !== null) out.push({ printerId, link });
    }
  }
  return out;
}
