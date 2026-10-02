import { quiet, type PaperChoice, type PrinterTransport, type SerialLike, type SerialPortInfoLike, type SerialPortLike, type SerialWriterLike } from "@/lib/printer/web-printer-types";
import type { SerialDevicePrinter } from "@/lib/printer/device-printer-store";

// Web Serial lane: a paired Bluetooth printer (SPP) or, on a PC, a USB-serial
// printer. Bytes go out in 2 KB chunks, each waiting for the writer to be
// ready so a slow link applies back-pressure instead of buffering a slip.
export const SERIAL_BAUD_RATE = 9600;
export const SERIAL_CHUNK_BYTES = 2048;
// Bluetooth Serial Port Profile — the class every paired receipt printer exposes.
export const SPP_SERVICE_CLASS_ID = "00001101-0000-1000-8000-00805f9b34fb";

const BLUETOOTH_BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb";
const SHORT_ID_HEX = /^(?:0x)?([0-9a-f]{1,8})$/;
const SHORT_ID_PAD = 8;
const HEX_RADIX = 16;
const INVALID_STATE_ERROR = "InvalidStateError";

export const SERIAL_BLUETOOTH_NAME = "Bluetooth printer";
export const SERIAL_USB_NAME = "USB printer";
const SERIAL_UNKNOWN_NAME = "Printer";

// A 16/32-bit id (a number, "0x1101" or "1101") widens to the full 128-bit form
// so a saved id compares equal whichever shape an engine reports.
export function normalizeServiceClassId(id: number | string | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (typeof id === "number") {
    return Number.isInteger(id) && id >= 0 ? id.toString(HEX_RADIX).padStart(SHORT_ID_PAD, "0") + BLUETOOTH_BASE_SUFFIX : undefined;
  }
  const lower = id.trim().toLowerCase();
  const short = SHORT_ID_HEX.exec(lower);
  return short ? short[1].padStart(SHORT_ID_PAD, "0") + BLUETOOTH_BASE_SUFFIX : lower === "" ? undefined : lower;
}

export function serialPrinterName(info: SerialPortInfoLike): string {
  if (normalizeServiceClassId(info.bluetoothServiceClassId) !== undefined) return SERIAL_BLUETOOTH_NAME;
  if (info.usbVendorId !== undefined) return SERIAL_USB_NAME;
  return SERIAL_UNKNOWN_NAME;
}

// The record saved for a chosen port: only the identifying fields it reported.
export function serialRecordOf(port: SerialPortLike, paper: PaperChoice): SerialDevicePrinter {
  const info = port.getInfo();
  const classId = normalizeServiceClassId(info.bluetoothServiceClassId);
  return {
    kind: "serial",
    name: serialPrinterName(info),
    paper,
    ...(info.usbVendorId !== undefined && info.usbProductId !== undefined
      ? { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }
      : {}),
    ...(classId !== undefined ? { bluetoothServiceClassId: classId } : {}),
  };
}

// The granted port that is the saved printer, or null. Connecting a new printer
// forgets the others, so a class-id match is unambiguous in practice.
export function matchGrantedPort(ports: readonly SerialPortLike[], saved: SerialDevicePrinter): SerialPortLike | null {
  for (const port of ports) {
    const info = port.getInfo();
    if (saved.usbVendorId !== undefined && info.usbVendorId === saved.usbVendorId && info.usbProductId === saved.usbProductId) return port;
    const classId = normalizeServiceClassId(info.bluetoothServiceClassId);
    if (saved.bluetoothServiceClassId !== undefined && classId === saved.bluetoothServiceClassId) return port;
  }
  return null;
}

async function openPort(port: SerialPortLike): Promise<void> {
  try {
    await port.open({ baudRate: SERIAL_BAUD_RATE });
  } catch (error) {
    // Still open from a link that dropped without closing: close, open once more.
    if ((error as { name?: unknown } | null)?.name !== INVALID_STATE_ERROR) throw error;
    await port.close().catch(() => undefined);
    await port.open({ baudRate: SERIAL_BAUD_RATE });
  }
}

export async function openSerial(port: SerialPortLike): Promise<PrinterTransport> {
  await openPort(port);
  let lostListener: (() => void) | null = null;
  // The writer of the write in flight. A port cannot close while a writer holds its
  // stream (close() rejects), so a teardown must abort and release it first.
  let active: SerialWriterLike | null = null;
  return {
    async write(bytes) {
      const writable = port.writable;
      if (writable === null) throw new Error("The serial port is not writable.");
      const writer = writable.getWriter();
      active = writer;
      try {
        for (let i = 0; i < bytes.length; i += SERIAL_CHUNK_BYTES) {
          await writer.ready;
          await writer.write(bytes.subarray(i, i + SERIAL_CHUNK_BYTES));
        }
      } finally {
        if (active === writer) active = null;
        writer.releaseLock();
      }
    },
    async close() {
      if (lostListener !== null) port.removeEventListener?.("disconnect", lostListener);
      lostListener = null;
      const held = active;
      active = null;
      if (held !== null) {
        await quiet(() => held.abort());
        await quiet(async () => held.releaseLock());
      }
      await port.close();
    },
    onLost(listener) {
      lostListener = listener;
      port.addEventListener?.("disconnect", listener);
    },
  };
}

// The saved printer's granted port, opened — or null when nothing granted
// matches (a reload, a revoked permission): the caller asks for a tap.
export async function openSavedSerial(
  api: SerialLike | null,
  saved: SerialDevicePrinter,
): Promise<{ transport: PrinterTransport; port: SerialPortLike } | null> {
  const match = api === null ? null : matchGrantedPort(await api.getPorts(), saved);
  return match === null ? null : { transport: await openSerial(match), port: match };
}

// The chooser. Call it FIRST in a click handler: it needs the click's activation.
export function requestSerialPort(api: SerialLike): Promise<SerialPortLike> {
  return api.requestPort({ allowedBluetoothServiceClassIds: [SPP_SERVICE_CLASS_ID] });
}

// A chosen port: open it, build its record, then forget every other granted
// port so a later match by class id is unambiguous.
export async function openChosenSerial(
  api: SerialLike,
  port: SerialPortLike,
  paper: PaperChoice,
): Promise<{ transport: PrinterTransport; record: SerialDevicePrinter }> {
  const transport = await openSerial(port);
  await quiet(async () => {
    for (const other of await api.getPorts()) if (other !== port) await quiet(() => other.forget?.());
  });
  return { transport, record: serialRecordOf(port, paper) };
}
