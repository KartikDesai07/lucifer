import { acquireTabLock, bluetoothApi, onWindowEvent, serialApi } from "@/lib/printer/capabilities";
import { createWebLink } from "@/lib/printer/device-printer-link";
import { DEVICE_WRITE_DEADLINE_MS, createWriteQueue } from "@/lib/printer/device-printer-write";
import {
  readDevicePrinter,
  watchDevicePrinter,
  writeDevicePrinter,
  type DevicePrinter,
} from "@/lib/printer/device-printer-store";
import { NATIVE_READY_EVENT, nativeClient } from "@/lib/printer/native-bridge";
import { createNativeLink, type NativeSelectTarget } from "@/lib/printer/transport-native";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  type ConnectOutcome,
  type DevicePrinterDeps,
  type DevicePrinterRuntime,
  type PaperChoice,
  type PrinterSnapshot,
} from "@/lib/printer/web-printer-types";

export { DEVICE_WRITE_DEADLINE_MS, PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE };
export {
  PRINTER_CHOOSE_AGAIN_MESSAGE,
  PRINTER_CONNECT_FAILED_MESSAGE,
  RECONNECT_BACKOFF_MS,
  RECONNECT_STEADY_MS,
} from "@/lib/printer/device-printer-link";
export type { NativeSelectTarget };
export type {
  ConnectOutcome,
  DevicePrinterDeps,
  DevicePrinterRuntime,
  PrinterSnapshot,
  PrinterStatus,
} from "@/lib/printer/web-printer-types";

// THIS device's printer: one client-only singleton, no React. Exactly ONE tab
// of a browser profile owns the printer (Web Serial ports are exclusive and two
// tabs would report opposite states): only the owner opens a link, reconnects
// and reports. Every other tab reads the same saved printer as "elsewhere".
export const PRINTER_OWNER_LOCK = "pos.device-printer";
export const PRINTER_ELSEWHERE_STATUS_MESSAGE = "This printer is connected in another tab of this browser.";

export const NONE_SNAPSHOT: PrinterSnapshot = { status: "none", printer: null, message: null };

function initialSnapshot(stored: DevicePrinter | null): PrinterSnapshot {
  return stored === null ? NONE_SNAPSHOT : { status: "connecting", printer: stored, message: null };
}

export function createDevicePrinter(deps: DevicePrinterDeps): DevicePrinterRuntime {
  let snapshot: PrinterSnapshot = NONE_SNAPSHOT;
  const listeners = new Set<() => void>();
  let role: "unknown" | "owner" | "elsewhere" = "unknown";
  let started = false;

  function publish(next: Partial<PrinterSnapshot>): void {
    const merged = { ...snapshot, ...next };
    if (merged.status === snapshot.status && merged.printer === snapshot.printer && merged.message === snapshot.message) return;
    snapshot = merged;
    for (const listener of [...listeners]) listener();
  }
  function requireOwner(): void {
    if (role !== "owner") throw new Error(role === "elsewhere" ? PRINTER_ELSEWHERE_MESSAGE : PRINTER_NOT_CONNECTED_MESSAGE);
  }

  const link = createWebLink({ deps, snapshot: () => snapshot, publish, isOwner: () => role === "owner" });
  const nativeLink = createNativeLink({
    native: deps.native,
    snapshot: () => snapshot,
    publish,
    readStore: deps.readStore,
    writeStore: deps.writeStore,
  });
  const isNative = (): boolean => snapshot.printer?.kind === "native";

  function startOwned(): void {
    if (role === "owner") return;
    role = "owner";
    const stored = deps.readStore();
    publish(initialSnapshot(stored));
    if (stored !== null && stored.kind !== "native") link.retry();
    nativeLink.start();
  }
  function syncElsewhere(): void {
    const stored = deps.readStore();
    // Even with no printer saved yet, a non-owner tab cannot connect one (the buttons disable on "elsewhere").
    publish({ status: "elsewhere", printer: stored, message: PRINTER_ELSEWHERE_STATUS_MESSAGE });
  }

  function markDisconnected(): void {
    if (isNative()) return;
    publish({ status: "disconnected", message: null });
    link.schedule();
  }

  const write = createWriteQueue({
    requireOwner,
    snapshot: () => snapshot,
    send: (bytes) => (isNative() ? nativeLink.write(bytes) : link.send(bytes)),
    reconnect: async () => (isNative() ? (await nativeLink.reconnect()) === "connected" : link.reconnectSilently()),
    markDisconnected,
    // A deadline fired mid-write: show the link down, then close it so the stuck write is torn down.
    abort: async () => {
      if (isNative()) return;
      markDisconnected();
      await link.abandon();
    },
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    init() {
      if (started) return;
      started = true;
      publish(initialSnapshot(deps.readStore()));
      deps.watchStore(() => {
        if (role === "elsewhere") syncElsewhere();
      });
      // A late bridge announces itself; the owner (re)runs the native init.
      deps.onNativeReady(() => {
        if (role === "owner") nativeLink.start();
      });
      deps.acquireOwnership(startOwned, () => {
        role = "elsewhere";
        syncElsewhere();
      });
    },
    async connectNew(kind, paper) {
      requireOwner();
      return link.connectNew(kind, paper);
    },
    async selectNative(target, paper) {
      requireOwner();
      return nativeLink.select(target, paper);
    },
    listNative: (scan) => nativeLink.list(scan),
    async reconnect(): Promise<ConnectOutcome> {
      requireOwner();
      const printer = snapshot.printer;
      if (printer === null) return "failed";
      return printer.kind === "native" ? nativeLink.reconnect() : link.reconnectByHand(printer);
    },
    setPaper(paper: PaperChoice) {
      requireOwner();
      const printer = snapshot.printer;
      if (printer === null) return;
      const next: DevicePrinter = { ...printer, paper };
      deps.writeStore(next);
      publish({ printer: next });
    },
    write,
    async forget() {
      requireOwner();
      const wasNative = isNative();
      await link.release();
      if (wasNative) await nativeLink.forget();
      deps.writeStore(null);
      publish(NONE_SNAPSHOT);
    },
  };
}

function defaultDeps(): DevicePrinterDeps {
  return {
    serial: serialApi,
    bluetooth: bluetoothApi,
    native: nativeClient,
    readStore: readDevicePrinter,
    writeStore: writeDevicePrinter,
    watchStore: watchDevicePrinter,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    acquireOwnership: (onOwner, onElsewhere) => acquireTabLock(PRINTER_OWNER_LOCK, onOwner, onElsewhere),
    onNativeReady: (fn) => onWindowEvent(NATIVE_READY_EVENT, fn),
  };
}

let instance: DevicePrinterRuntime | null = null;
export function devicePrinter(): DevicePrinterRuntime {
  instance ??= createDevicePrinter(defaultDeps());
  return instance;
}
// Test seam: install (or clear) the singleton.
export function setDevicePrinterInstance(next: DevicePrinterRuntime | null): void {
  instance = next;
}
