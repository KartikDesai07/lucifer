import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import { NAME_MAX_CHARS, type DevicePrinter, type NativeDevicePrinter } from "@/lib/printer/device-printer-store";
import { bytesToBase64, nativeError, nativeErrorCode, type NativeClient } from "@/lib/printer/native-bridge";
import {
  PRINT_DATA_MAX_BASE64_CHARS,
  type NativePrinter,
  type NativePrinterStatus,
} from "@/lib/printer/native-bridge-protocol";
import {
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  notConnectedError,
  type PaperChoice,
  type PrinterSnapshot,
} from "@/lib/printer/web-printer-types";

// POS-app lane: the Kotlin side owns the link (connect, reconnect, background
// service); the page only sends a finished ESC/POS job as one base64 request
// and mirrors the status the app reports.
export type NativeSelectTarget = { id: string } | { tcp: { host: string; port: number } };

export const NATIVE_DEFAULT_PAPER: PaperChoice = "80mm";

export const NATIVE_BUSY_MESSAGE = "The printer is busy. Print the slip again in a moment.";
export const NATIVE_BLUETOOTH_OFF_MESSAGE = "Bluetooth is off on this device. Turn it on, then reconnect the printer.";
export const NATIVE_BLUETOOTH_BLOCKED_MESSAGE = "Allow Bluetooth for the POS app, then reconnect the printer.";
export const NATIVE_LOCATION_OFF_MESSAGE = "Turn on Location so this tablet can find nearby printers.";

const BASE64_GROUP_BYTES = 3;
const BASE64_GROUP_CHARS = 4;

// What the encoded job would weigh, without encoding it.
export function base64CharsFor(byteCount: number): number {
  return BASE64_GROUP_CHARS * Math.ceil(byteCount / BASE64_GROUP_BYTES);
}

export async function nativeWrite(client: NativeClient, bytes: Uint8Array): Promise<void> {
  if (base64CharsFor(bytes.length) > PRINT_DATA_MAX_BASE64_CHARS) throw nativeError("TOO_LARGE", PRINTER_TOO_LARGE_MESSAGE);
  const result = await client.request("printer.print", { data: bytesToBase64(bytes) });
  // The app must have taken every byte; a short count is a failed print.
  if (result.bytes !== bytes.length) throw nativeError("WRITE_FAILED", PRINTER_WRITE_FAILED_MESSAGE);
}

// The sentence an operator reads for a rejected native request.
export function nativeErrorMessage(error: unknown): string {
  switch (nativeErrorCode(error)) {
    case "NOT_CONNECTED":
      return PRINTER_NOT_CONNECTED_MESSAGE;
    case "TOO_LARGE":
      return PRINTER_TOO_LARGE_MESSAGE;
    case "BUSY":
      return NATIVE_BUSY_MESSAGE;
    case "BLUETOOTH_OFF":
      return NATIVE_BLUETOOTH_OFF_MESSAGE;
    case "UNAUTHORIZED":
      return NATIVE_BLUETOOTH_BLOCKED_MESSAGE;
    case "LOCATION_OFF":
      return NATIVE_LOCATION_OFF_MESSAGE;
    default:
      return PRINTER_WRITE_FAILED_MESSAGE;
  }
}

export function nativeRecordOf(printer: NativePrinter, paper: PaperChoice): NativeDevicePrinter {
  return {
    kind: "native",
    name: printer.name.length > 0 ? printer.name.slice(0, NAME_MAX_CHARS) : "Printer",
    paper,
    printerId: printer.id,
    transport: printer.transport,
  };
}

function statusMessage(status: NativePrinterStatus): string | null {
  if (status.state === "connected" || status.printer === null) return null;
  if (status.state === "disconnected" && status.printer.transport === "usb") {
    return "Check the printer power and USB OTG cable, then tap Reconnect and allow USB access. Connect only one printer of the same model at a time.";
  }
  if (status.state === "disconnected" && status.printer.transport === "tcp") {
    return "Check that this device and the printer are on the same network. Confirm the printer address and port, then reconnect.";
  }
  if (status.printer.transport !== "bt-classic" && status.printer.transport !== "ble") return null;
  if (status.bluetooth === "off") return NATIVE_BLUETOOTH_OFF_MESSAGE;
  return status.bluetooth === "unauthorized" ? NATIVE_BLUETOOTH_BLOCKED_MESSAGE : null;
}

// What the app reports -> the runtime's snapshot. The paper size is the page's
// own setting, so it carries over from the stored printer when there is one.
export function nativeStatusToSnapshot(status: NativePrinterStatus, stored: { paper: PaperChoice } | null): PrinterSnapshot {
  const paper = stored?.paper ?? NATIVE_DEFAULT_PAPER;
  return {
    status: status.printer === null ? "none" : status.state,
    printer: status.printer === null ? null : nativeRecordOf(status.printer, paper),
    message: statusMessage(status),
  };
}

