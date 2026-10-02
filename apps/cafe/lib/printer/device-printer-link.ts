import type { BleDevicePrinter, DevicePrinter } from "@/lib/printer/device-printer-store";
import { connectBle, openChosenBle, requestBleDevice, resolveSavedBle, type Sleep } from "@/lib/printer/transport-ble";
import { openChosenSerial, openSavedSerial, requestSerialPort } from "@/lib/printer/transport-serial";
import {
  PRINTER_NOT_CONNECTED_MESSAGE,
  notConnectedError,
  quiet,
  type BleDeviceLike,
  type ConnectOutcome,
  type DevicePrinterDeps,
  type PaperChoice,
  type PrinterSnapshot,
  type PrinterTransport,
  type SerialPortLike,
} from "@/lib/printer/web-printer-types";

// The Web Serial / Web Bluetooth half of the device printer: opening the saved
// printer, choosing a new one, noticing a dropped link and reconnecting it
// with backoff. The POS-app lane has its own link (transport-native.ts).
export const RECONNECT_BACKOFF_MS = [2_000, 5_000, 10_000] as const;
export const RECONNECT_STEADY_MS = 30_000;
export const PRINTER_CHOOSE_AGAIN_MESSAGE = "Tap Reconnect to choose this printer again.";
export const PRINTER_CONNECT_FAILED_MESSAGE = "Could not connect to the printer. Check it is on and nearby, then try again.";
// A saved printer that is off or out of range can leave open() waiting for good
// (Web Bluetooth's connect "can wait forever"): give up after this and let the backoff retry.
export const SAVED_CONNECT_DEADLINE_MS = 20_000;
const CHOOSER_CANCEL_ERRORS: readonly string[] = ["NotFoundError", "AbortError"];

export type SavedOutcome = "connected" | "needs-tap" | "failed";

type SavedOpen = { transport: PrinterTransport; port: SerialPortLike } | { transport: PrinterTransport; device: BleDeviceLike } | null;
const OPEN_TIMED_OUT = Symbol("saved-open-timed-out");

export interface WebLinkHost {
  deps: Pick<DevicePrinterDeps, "serial" | "bluetooth" | "setTimer" | "clearTimer" | "writeStore">;
  snapshot(): PrinterSnapshot;
  publish(next: Partial<PrinterSnapshot>): void;
  isOwner(): boolean;
}

