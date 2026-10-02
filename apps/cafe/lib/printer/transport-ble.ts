import { NAME_MAX_CHARS, type BleDevicePrinter } from "@/lib/printer/device-printer-store";
import type {
  BleCharacteristicLike,
  BleDeviceLike,
  BleServerLike,
  BluetoothLike,
  PaperChoice,
  PrinterTransport,
} from "@/lib/printer/web-printer-types";

// Web Bluetooth (BLE GATT) lane. Receipt printers expose a writable
// characteristic under one of a few well-known services; those are tried first,
// then any writable characteristic the printer offers.
export const BLE_CHUNK_BYTES = 180;
export const BLE_CHUNK_PAUSE_MS = 20;
const BLE_UNNAMED_PRINTER = "Bluetooth printer";

export interface BlePrinterService {
  readonly service: string;
  // null where the research named no write characteristic: discover it.
  readonly characteristic: string | null;
}

export const BLE_PRINTER_SERVICES: readonly BlePrinterService[] = [
  { service: "000018f0-0000-1000-8000-00805f9b34fb", characteristic: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", characteristic: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
  { service: "0000ff00-0000-1000-8000-00805f9b34fb", characteristic: "0000ff02-0000-1000-8000-00805f9b34fb" },
  { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", characteristic: null },
  { service: "0000ae30-0000-1000-8000-00805f9b34fb", characteristic: "0000ae01-0000-1000-8000-00805f9b34fb" },
];
export const BLE_PRINTER_SERVICE_UUIDS: string[] = BLE_PRINTER_SERVICES.map((row) => row.service);

export type BleWriteMode = "with-response" | "without-response";
export type Sleep = (ms: number) => Promise<void>;

// "Without response" only when that is the sole write property.
export function bleWriteMode(props: BleCharacteristicLike["properties"]): BleWriteMode | null {
  if (props.write) return "with-response";
  return props.writeWithoutResponse ? "without-response" : null;
}

export interface BleWriteTarget {
  serviceUuid: string;
  characteristic: BleCharacteristicLike;
}

function firstWritable(characteristics: BleCharacteristicLike[]): BleCharacteristicLike | null {
  return characteristics.find((c) => bleWriteMode(c.properties) !== null) ?? null;
}

async function inKnownServices(server: BleServerLike): Promise<BleWriteTarget | null> {
  for (const row of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(row.service);
      const found =
        row.characteristic !== null
          ? await service.getCharacteristic(row.characteristic)
          : await firstWritable(await service.getCharacteristics());
      if (found !== null && bleWriteMode(found.properties) !== null) return { serviceUuid: row.service, characteristic: found };
    } catch {
      // This printer does not carry that service — try the next row.
    }
  }
  return null;
}

async function inAnyService(server: BleServerLike): Promise<BleWriteTarget | null> {
  for (const service of await server.getPrimaryServices()) {
    const found = await firstWritable(await service.getCharacteristics());
    if (found !== null) return { serviceUuid: service.uuid, characteristic: found };
  }
  return null;
}

// The saved pair first (cheap, exact), then the known table, then any service.
export async function findWritableCharacteristic(
  server: BleServerLike,
  saved?: { serviceUuid: string; characteristicUuid: string },
): Promise<BleWriteTarget | null> {
  if (saved) {
    try {
      const characteristic = await (await server.getPrimaryService(saved.serviceUuid)).getCharacteristic(saved.characteristicUuid);
      if (bleWriteMode(characteristic.properties) !== null) return { serviceUuid: saved.serviceUuid, characteristic };
    } catch {
      // The printer changed its layout: fall through to discovery.
    }
  }
  return (await inKnownServices(server)) ?? (await inAnyService(server));
}

async function writeOne(characteristic: BleCharacteristicLike, chunk: Uint8Array): Promise<void> {
  if (bleWriteMode(characteristic.properties) === "without-response" && characteristic.writeValueWithoutResponse) {
    return characteristic.writeValueWithoutResponse(chunk);
  }
  if (characteristic.writeValueWithResponse) return characteristic.writeValueWithResponse(chunk);
  if (characteristic.writeValue) return characteristic.writeValue(chunk);
  throw new Error("The printer does not accept writes.");
}

export interface BleLink {
  transport: PrinterTransport;
  serviceUuid: string;
  characteristicUuid: string;
}

// Connects the GATT server (no gesture needed) and returns a write transport.
export async function connectBle(
  device: BleDeviceLike,
  sleep: Sleep,
  saved?: { serviceUuid: string; characteristicUuid: string },
): Promise<BleLink> {
  if (!device.gatt) throw new Error("The Bluetooth printer has no GATT server.");
  const server = await device.gatt.connect();
  const target = await findWritableCharacteristic(server, saved);
  if (target === null) {
    server.disconnect();
    throw new Error("The Bluetooth printer has nothing to write to.");
  }
  let lostListener: (() => void) | null = null;
  const transport: PrinterTransport = {
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += BLE_CHUNK_BYTES) {
        if (!server.connected) throw new Error("The Bluetooth printer disconnected.");
        await writeOne(target.characteristic, bytes.subarray(i, i + BLE_CHUNK_BYTES));
        if (i + BLE_CHUNK_BYTES < bytes.length) await sleep(BLE_CHUNK_PAUSE_MS);
      }
    },
    async close() {
      if (lostListener !== null) device.removeEventListener("gattserverdisconnected", lostListener);
      lostListener = null;
      if (server.connected) server.disconnect();
    },
    onLost(listener) {
      lostListener = listener;
      device.addEventListener("gattserverdisconnected", listener);
    },
  };
  return { transport, serviceUuid: target.serviceUuid, characteristicUuid: target.characteristic.uuid };
}

