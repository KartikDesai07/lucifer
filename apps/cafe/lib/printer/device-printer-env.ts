import { createDevicePrinter } from "@/lib/printer/device-printer";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { BLE_CHAR, BLE_SERVICE, makeClock, type SerialFake } from "@/lib/printer/device-printer-fakes";
import type { NativeClient } from "@/lib/printer/native-bridge";
import type { BluetoothLike, DevicePrinterDeps } from "@/lib/printer/web-printer-types";

// Test-only: an app-bridge client fake, the saved-printer records, and an
// environment that wires every fake into createDevicePrinter.

export type Responder = (params: unknown) => unknown;
export function nativeFake() {
  const calls: { method: string; params: unknown }[] = [];
  const responders = new Map<string, Responder>();
  const listeners = new Set<(data: unknown) => void>();
  const client = {
    request: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      const respond = responders.get(method);
      if (!respond) throw new Error(`no responder for ${method}`);
      return respond(params);
    },
    on: (_event: string, fn: (data: unknown) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  } as unknown as NativeClient;
  return {
    client,
    calls,
    listeners,
    respond: (method: string, fn: Responder) => void responders.set(method, fn),
    emit: (data: unknown) => [...listeners].forEach((fn) => fn(data)),
    count: (method: string): number => calls.filter((c) => c.method === method).length,
  };
}

export const NATIVE_PRINTER_INFO = { id: "AA:BB", name: "Counter", transport: "bt-classic" };
export const nativeStatus = (state: string, printer: unknown = NATIVE_PRINTER_INFO, bluetooth = "on") => ({ state, printer, bluetooth });

export type OwnershipMode = "owner" | "elsewhere" | "manual";

export function makeEnv(options: {
  stored?: DevicePrinter | null;
  serial?: SerialFake | null;
  bluetooth?: BluetoothLike | null;
  native?: ReturnType<typeof nativeFake> | null;
  ownership?: OwnershipMode;
} = {}) {
  const clock = makeClock();
  const env = {
    clock,
    serial: options.serial ?? null,
    bluetooth: options.bluetooth ?? null,
    native: options.native ?? null,
    store: { value: options.stored ?? null, writes: 0 },
    acquireCalls: 0,
    grant: (): void => undefined,
    deny: (): void => undefined,
    ready: (): void => undefined,
    storeChanged: (): void => undefined,
  };
  const mode = options.ownership ?? "owner";
  const deps: DevicePrinterDeps = {
    serial: () => env.serial,
    bluetooth: () => env.bluetooth,
    native: () => env.native?.client ?? null,
    readStore: () => env.store.value,
    writeStore: (printer) => {
      env.store.value = printer;
      env.store.writes += 1;
    },
    watchStore: (fn) => {
      env.storeChanged = fn;
      return () => undefined;
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    acquireOwnership: (onOwner, onElsewhere) => {
      env.acquireCalls += 1;
      env.grant = onOwner;
      env.deny = onElsewhere;
      if (mode === "owner") onOwner();
      else if (mode === "elsewhere") onElsewhere();
    },
    onNativeReady: (fn) => {
      env.ready = fn;
      return () => undefined;
    },
  };
  return Object.assign(env, { printer: createDevicePrinter(deps) });
}

export const SERIAL_RECORD: DevicePrinter = {
  kind: "serial",
  name: "Bluetooth printer",
  paper: "80mm",
  bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb",
};
export const BLE_RECORD: DevicePrinter = {
  kind: "ble",
  name: "Kitchen",
  paper: "58mm",
  deviceId: "ble-1",
  serviceUuid: BLE_SERVICE,
  characteristicUuid: BLE_CHAR,
};
export const NATIVE_RECORD: DevicePrinter = { kind: "native", name: "Counter", paper: "58mm", printerId: "AA:BB", transport: "bt-classic" };