export function createWebLink(host: WebLinkHost) {
  const { deps } = host;
  let transport: PrinterTransport | null = null;
  let port: SerialPortLike | null = null;
  let bleDevice: BleDeviceLike | null = null;
  let generation = 0; // bumped by release/connectNew: an open still in flight from before is discarded
  let timer: unknown = null;
  let attempt = 0;
  let inflight: Promise<SavedOutcome> | null = null;
  const sleep: Sleep = (ms) => new Promise<void>((resolve) => void deps.setTimer(resolve, ms));

  function stopReconnect(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    attempt = 0;
  }
  async function dropTransport(): Promise<void> {
    const old = transport;
    transport = null;
    if (old !== null) await quiet(() => old.close());
  }
  function attach(next: PrinterTransport, printer: DevicePrinter): void {
    stopReconnect();
    transport = next;
    next.onLost(() => {
      if (transport !== next) return;
      transport = null;
      host.publish({ status: "disconnected", message: null });
      schedule();
    });
    host.publish({ status: "connected", printer, message: null });
  }

  // 2 s, 5 s, 10 s, then every 30 s while a printer is configured and not connected.
  function schedule(): void {
    const printer = host.snapshot().printer;
    if (!host.isOwner() || printer === null || printer.kind === "native" || timer !== null) return;
    const delay = attempt < RECONNECT_BACKOFF_MS.length ? RECONNECT_BACKOFF_MS[attempt] : RECONNECT_STEADY_MS;
    attempt += 1;
    timer = deps.setTimer(() => {
      timer = null;
      retry();
    }, delay);
  }
  function retry(): void {
    void connectSaved().then((outcome) => {
      if (outcome === "failed") schedule();
    });
  }

  // The saved open, but never for longer than the deadline. A late result is closed, not used.
  async function openWithin(opening: Promise<SavedOpen>): Promise<SavedOpen | typeof OPEN_TIMED_OUT> {
    let deadline: unknown;
    const expired = new Promise<typeof OPEN_TIMED_OUT>((resolve) => {
      deadline = deps.setTimer(() => resolve(OPEN_TIMED_OUT), SAVED_CONNECT_DEADLINE_MS);
    });
    try {
      const result = await Promise.race([opening, expired]);
      if (result === OPEN_TIMED_OUT) {
        void opening.then(
          (late) => (late === null ? undefined : quiet(() => late.transport.close())),
          () => undefined,
        );
      }
      return result;
    } finally {
      deps.clearTimer(deadline);
    }
  }

  // The saved BLE printer. The device is held (bleDevice) BEFORE the connect starts, so a
  // deadline can gatt.disconnect() a connect that is still pending.
  async function openSavedBleHeld(saved: BleDevicePrinter, gen: number): Promise<SavedOpen> {
    const device = await resolveSavedBle(deps.bluetooth(), bleDevice, saved);
    if (device === null) return null;
    if (gen === generation) bleDevice = device;
    return { transport: (await connectBle(device, sleep, saved)).transport, device };
  }

  async function runConnectSaved(): Promise<SavedOutcome> {
    const printer = host.snapshot().printer;
    if (printer === null || printer.kind === "native") return "failed";
    if (transport !== null && host.snapshot().status === "connected") return "connected";
    const gen = generation;
    host.publish({ status: "connecting", message: null });
    try {
      await dropTransport();
      const opened = await openWithin(
        printer.kind === "serial" ? openSavedSerial(deps.serial(), printer) : openSavedBleHeld(printer, gen),
      );
      if (opened === OPEN_TIMED_OUT) {
        // Only the attempt that is still current may speak for the link (a newer connectNew owns it otherwise).
        if (gen === generation) {
          generation += 1;
          host.publish({ status: "disconnected", message: PRINTER_CONNECT_FAILED_MESSAGE });
          if (printer.kind === "ble") await quiet(async () => bleDevice?.gatt?.disconnect());
        }
        return "failed";
      }
      if (gen !== generation) {
        if (opened !== null) await quiet(() => opened.transport.close());
        return "failed";
      }
      if (opened === null) {
        host.publish({ status: "needs-tap", message: PRINTER_CHOOSE_AGAIN_MESSAGE });
        return "needs-tap";
      }
      if ("port" in opened) port = opened.port;
      else bleDevice = opened.device;
      attach(opened.transport, printer);
      return "connected";
    } catch {
      if (gen === generation) host.publish({ status: "disconnected", message: PRINTER_CONNECT_FAILED_MESSAGE });
      return "failed";
    }
  }
  function connectSaved(): Promise<SavedOutcome> {
    inflight ??= runConnectSaved().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function connectNew(kind: "serial" | "ble", paper: PaperChoice): Promise<ConnectOutcome> {
    const previous = host.snapshot();
    const serial = deps.serial();
    const bluetooth = deps.bluetooth();
    let chosen: SerialPortLike | BleDeviceLike;
    try {
      // The chooser is the FIRST await: it needs the click's user activation.
      if (kind === "serial" && serial !== null) chosen = await requestSerialPort(serial);
      else if (kind === "ble" && bluetooth !== null) chosen = await requestBleDevice(bluetooth);
      else return "failed";
    } catch (error) {
      return CHOOSER_CANCEL_ERRORS.includes((error as { name?: string } | null)?.name ?? "") ? "cancelled" : "failed";
    }
    const gen = (generation += 1);
    stopReconnect();
    host.publish({ status: "connecting", message: null });
    await dropTransport();
    try {
      const opened =
        kind === "serial" && serial !== null
          ? await openChosenSerial(serial, chosen as SerialPortLike, paper)
          : await openChosenBle(chosen as BleDeviceLike, paper, sleep);
      if (gen !== generation) {
        await quiet(() => opened.transport.close());
        return "cancelled";
      }
      if (opened.record.kind === "serial") port = chosen as SerialPortLike;
      else bleDevice = chosen as BleDeviceLike;
      deps.writeStore(opened.record);
      attach(opened.transport, opened.record);
      return "connected";
    } catch {
      if (gen !== generation) return "cancelled";
      host.publish({ status: previous.printer === null ? "none" : "disconnected", message: PRINTER_CONNECT_FAILED_MESSAGE });
      schedule();
      return "failed";
    }
  }

  return {
    connectNew,
    retry,
    schedule,
    stopReconnect,
    // The Reconnect button: the saved printer again, else (nothing granted any more after a reload or a revoked permission) the chooser.
    async reconnectByHand(printer: DevicePrinter): Promise<ConnectOutcome> {
      if (printer.kind === "native") return "failed";
      stopReconnect();
      const outcome = await connectSaved();
      if (outcome === "needs-tap") return connectNew(printer.kind, printer.paper);
      if (outcome === "failed") schedule();
      return outcome;
    },
    /** One silent reconnect — no chooser, no gesture. */
    async reconnectSilently(): Promise<boolean> {
      return (await connectSaved()) === "connected";
    },
    /** A write ran out of time: discard any open still in flight and close the link (the caller marks it down). */
    async abandon(): Promise<void> {
      generation += 1;
      await dropTransport();
    },
    send(bytes: Uint8Array): Promise<void> {
      return transport === null ? Promise.reject(notConnectedError(PRINTER_NOT_CONNECTED_MESSAGE)) : transport.write(bytes);
    },
    // Forget: invalidate anything in flight, close the link, give the browser its permissions back.
    async release(): Promise<void> {
      generation += 1;
      stopReconnect();
      await dropTransport();
      const oldPort = port;
      const oldDevice = bleDevice;
      port = null;
      bleDevice = null;
      await quiet(() => oldPort?.forget?.());
      await quiet(() => oldDevice?.forget?.());
    },
  };
}
