import { printerHealthProblem, type PrinterCoverState, type PrinterPaperState, type PrinterProblem } from "@pos/shared/print-failover";
import { printerWriterDeviceId, routablePrinters, type PrinterConfig, type PrinterConnection } from "@pos/shared/print-printers";
import type { AgentPrinters, NativePoolView } from "@/lib/print-agent-printers";
import { desktopLanId, type DesktopLanPrinter } from "@/lib/printer/desktop-lan";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { NativeTransport } from "@/lib/printer/native-bridge-protocol";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printer UX PX-2 (spec §6.5, R9, F-I3): the printers this device prints NOW, by the setup's names, in the setup's
// display order, each with what the app calls it, its transport and its held state. The status card names the right
// printer from this (the client's tablet named and reconnected the wrong one), and its one Reconnect reconnects every
// one of them that is down. Pure and client-safe; hooks/use-agent-printers.ts joins it to the dot's printers.

/** How a printer is reached, as the card words it ("RPP02N · Bluetooth"). browser: a Web Serial port of unknown kind. */
export type TransportWord = "bluetooth" | "usb" | "network" | "windows" | "browser";

export interface PrinterHere {
  /** The setup's printer: its id and its name ("Kitchen printer"). */
  id: string;
  name: string;
  /** What the app calls it ("RPP02N"), a Windows printer's name, the Windows app's network printer's address; "" unknown. */
  appName: string;
  transport: TransportWord;
  /** One of the POS app's printers (bridge v2): Reconnect asks the app for this id. Absent: this device's own one printer,
   *  or a printer of the Windows app (never reconnected from the page, F-I3). */
  nativeId?: string;
  /** Held (lib/printer/held-status.ts); "none" for a Windows printer chosen by name (the app reports no state). */
  status: PrinterStatus;
  /** Out of paper, its cover open or an error, as the app says (low paper still prints). */
  problem?: PrinterProblem;
}

/** A printer that fresh slips wait for, from the pulse (lib/print-waiting.ts printWaitingPrintersOf). */
export interface WaitingPrinter {
  printerId: string;
  /** The setup's name, from the printers already read ("A printer" when it is not listed). */
  name: string;
  count: number;
  /** The server's word for that printer (the writer's beat), when a row carries one. */
  problem?: PrinterProblem;
  /** It has a problem, or its oldest fresh slip waited over a minute (F-I2): "is not printing", not merely busy. */
  stuck: boolean;
}

/** Session 2D (spec §10): an enabled printer takes a slip (no host plays a part), whether this device writes a
 *  printer, and whether every printer it writes is its own printer. The dot's view of printers mode: PX-2 moved it here
 *  with its three new fields (lib/printer/printer-dot.ts re-exports it and stays within its 300 lines). */
export interface PrinterDotPrinters {
  printersMode: boolean;
  isWriter: boolean;
  allLocal: boolean;
  /** Session 2F1 (spec §9.2): on the POS app with bridge v2, the worst state among its printers this device prints. */
  worst?: PrinterStatus;
  /** Session 3B (spec §10): the worst problem the app says of one of them (out of paper, cover open, an error), by name. */
  problem?: { name: string; problem: PrinterProblem };
  /** PX-2 (spec §6.5): every printer it prints now (held states), the setup's names of those it writes that are not its
   *  own, and the printer fresh slips wait for that it does not print (the most slips; R1). */
  here?: PrinterHere[];
  notHere?: string[];
  waiting?: WaitingPrinter;
}

/** Session 3B (spec §10): what turns the dot red although every printer answers. Low paper still prints. */
export const DOT_PROBLEMS: readonly PrinterProblem[] = ["paper-out", "cover-open", "error"];

type Held = (key: string, status: PrinterStatus) => PrinterStatus;
type Health = { paper?: PrinterPaperState; cover?: PrinterCoverState; error?: true };

const NATIVE_WORDS: Record<NativeTransport, TransportWord> = { "bt-classic": "bluetooth", ble: "bluetooth", tcp: "network", usb: "usb" };

