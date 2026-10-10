import type { PrinterCoverState, PrinterPaperState } from "@pos/shared/print-failover";
import { onWindowEvent } from "@/lib/printer/capabilities";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer-link";
import { createWriteQueue } from "@/lib/printer/device-printer-write";
import type { NativeDevicePrinter } from "@/lib/printer/device-printer-store";
import { NATIVE_READY_EVENT, NATIVE_REQUEST_TIMEOUT_MS, bytesToBase64, nativeError, nativeErrorCode } from "@/lib/printer/native-bridge";
import { PRINT_DATA_MAX_BASE64_CHARS } from "@/lib/printer/native-bridge-protocol";
import { nativeV2Client, type NativePoolStatus, type NativeV2Client } from "@/lib/printer/native-bridge-v2";
import { base64CharsFor, nativeErrorMessage, nativeStatusToSnapshot, nativeTargetId, type NativeSelectTarget } from "@/lib/printer/transport-native";
import {
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  notConnectedError,
  type ConnectOutcome,
  type PrinterSnapshot,
} from "@/lib/printer/web-printer-types";

// Phase 2 Session 2F1 (spec §9.2): the POS app's printers on bridge v2, mirrored on the page, with a runtime per
// printer: its state as the app reports it, and its own write queue (one job at a time, the same deadline and the
// one resend after a refusal made before writing as the device printer, device-printer-write.ts). The app owns every
// link, its reconnects and its list (kept in its own storage, Session 2F2), so the page keeps no list of its own: it
// reads the app's at start and on every v2 status event. The device's own printer (the app's default, which v1
// messages act on) keeps printing through devicePrinter() exactly as before; the others print through here.

/** One of the app's printers, as the page sees it. */
export interface PoolPrinter {
  /** The app's id: "tcp:<host>:<port>", "bt-classic:<MAC>", "ble:<MAC>", "usb:<vendor>:<product>". */
  id: string;
  /** Its record (the device printer store's shape), at the default paper: a printer's paper is the setup's. */
  printer: NativeDevicePrinter;
  status: "connecting" | "connected" | "disconnected";
  message: string | null;
  /** Session 3B (spec §10): what the app says of its paper, cover and error (DLE EOT, Session 3C); absent until then. */
  paper?: PrinterPaperState;
  cover?: PrinterCoverState;
  error?: true;
}

export interface NativePoolSnapshot {
  /** The app speaks bridge v2: this device may print several printers. */
  active: boolean;
  /** The app's printers, in its order. */
  printers: readonly PoolPrinter[];
  /** The one v1 messages act on: this device's own printer (devicePrinter()). */
  defaultId: string | null;
}

export const EMPTY_POOL: NativePoolSnapshot = { active: false, printers: [], defaultId: null };

export interface NativePoolDeps {
  v2(): NativeV2Client | null;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onNativeReady(fn: () => void): () => void;
}

export interface NativePool {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NativePoolSnapshot;
  /** Reads the app's printers and follows their changes (again when a late bridge announces itself). */
  init(): void;
  /** Adds a printer to the app's printers and connects it (the first of an empty list becomes the default). Rejects
   *  with the sentence to show when the app could not answer. */
  add(target: NativeSelectTarget): Promise<ConnectOutcome>;
  reconnect(id: string): Promise<ConnectOutcome>;
  remove(id: string): Promise<void>;
  /** One finished job to that printer, through its own queue. */
  write(id: string, bytes: Uint8Array): Promise<void>;
  printerOf(id: string): PoolPrinter | null;
}

function poolKey(snapshot: NativePoolSnapshot): string {
  return JSON.stringify([snapshot.active, snapshot.defaultId, snapshot.printers.map((p) => [p.id, p.printer.name, p.printer.transport, p.status, p.message, p.paper, p.cover, p.error])]);
}

/** The 2F1 review gate (N-1): what the print agent can print on now, the app's connected printers in its order. A down
 *  printer's own reconnect probes (connecting <-> disconnected) leave it unchanged, so they never nudge the agent. */
export function connectedPoolKey(snapshot: NativePoolSnapshot): string {
  // Session 3C (spec §10): one the app says cannot print is not ready either, so paper put back nudges the agent.
  return snapshot.printers.filter((entry) => entry.status === "connected" && !poolPrinterCannotPrint(entry)).map((entry) => entry.id).join(",");
}

/** Session 3C (spec §10): the POS app says this printer cannot print now (out of paper, its cover open, an error: DLE EOT);
 *  its slips wait, with no lease, until it says it can. */
export function poolPrinterCannotPrint(entry: Pick<PoolPrinter, "paper" | "cover" | "error">): boolean {
  return entry.paper === "out" || entry.cover === "open" || entry.error === true;
}

/** The 3C review gate (m-4): the app's default printer (this device's own, the one simple mode prints on) says it cannot
 *  print, so a device whose slips have no printer of their own is not ready either (no lease while it says so). */
export function poolDefaultCannotPrint(snapshot: NativePoolSnapshot): boolean {
  const entry = snapshot.defaultId === null ? undefined : snapshot.printers.find((printer) => printer.id === snapshot.defaultId);
  return entry !== undefined && poolPrinterCannotPrint(entry);
}