export function bleRecordOf(device: BleDeviceLike, paper: PaperChoice, link: BleLink): BleDevicePrinter {
  return {
    kind: "ble",
    name: device.name && device.name.length > 0 ? device.name.slice(0, NAME_MAX_CHARS) : BLE_UNNAMED_PRINTER,
    paper,
    deviceId: device.id,
    serviceUuid: link.serviceUuid,
    characteristicUuid: link.characteristicUuid,
  };
}

// The saved device — the one already in memory, else getDevices (flag-gated, so
// absent or failing reads as unavailable); null asks for a tap. Resolved BEFORE
// connecting so the caller can hold it while the connect is still pending.
export async function resolveSavedBle(
  api: BluetoothLike | null,
  known: BleDeviceLike | null,
  saved: BleDevicePrinter,
): Promise<BleDeviceLike | null> {
  if (known !== null && known.id === saved.deviceId) return known;
  try {
    return (await api?.getDevices?.())?.find((d) => d.id === saved.deviceId) ?? null;
  } catch {
    return null;
  }
}

export async function openSavedBle(
  api: BluetoothLike | null,
  known: BleDeviceLike | null,
  saved: BleDevicePrinter,
  sleep: Sleep,
): Promise<{ transport: PrinterTransport; device: BleDeviceLike } | null> {
  const device = await resolveSavedBle(api, known, saved);
  return device === null ? null : { transport: (await connectBle(device, sleep, saved)).transport, device };
}

// The chooser. Call it FIRST in a click handler: it needs the click's activation.
export function requestBleDevice(api: BluetoothLike): Promise<BleDeviceLike> {
  return api.requestDevice({ acceptAllDevices: true, optionalServices: BLE_PRINTER_SERVICE_UUIDS });
}

export async function openChosenBle(
  device: BleDeviceLike,
  paper: PaperChoice,
  sleep: Sleep,
): Promise<{ transport: PrinterTransport; record: BleDevicePrinter }> {
  const link = await connectBle(device, sleep);
  return { transport: link.transport, record: bleRecordOf(device, paper, link) };
}
