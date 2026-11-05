import type { PrintHostState } from "@pos/shared/print-job";
import { printerTypeLabel } from "@/components/print/printer-type";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
// DotLane, not print-lane's PrintLane (the same five lanes): nothing in lib/printer imports print-lane (print-lane.test.ts).
import type { DotLane } from "@/lib/printer/printer-dot";

// Printer UX PX-3 Task 10 (spec §6.6; mockups t-settings / t-host): the words of the settings view's cards. Which state
// "Print for other devices" is in, the stop question, More's rows, the device card's title and its printer's sub, the
// Faster KOTs row. Pure and DOM-free: the cards hand in what they read and draw what comes back.

export type PrintForOthersView =
  | { kind: "hidden" }
  | { kind: "checking"; text: string }
  | { kind: "offer" }
  | { kind: "host"; printersMode: boolean }
  | { kind: "elsewhere"; host: string; online: boolean };

export interface PrintForOthersInput {
  printersMode: boolean;
  isHostDevice: boolean;
  /** `null` = unresolved pulse OR a degraded tick — never "no printing device". */
  host: PrintHostState | null;
  /** The configured printing device's name; null when none is set. */
  hostLabel: string | null;
  /** THIS device has a network connection. */
  online: boolean;
}

const CHECKING_MESSAGE = "Checking where slips print…";
const OFFLINE_MESSAGE = "This device is offline. Where slips print will show here when it is back online.";

/** Printers mode is decided first: no printing device plays a part there, so the card is hidden, except on a former
 *  printing device, which can still stop (spec §6.6 item 3). Then this device, an unresolved pulse, another device. */
export function printForOthersViewOf(i: PrintForOthersInput): PrintForOthersView {
  if (i.printersMode) return i.isHostDevice ? { kind: "host", printersMode: true } : { kind: "hidden" };
  if (i.isHostDevice) return { kind: "host", printersMode: false };
  if (i.host === null) return { kind: "checking", text: i.online ? CHECKING_MESSAGE : OFFLINE_MESSAGE };
  if (i.hostLabel !== null) return { kind: "elsewhere", host: i.hostLabel, online: !i.host.offline };
  return { kind: "offer" };
}

/** B10: in printers mode a stop cancels nothing (each printer keeps its slips), so only simple mode's question says so. */
export function stopQuestionOf(printersMode: boolean): string {
  return printersMode ? "Stop printing here? Each printer keeps printing its own slips." : "Removing the printing device cancels every waiting slip. Continue?";
}

export type MoreRow = "change-address" | "battery" | "remove-host" | "printer-setup";

export const MORE_ROW_WORDS: Record<MoreRow, string> = {
  "change-address": "Change POS address",
  battery: "Battery settings",
  "remove-host": "Remove the printing device",
  "printer-setup": "Printer setup",
};

/** More's rows, in order; a row that does not apply is not drawn (and no row, no card). Battery: an app that has the steps
 *  (X9). Remove: simple mode, a printing device set, and not this one (it stops from its own card). Printer setup: admins,
 *  never on /printers, which IS Printer setup (X8). */
export function moreRowsOf(i: { native: boolean; battery: boolean; printersMode: boolean; isHostDevice: boolean; hostSet: boolean; isAdmin: boolean; home: "sheet" | "page" }): MoreRow[] {
  const rows: MoreRow[] = [];
  if (i.native) rows.push("change-address");
  if (i.native && i.battery) rows.push("battery");
  if (!i.printersMode && !i.isHostDevice && i.hostSet) rows.push("remove-host");
  if (i.isAdmin && i.home === "sheet") rows.push("printer-setup");
  return rows;
}

export function deviceCardTitleOf(lane: DotLane): string {
  return lane === "desktop" ? "This PC's printer" : "This device's printer";
}

/** "Bluetooth · 80 mm paper": today's type word (printerTypeLabel), then the roll. */
export function printerSubOf(printer: DevicePrinter): string {
  return `${printerTypeLabel(printer)} · ${printer.paper === "58mm" ? "58 mm" : "80 mm"} paper`;
}

const TEXT_KOT_LABEL = "Print KOTs as plain text";
const TEXT_KOT_SUB = "English only. Prints in about 1 second.";

/** One printer: the card says which. Two or more: each row names its printer. */
export function textKotRowWordsOf(name: string, rows: number): { label: string; sub: string } {
  return { label: TEXT_KOT_LABEL, sub: rows >= 2 ? `${name} · ${TEXT_KOT_SUB}` : TEXT_KOT_SUB };
}