export interface NativeLinkHost {
  native(): NativeClient | null;
  snapshot(): PrinterSnapshot;
  publish(next: Partial<PrinterSnapshot>): void;
  readStore(): DevicePrinter | null;
  writeStore(printer: DevicePrinter | null): void;
}

// The runtime's view of the app's printer: mirrors what the app reports into
// the snapshot and the saved record, and forwards the user's actions. There is
// NO reconnect loop here — the app's Kotlin side owns that.
// The id the app gives a printer chosen by this target (Kotlin PrinterIds.tcp is "tcp:host:port").
function targetId(target: NativeSelectTarget): string {
  return "id" in target ? target.id : `tcp:${target.tcp.host}:${target.tcp.port}`;
}
/** Phase 2 Session 2F1: the app's printers on bridge v2 (native-pool.ts) are named the same way. */
export { targetId as nativeTargetId };

export function createNativeLink(host: NativeLinkHost) {
  let off: (() => void) | null = null;
  // The paper the page asked for, per printer id, until a status for that printer saved it: a select that
  // times out on a slow connect can still succeed later, and the late status must not fall back to 80mm.
  const requestedPaper = new Map<string, PaperChoice>();

  // A printer chosen on the web side (serial/ble) is left alone by an app that has none.
  function apply(status: NativePrinterStatus, paper?: PaperChoice): void {
    const stored = host.readStore();
    const id = status.printer?.id;
    const wanted = paper ?? (id === undefined ? undefined : requestedPaper.get(id));
    // The 2F2 review gate (m-1): the saved paper is that printer's own. A printer the app made this device's (the one it
    // promotes when the default leaves, an older app's change) starts at the default paper, which the panel's toggle shows.
    const same = stored?.kind === "native" && stored.printerId === id ? stored : null;
    const next = nativeStatusToSnapshot(status, wanted ? { paper: wanted } : same);
    if (next.printer === null && stored !== null && stored.kind !== "native") return;
    if (JSON.stringify(next.printer) !== JSON.stringify(stored)) host.writeStore(next.printer);
    if (id !== undefined) requestedPaper.delete(id);
    host.publish(next);
  }

  async function ask(
    run: (client: NativeClient) => Promise<NativePrinterStatus>,
    paper?: { id: string; paper: PaperChoice },
  ): Promise<"connected" | "failed"> {
    const client = host.native();
    const previous = host.snapshot();
    host.publish({ status: "connecting", message: null });
    if (paper) requestedPaper.set(paper.id, paper.paper);
    try {
      if (client === null) throw nativeError("UNSUPPORTED", PRINTER_NOT_CONNECTED_MESSAGE);
      const status = await run(client);
      apply(status, paper?.paper);
      return status.state === "connected" ? "connected" : "failed";
    } catch (error) {
      const timedOut = nativeErrorCode(error) === "TIMEOUT";
      // A timed-out connect may still finish in the app: keep the paper for its late status.
      if (paper && !timedOut) requestedPaper.delete(paper.id);
      host.publish({
        status: previous.printer === null ? "none" : "disconnected",
        message: timedOut ? PRINTER_CONNECT_FAILED_MESSAGE : nativeErrorMessage(error),
      });
      return "failed";
    }
  }

  return {
    // (Re)subscribes and reads the current status. Safe to call again when a late bridge announces itself.
    start(): void {
      const client = host.native();
      if (client === null) {
        // Not here (yet): a saved app printer reads as not connected until the bridge announces itself.
        if (host.snapshot().printer?.kind === "native") host.publish({ status: "disconnected", message: null });
        return;
      }
      off?.();
      off = client.on("printer.status", (status) => apply(status));
      client
        .request("printer.status")
        .then((status) => apply(status))
        .catch(() => {
          if (host.snapshot().printer?.kind === "native") host.publish({ status: "disconnected", message: PRINTER_NOT_CONNECTED_MESSAGE });
        });
    },
    reconnect: () => ask((client) => client.request("printer.reconnect")),
    select: (target: NativeSelectTarget, paper: PaperChoice) =>
      ask((client) => client.request("printer.select", target), { id: targetId(target), paper }),
    async list(scan: boolean): Promise<NativePrinter[]> {
      const client = host.native();
      return client === null ? [] : (await client.request("printer.list", { scan })).printers;
    },
    /** Forgets the app's default printer. The 2F1 review gate (G-2): an app on bridge v2 then makes the first of its
     *  other printers the default and answers with its status; that printer is applied (true), so the page shows the
     *  printer the app prints on. False when the app has none left, or did not answer. */
    async forget(): Promise<boolean> {
      const client = host.native();
      if (client === null) return false;
      try {
        const status = await client.request("printer.forget");
        if (status.printer === null) return false;
        apply(status);
        return true;
      } catch {
        return false;
      }
    },
    write(bytes: Uint8Array): Promise<void> {
      const client = host.native();
      return client === null ? Promise.reject(notConnectedError(PRINTER_NOT_CONNECTED_MESSAGE)) : nativeWrite(client, bytes);
    },
  };
}