/** This device's saved printer's transport word (the card's simple-mode `{conn}` reads it too). */
export function deviceTransportOf(printer: DevicePrinter): TransportWord {
  if (printer.kind === "native") return NATIVE_WORDS[printer.transport];
  if (printer.kind === "ble") return "bluetooth";
  // A Web Serial port: what the browser said of it when it was chosen, if anything.
  if (printer.usbVendorId !== undefined) return "usb";
  return printer.bluetoothServiceClassId !== undefined ? "bluetooth" : "browser";
}

function connectionTransportOf(connection: PrinterConnection): TransportWord {
  if (connection.kind === "lan") return "network";
  switch (connection.transport) {
    case "bt-classic":
    case "ble":
    case "web-bluetooth":
      return "bluetooth";
    case "usb":
      return "usb";
    case "windows":
      return "windows";
    case "web-serial":
      return "browser";
  }
}

function withProblem(entry: PrinterHere, health: Health | undefined): PrinterHere {
  const problem = health === undefined ? null : printerHealthProblem({ link: "connected", paper: health.paper, cover: health.cover, error: health.error });
  return problem !== null && DOT_PROBLEMS.includes(problem) ? { ...entry, problem } : entry;
}

/** Every printer this device prints now (agent.localIds), in the setup's display order. `held` keys: an app printer's
 *  native id, `device:<printer id>` for this device's one printer. A network printer it may take over counts only while
 *  the wake says it writes it (`takenOver`, as the dot's own count, R9). */
export function printersHereOf(
  printers: readonly PrinterConfig[],
  agent: AgentPrinters,
  pool: NativePoolView | null,
  lan: readonly DesktopLanPrinter[] | null,
  local: DevicePrinter | null,
  localStatus: PrinterStatus,
  held: Held,
  takenOver: readonly string[] = [],
): PrinterHere[] {
  return routablePrinters(printers).flatMap((printer): PrinterHere[] => {
    if (!agent.localIds.includes(printer.id) || (agent.takeoverIds.includes(printer.id) && !takenOver.includes(printer.id))) return [];
    const { id, name, connection } = printer;
    const target = agent.targets[id];
    if (target?.nativeId !== undefined) {
      const nativeId = target.nativeId;
      const entry = pool?.printers.find((candidate) => candidate.id === nativeId);
      const status = held(nativeId, entry?.status ?? "none");
      return [withProblem({ id, name, appName: entry?.printer?.name ?? "", transport: connectionTransportOf(connection), nativeId, status }, entry)];
    }
    // The Windows app (F-I3, R9): its own link and words, never held (the desktop dot is unchanged), never reconnected.
    if (target?.lan !== undefined) {
      const lanId = desktopLanId(target.lan);
      const entry = lan?.find((candidate) => candidate.id === lanId);
      return [withProblem({ id, name, appName: target.lan.host, transport: "network", status: entry?.status ?? "none" }, entry)];
    }
    if (connection.kind === "device" && connection.transport === "windows") return [{ id, name, appName: connection.address, transport: "windows", status: "none" }];
    // This device's one printer: a browser tab's, or the POS app's on bridge v1.
    const transport = local !== null ? deviceTransportOf(local) : connectionTransportOf(connection);
    return [{ id, name, appName: local?.name ?? "", transport, status: held(`device:${id}`, localStatus) }];
  });
}

/** The setup's names of the printers this device writes that are not its own (it never prints them). */
export function printersNotHereOf(printers: readonly PrinterConfig[], deviceId: string, agent: AgentPrinters): string[] {
  if (deviceId === "") return [];
  return routablePrinters(printers)
    .filter((printer) => printerWriterDeviceId(printer) === deviceId && !agent.localIds.includes(printer.id))
    .map((printer) => printer.name);
}

/** The POS app's printers with each state held (B6) before dotPrintersOf reads its worst one: no red ↔ checking flicker. */
export function heldPoolOf(pool: NativePoolView | null, held: Held): NativePoolView | null {
  return pool === null ? null : { ...pool, printers: pool.printers.map((entry) => ({ ...entry, status: held(entry.id, entry.status) })) };
}
