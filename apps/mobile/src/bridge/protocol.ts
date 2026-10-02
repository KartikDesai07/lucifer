// Native bridge contract v1. The web copy lives in
// apps/cafe/lib/printer/native-bridge-protocol.ts; a parity test diffs the two,
// so keep every list below byte-for-byte equal to it (order included).

export const NATIVE_METHODS = [
  'app.info',
  'printer.status',
  'printer.list',
  'printer.select',
  'printer.reconnect',
  'printer.forget',
  'printer.print',
  'permissions.request',
  'bluetooth.enable',
  'host.background',
  'app.changeUrl',
] as const;
export type NativeMethod = (typeof NATIVE_METHODS)[number];

export const NATIVE_EVENTS = ['printer.status', 'app.wake'] as const;
export type NativeEvent = (typeof NATIVE_EVENTS)[number];

export const NATIVE_TRANSPORTS = ['bt-classic', 'ble', 'tcp', 'usb'] as const;
export type NativeTransport = (typeof NATIVE_TRANSPORTS)[number];

export const NATIVE_PRINTER_STATES = [
  'none',
  'connecting',
  'connected',
  'disconnected',
] as const;
export type NativePrinterState = (typeof NATIVE_PRINTER_STATES)[number];

export const NATIVE_BLUETOOTH_STATES = [
  'on',
  'off',
  'unauthorized',
  'unsupported',
] as const;
export type NativeBluetoothState = (typeof NATIVE_BLUETOOTH_STATES)[number];

export const NATIVE_ERROR_CODES = [
  'NOT_CONNECTED',
  'WRITE_FAILED',
  'TOO_LARGE',
  'BUSY',
  'TIMEOUT',
  'UNAUTHORIZED',
  'BLUETOOTH_OFF',
  'UNSUPPORTED',
  'BAD_REQUEST',
  'LOCATION_OFF',
] as const;
export type NativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

export const NATIVE_PERMISSION_KINDS = ['bluetooth', 'notifications'] as const;
export type NativePermissionKind = (typeof NATIVE_PERMISSION_KINDS)[number];

export const NATIVE_PLATFORMS = ['android', 'ios'] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

export const NATIVE_BRIDGE_VERSION = 1;
export const PRINTER_SCAN_MS = 8_000;
export const PRINT_DATA_MAX_BASE64_CHARS = 2_000_000;
export const BRIDGE_MESSAGE_MAX_CHARS = 2_100_000;
export const NATIVE_APP_ID = 'pos-mobile';
export const NATIVE_GLOBAL = 'PosNative';
export const NATIVE_DELIVER_FN = '__posNativeDeliver';

export type NativePrinter = {
  id: string;
  name: string;
  transport: NativeTransport;
  address?: string;
  paired?: boolean;
};

export type PrinterStatus = {
  state: NativePrinterState;
  printer: NativePrinter | null;
  bluetooth: NativeBluetoothState;
};

// What the page receives (through window.__posNativeDeliver).
export type BridgeReply =
  | { v: 1; id: string; ok: true; result: unknown }
  | {
      v: 1;
      id: string;
      ok: false;
      error: { code: NativeErrorCode; message: string };
    };
export type BridgeEventMessage = { v: 1; event: NativeEvent; data: unknown };
export type DeliverMessage = BridgeReply | BridgeEventMessage;
