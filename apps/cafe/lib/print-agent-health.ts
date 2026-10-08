import { PRINTER_DOWN_SETTLE_MS, type PrinterHealthReport, type PrinterLinkState } from "@pos/shared/print-failover";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import type { PoolPrinter } from "@/lib/printer/native-pool";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 3 Session 3B (spec §10, P3-6): the health this page reports on its wake (the heartbeat; no
// request of its own) for the printers it prints here. The server keeps a report only from the device that writes that
// printer now, and only when it changed (lib/print-health.ts); a writer's "disconnected" for a network printer also skips
// it there, and its "connected" ends that skip (lib/print-failover.ts). Pure and client-safe.

/** What the page remembers of one printer's link: the link it last settled on, and since when it is down (null while it
 *  is up). */
export interface SettledLink {
  link: PrinterLinkState | null;
  downSince: number | null;
}

/** The link a printer settled on. Connected settles at once. Session 3C (the 3B review's m-3): a printer reads
 *  disconnected only once it stayed down PRINTER_DOWN_SETTLE_MS (a blip, such as one failed idle probe that the app's
 *  2 s retry answers, keeps the last settled link, so it never starts a skip or moves a slip to a backup). A printer
 *  still connecting while down keeps that clock (the POS app's probe of a down network printer, every 30 s); one
 *  connecting while up keeps the last settled link (the 3A review gate, m-5); with none settled yet it says nothing. A
 *  printer another tab owns, or none, says nothing. */
export function settledLinkOf(memory: Map<string, SettledLink>, key: string, status: PrinterStatus, nowMs: number): PrinterLinkState | null {
  const kept = memory.get(key);
  if (status === "connected") {
    memory.set(key, { link: "connected", downSince: null });
    return "connected";
  }
  const down = status === "disconnected" || status === "needs-tap" || (status === "connecting" && kept?.downSince != null);
  if (!down) return status === "connecting" ? (kept?.link ?? null) : null;
  const downSince = kept?.downSince ?? nowMs;
  const link = nowMs - downSince >= PRINTER_DOWN_SETTLE_MS ? "disconnected" : (kept?.link ?? null);
  memory.set(key, { link, downSince });
  return link;
}

/** One report per printer this device prints here: one of the POS app's printers (bridge v2) by its own state, with the
 *  paper, cover and error the app says (Session 3C's DLE EOT; absent from an older app); on every other device its one
 *  printer by the device printer's state. The Windows app reports nothing until it can tell (1.12.0, Session 3E).
 *  Session 3C (the 3B review's m-1): `missing`, the network printers this device may take over that its app does not
 *  list, read as down (by the same clock), so the server never picks it for a printer it cannot print. */
export function printerHealthReportsOf(
  input: {
    localIds: readonly string[];
    targets: Readonly<Record<string, SlipPrintTarget>>;
    pool: readonly PoolPrinter[] | null;
    device: PrinterStatus;
    windows: boolean;
    missing: readonly string[];
    nowMs: number;
  },
  memory: Map<string, SettledLink>,
): PrinterHealthReport[] {
  const out: PrinterHealthReport[] = [];
  for (const printerId of input.localIds) {
    const target = input.targets[printerId];
    if (target?.nativeId !== undefined) {
      const entry = input.pool?.find((printer) => printer.id === target.nativeId);
      const link = entry === undefined ? null : settledLinkOf(memory, entry.id, entry.status, input.nowMs);
      if (entry === undefined || link === null) continue;
      out.push({
        printerId,
        link,
        ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
        ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
        ...(entry.error === true ? { error: true as const } : {}),
      });
    } else if (target === undefined && !input.windows) {
      const link = settledLinkOf(memory, `device:${printerId}`, input.device, input.nowMs);
      if (link !== null) out.push({ printerId, link });
    }
  }
  for (const key of [...memory.keys()]) if (key.startsWith("missing:") && !input.missing.includes(key.slice("missing:".length))) memory.delete(key);
  for (const printerId of input.missing) {
    if (settledLinkOf(memory, `missing:${printerId}`, "disconnected", input.nowMs) === "disconnected") out.push({ printerId, link: "disconnected" });
  }
  return out;
}