/** The app's list as the page's snapshot; a printer's state "none" (never sent for a listed printer) reads as down. */
export function poolSnapshotOf(status: NativePoolStatus): NativePoolSnapshot {
  const printers: PoolPrinter[] = [];
  for (const entry of status.printers) {
    const view = nativeStatusToSnapshot({ state: entry.state, printer: entry.printer, bluetooth: status.bluetooth }, null);
    if (view.printer === null || view.printer.kind !== "native" || printers.some((p) => p.id === entry.printer.id)) continue;
    const state = view.status === "connecting" || view.status === "connected" ? view.status : "disconnected";
    printers.push({
      id: entry.printer.id,
      printer: view.printer,
      status: state,
      message: view.message,
      ...(entry.paper !== undefined ? { paper: entry.paper } : {}),
      ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
      ...(entry.error === true ? { error: true as const } : {}),
    });
  }
  const defaultId = status.defaultId !== null && printers.some((p) => p.id === status.defaultId) ? status.defaultId : null;
  return { active: true, printers, defaultId };
}

export function createNativePool(deps: NativePoolDeps): NativePool {
  let snapshot: NativePoolSnapshot = EMPTY_POOL;
  let key = poolKey(snapshot);
  const listeners = new Set<() => void>();
  const queues = new Map<string, (bytes: Uint8Array) => Promise<void>>();
  let off: (() => void) | null = null;
  let started = false;
  // The 2F1 review gate (M-5): one kept retry of the first read, however many times start() runs (init, a late bridge).
  let retry: unknown = null;

  // Replaced only when something a reader sees changed, so a repeated status keeps every subscriber still.
  function publish(next: NativePoolSnapshot): void {
    const nextKey = poolKey(next);
    if (nextKey === key) return;
    snapshot = next;
    key = nextKey;
    for (const listener of [...listeners]) listener();
  }

  function printerOf(id: string): PoolPrinter | null {
    return snapshot.printers.find((p) => p.id === id) ?? null;
  }

  function start(): void {
    const client = deps.v2();
    off?.();
    off = null;
    if (retry !== null) deps.clearTimer(retry);
    retry = null;
    if (client === null) {
      publish(EMPTY_POOL);
      return;
    }
    off = client.onStatus((status) => publish(poolSnapshotOf(status)));
    client
      .request("printer.status")
      .then((status) => publish(poolSnapshotOf(status)))
      // An app slow to answer at boot is asked again (the 2E gate's review, M-5); until a list arrives the page acts as
      // on v1, never as a v2 app with no printers (every printer of the setup would then wait).
      .catch(() => {
        if (retry !== null) deps.clearTimer(retry);
        retry = deps.setTimer(start, NATIVE_REQUEST_TIMEOUT_MS);
      });
  }

  async function ask(id: string, run: (client: NativeV2Client) => Promise<NativePoolStatus>): Promise<ConnectOutcome> {
    const client = deps.v2();
    if (client === null) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
    let status: NativePoolStatus;
    try {
      status = await run(client);
    } catch (error) {
      // A connect that timed out may still finish in the app: its status event says so.
      throw new Error(nativeErrorCode(error) === "TIMEOUT" ? PRINTER_CONNECT_FAILED_MESSAGE : nativeErrorMessage(error));
    }
    publish(poolSnapshotOf(status));
    return printerOf(id)?.status === "connected" ? "connected" : "failed";
  }

  async function send(id: string, bytes: Uint8Array): Promise<void> {
    const client = deps.v2();
    if (client === null) throw notConnectedError(PRINTER_NOT_CONNECTED_MESSAGE);
    if (base64CharsFor(bytes.length) > PRINT_DATA_MAX_BASE64_CHARS) throw nativeError("TOO_LARGE", PRINTER_TOO_LARGE_MESSAGE);
    const result = await client.request("printer.print", { printerId: id, data: bytesToBase64(bytes) });
    // The app must have taken every byte; a short count is a failed print.
    if (result.bytes !== bytes.length) throw nativeError("WRITE_FAILED", PRINTER_WRITE_FAILED_MESSAGE);
  }

  function snapshotOf(id: string): PrinterSnapshot {
    const entry = printerOf(id);
    return entry === null ? { status: "none", printer: null, message: null } : { status: entry.status, printer: entry.printer, message: entry.message };
  }

  function queueFor(id: string): (bytes: Uint8Array) => Promise<void> {
    let queue = queues.get(id);
    if (queue === undefined) {
      queue = createWriteQueue({
        requireOwner: () => undefined,
        snapshot: () => snapshotOf(id),
        send: (bytes) => send(id, bytes),
        reconnect: async () => (await ask(id, (client) => client.request("printer.reconnect", { printerId: id })).catch(() => "failed" as const)) === "connected",
        // The app owns the link and its reconnect loop: nothing to mark or tear down on the page.
        markDisconnected: () => undefined,
        abort: async () => undefined,
        now: deps.now,
        setTimer: deps.setTimer,
        clearTimer: deps.clearTimer,
      });
      queues.set(id, queue);
    }
    return queue;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    init() {
      if (started) return;
      started = true;
      deps.onNativeReady(start);
      start();
    },
    add: (target) => ask(nativeTargetId(target), (client) => client.request("printer.select", target)),
    reconnect: (id) => ask(id, (client) => client.request("printer.reconnect", { printerId: id })),
    async remove(id) {
      await ask(id, (client) => client.request("printer.forget", { printerId: id }));
    },
    write: (id, bytes) => queueFor(id)(bytes),
    printerOf,
  };
}

function defaultDeps(): NativePoolDeps {
  return {
    v2: nativeV2Client,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onNativeReady: (fn) => onWindowEvent(NATIVE_READY_EVENT, fn),
  };
}

let instance: NativePool | null = null;
/** This device's app printers: one client-only singleton, like devicePrinter(). */
export function nativePool(): NativePool {
  instance ??= createNativePool(defaultDeps());
  return instance;
}
// Test seam: install (or clear) the singleton.
export function setNativePoolInstance(next: NativePool | null): void {
  instance = next;
}
