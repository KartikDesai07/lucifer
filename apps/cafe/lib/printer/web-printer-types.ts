import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { NativeClient } from "@/lib/printer/native-bridge";
import type { NativePrinter } from "@/lib/printer/native-bridge-protocol";
import type { NativeSelectTarget } from "@/lib/printer/transport-native";

// Minimal STRUCTURAL types for the browser printer APIs (Web Serial, Web
// Bluetooth) — only the members this app touches, so nothing needs a global
// augmentation of `navigator` and a test can hand in a plain-object fake. The
// real objects satisfy these at runtime; capabilities.ts is the one place they
// are read off `navigator`.

export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
  // A number or a UUID string, depending on the engine.
  bluetoothServiceClassId?: number | string;
}

export interface SerialWriterLike {
  readonly ready: Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
  // Rejects a write still in flight; the stream is only closable once the lock is back.
  abort(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

export interface SerialPortLike {
  readonly writable: { getWriter(): SerialWriterLike } | null;
  getInfo(): SerialPortInfoLike;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  addEventListener?(type: "disconnect", listener: () => void): void;
  removeEventListener?(type: "disconnect", listener: () => void): void;
}

export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { allowedBluetoothServiceClassIds?: string[] }): Promise<SerialPortLike>;
}

export interface BleCharacteristicLike {
  readonly uuid: string;
  readonly properties: { readonly write: boolean; readonly writeWithoutResponse: boolean };
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  // The older combined call, still the only one some engines expose.
  writeValue?(value: Uint8Array): Promise<void>;
}

export interface BleServiceLike {
  readonly uuid: string;
  getCharacteristic(uuid: string): Promise<BleCharacteristicLike>;
  getCharacteristics(): Promise<BleCharacteristicLike[]>;
}

export interface BleServerLike {
  readonly connected: boolean;
  connect(): Promise<BleServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleServiceLike>;
  getPrimaryServices(): Promise<BleServiceLike[]>;
}

export interface BleDeviceLike {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BleServerLike;
  forget?(): Promise<void>;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
  removeEventListener(type: "gattserverdisconnected", listener: () => void): void;
}

export interface BluetoothLike {
  requestDevice(options: { acceptAllDevices: true; optionalServices: string[] }): Promise<BleDeviceLike>;
  // Flag-gated in current engines — callers must feature-detect.
  getDevices?(): Promise<BleDeviceLike[]>;
}

// What the runtime sees of an opened link, whatever the lane.
export interface PrinterTransport {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  // The link dropped by itself (cable, power, range). One listener.
  onLost(listener: () => void): void;
}

export type PrinterStatus = "none" | "connecting" | "connected" | "disconnected" | "needs-tap" | "elsewhere";

// Immutable; replaced (never mutated) on every change.
export interface PrinterSnapshot {
  status: PrinterStatus;
  printer: DevicePrinter | null;
  message: string | null;
}

export type PaperChoice = DevicePrinter["paper"];

export const PRINTER_NOT_CONNECTED_MESSAGE =
  "The printer is not connected. Tap the printer icon and reconnect it, then print the slip again.";
export const PRINTER_WRITE_FAILED_MESSAGE =
  "The printer stopped answering. Check the paper first: part or all of this slip may already have printed. Reconnect, then reprint only if needed.";
export const PRINTER_TOO_LARGE_MESSAGE = "This slip is too long to print.";
export const PRINTER_ELSEWHERE_MESSAGE = "The printer is in use in another tab. Print from that tab, or close it.";

// Best-effort cleanup (close, forget, disconnect): a failure here has nothing
// useful to tell the operator.
export async function quiet(run: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await run();
  } catch {
    // Swallowed on purpose.
  }
}

// The device printer runtime's seams and surface (device-printer.ts builds it).
export type ConnectOutcome = "connected" | "cancelled" | "failed";

export interface DevicePrinterDeps {
  serial(): SerialLike | null;
  bluetooth(): BluetoothLike | null;
  native(): NativeClient | null;
  readStore(): DevicePrinter | null;
  writeStore(printer: DevicePrinter | null): void;
  watchStore(onChange: () => void): () => void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  acquireOwnership(onOwner: () => void, onElsewhere: () => void): void;
  onNativeReady(fn: () => void): () => void;
}

export interface DevicePrinterRuntime {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PrinterSnapshot;
  init(): void;
  /** Call straight from a click: the chooser is the first await. Rejects only when refused (not the owner tab). */
  connectNew(kind: "serial" | "ble", paper: PaperChoice): Promise<ConnectOutcome>;
  selectNative(target: NativeSelectTarget, paper: PaperChoice): Promise<ConnectOutcome>;
  listNative(scan: boolean): Promise<NativePrinter[]>;
  reconnect(): Promise<ConnectOutcome>;
  setPaper(paper: PaperChoice): void;
  write(bytes: Uint8Array): Promise<void>;
  forget(): Promise<void>;
}
