import { PRINTER_DOWN_SETTLE_MS, type PrinterHealthReport, type PrinterLinkState } from "@pos/shared/print-failover";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import { desktopLanId, type DesktopLanPrinter } from "@/lib/printer/desktop-lan";
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
 *  2 s retry answers, keeps the last settled link, so it never starts a skip or moves a slip to a backup); the clock
 *  starts when the status changes (printerHealthClock, below), not at the wake that next reads it. A printer
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
export interface PrinterHealthInput {
  localIds: readonly string[];
  targets: Readonly<Record<string, SlipPrintTarget>>;
  pool: readonly PoolPrinter[] | null;
  device: PrinterStatus;
  windows: boolean;
  missing: readonly string[];
  nowMs: number;
  /** Phase 3 Session 3E (spec §9.6, §10): the network printers the Windows app 1.12.0 writes (desktopLan), by its checks. */
  lan?: readonly DesktopLanPrinter[] | null;
  /** Phase 3 Session 3E: the Windows app checks every minute that each Windows printer is still reported (1.12.0). */
  presence?: boolean;
}

export function printerHealthReportsOf(input: PrinterHealthInput, memory: Map<string, SettledLink>): PrinterHealthReport[] {
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
    } else if (target?.lan !== undefined) {
      // Phase 3 Session 3E: a network printer of the Windows app 1.12.0 by the app's check or last slip, with what it says.
      const id = desktopLanId(target.lan);
      const entry = input.lan?.find((printer) => printer.id === id);
      const link = entry === undefined ? null : settledLinkOf(memory, entry.id, entry.status, input.nowMs);
      if (entry === undefined || link === null) continue;
      out.push({
        printerId,
        link,
        ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
        ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
        ...(entry.error === true ? { error: true as const } : {}),
      });
    } else if (target?.printerName !== undefined) {
      // Phase 3 Session 3E: a Windows printer this PC prints is connected while Windows reports it (one it no longer
      // reports leaves this list and reads down by `missing`, below). The spooler says nothing of its paper.
      if (input.presence === true) out.push({ printerId, link: "connected" });
    } else if (target === undefined && !input.windows) {
      const link = settledLinkOf(memory, `device:${printerId}`, input.device, input.nowMs);
      if (link !== null) out.push({ printerId, link });
    }
  }
  for (const key of [...memory.keys()]) if (key.startsWith("missing:") && !input.missing.includes(key.slice("missing:".length))) memory.delete(key);
  // The 3C review gate (its review's m-1): a printer that left the app's list is forgotten, so one added back later starts
  // a fresh 20 s, never its old clock.
  const pool = input.pool;
  if (pool !== null) for (const key of [...memory.keys()]) if (!key.startsWith("missing:") && !key.startsWith("device:") && !pool.some((entry) => entry.id === key)) memory.delete(key);
  // Phase 3 Session 3E: likewise a network printer the Windows app no longer checks.
  const lan = input.lan;
  if (lan != null) for (const key of [...memory.keys()]) if (key.startsWith("tcp:") && !lan.some((entry) => entry.id === key)) memory.delete(key);
  for (const printerId of input.missing) {
    if (settledLinkOf(memory, `missing:${printerId}`, "disconnected", input.nowMs) === "disconnected") out.push({ printerId, link: "disconnected" });
  }
  return out;
}

/** Session 3C's review (I-1): the beat's health with its settle clock run on every status change of the printers
 *  (`subscribe`: the POS app's pool, this device's printer), not only when the wake samples it (once a minute on a
 *  healthy socket), so a printer that stayed down 20 s reads disconnected at the very next wake. `reports` is the wake's
 *  source; `stop` releases the stores. */
export function printerHealthClock(
  read: () => PrinterHealthInput,
  subscribe: readonly ((listener: () => void) => () => void)[],
): { reports: () => PrinterHealthReport[]; stop: () => void } {
  const memory = new Map<string, SettledLink>();
  const reports = () => printerHealthReportsOf(read(), memory);
  const offs = subscribe.map((on) => on(() => void reports()));
  return { reports, stop: () => offs.forEach((off) => off()) };
}
