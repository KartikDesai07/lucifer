// The POS app <-> web page bridge contract, version 1. Mirrored 1:1 by
// apps/mobile/src/bridge/protocol.ts — a parity test diffs the two files, so
// every list is a plain `export const NAME = [...] as const;` and every scalar a
// plain literal (no Zod, no computed values, no helper wrappers).

export const NATIVE_METHODS = [
  "app.info",
  "printer.status",
  "printer.list",
  "printer.select",
  "printer.reconnect",
  "printer.forget",
  "printer.print",
  "permissions.request",
  "bluetooth.enable",
  "host.background",
  "app.changeUrl",
  "app.battery",
] as const;
export type NativeMethod = (typeof NATIVE_METHODS)[number];

export const NATIVE_EVENTS = ["printer.status", "app.wake"] as const;
export type NativeEvent = (typeof NATIVE_EVENTS)[number];

export const NATIVE_TRANSPORTS = ["bt-classic", "ble", "tcp", "usb"] as const;
export type NativeTransport = (typeof NATIVE_TRANSPORTS)[number];

export const NATIVE_PRINTER_STATES = ["none", "connecting", "connected", "disconnected"] as const;
export type NativePrinterState = (typeof NATIVE_PRINTER_STATES)[number];

export const NATIVE_BLUETOOTH_STATES = ["on", "off", "unauthorized", "unsupported"] as const;
export type NativeBluetoothState = (typeof NATIVE_BLUETOOTH_STATES)[number];

export const NATIVE_ERROR_CODES = [
  "NOT_CONNECTED",
  "WRITE_FAILED",
  "TOO_LARGE",
  "BUSY",
  "TIMEOUT",
  "UNAUTHORIZED",
  "BLUETOOTH_OFF",
  "UNSUPPORTED",
  "BAD_REQUEST",
  "LOCATION_OFF",
] as const;
export type NativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

export const NATIVE_PERMISSION_KINDS = ["bluetooth", "notifications"] as const;
export type NativePermissionKind = (typeof NATIVE_PERMISSION_KINDS)[number];

export const NATIVE_PLATFORMS = ["android", "ios"] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

// Phase 3 Session 3D: what the POS app can do beyond the method list (window.PosNative.features); a control is shown
// only when the app says it (an older app says nothing).
export const NATIVE_FEATURES = ["battery"] as const;
export type NativeFeature = (typeof NATIVE_FEATURES)[number];

export const NATIVE_BRIDGE_VERSION = 1;
// How long the app scans for nearby printers when asked to (printer.list scan).
export const PRINTER_SCAN_MS = 8_000;
// A print job travels as base64 inside one bridge message; the app refuses more.
export const PRINT_DATA_MAX_BASE64_CHARS = 2_000_000;
export const BRIDGE_MESSAGE_MAX_CHARS = 2_100_000;
export const NATIVE_APP_ID = "pos-mobile";
// Names the app's injected script defines on the page's window.
export const NATIVE_GLOBAL = "PosNative";
export const NATIVE_DELIVER_FN = "__posNativeDeliver";

// The port a network (tcp) receipt printer listens on unless told otherwise.
export const DEFAULT_TCP_PRINTER_PORT = 9100;

export interface NativePrinter {
  id: string;
  name: string;
  transport: NativeTransport;
  address?: string;
  paired?: boolean;
}

export interface NativePrinterStatus {
  state: NativePrinterState;
  printer: NativePrinter | null;
  bluetooth: NativeBluetoothState;
}

export interface PosNativeApi {
  readonly version: number;
  readonly platform: NativePlatform;
  /** Phase 3 Session 3D: absent on an app from before it. */
  readonly features?: readonly string[];
  request(method: NativeMethod, params?: unknown): Promise<unknown>;
  on(event: NativeEvent, fn: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    PosNative?: PosNativeApi;
  }
}
