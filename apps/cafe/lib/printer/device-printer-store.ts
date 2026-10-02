import { z } from "zod";

import { PAPER_WIDTHS } from "@/lib/constants";
import { NATIVE_TRANSPORTS } from "@/lib/printer/native-bridge-protocol";

// The one printer THIS device prints to — a per-device localStorage record
// (pos.device-prefs.v1 is untouched). Same safe-read/write discipline as
// lib/pos-device-prefs.ts: a staff device's storage is outside this app's
// control, so every access is try/caught and an invalid value reads as "no
// printer" rather than throwing. Zero React, nothing touches the DOM at module
// evaluation.
export const DEVICE_PRINTER_KEY = "pos.device-printer.v1";

export const NAME_MAX_CHARS = 120;
const ID_MAX_CHARS = 300;
const USB_ID_MAX = 0xffff;

const nameField = z.string().min(1).max(NAME_MAX_CHARS);
const idField = z.string().min(1).max(ID_MAX_CHARS);
const usbIdField = z.number().int().min(0).max(USB_ID_MAX);

export const devicePrinterSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("serial"),
      name: nameField,
      paper: z.enum(PAPER_WIDTHS),
      usbVendorId: usbIdField.optional(),
      usbProductId: usbIdField.optional(),
      bluetoothServiceClassId: idField.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ble"),
      name: nameField,
      paper: z.enum(PAPER_WIDTHS),
      deviceId: idField,
      serviceUuid: idField,
      characteristicUuid: idField,
    })
    .strict(),
  z
    .object({
      kind: z.literal("native"),
      name: nameField,
      paper: z.enum(PAPER_WIDTHS),
      printerId: idField,
      transport: z.enum(NATIVE_TRANSPORTS),
    })
    .strict(),
]);

export type DevicePrinter = z.infer<typeof devicePrinterSchema>;
export type SerialDevicePrinter = Extract<DevicePrinter, { kind: "serial" }>;
export type BleDevicePrinter = Extract<DevicePrinter, { kind: "ble" }>;
export type NativeDevicePrinter = Extract<DevicePrinter, { kind: "native" }>;

// The stored string -> a printer, or null for anything absent/corrupt/foreign.
export function parseDevicePrinter(raw: string | null): DevicePrinter | null {
  if (raw === null) return null;
  try {
    const parsed = devicePrinterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readDevicePrinter(): DevicePrinter | null {
  if (typeof window === "undefined") return null;
  try {
    return parseDevicePrinter(window.localStorage.getItem(DEVICE_PRINTER_KEY));
  } catch {
    return null;
  }
}

// null removes the record. A quota/disabled-storage failure is swallowed — the
// printer then simply has to be chosen again next load.
export function writeDevicePrinter(printer: DevicePrinter | null): void {
  if (typeof window === "undefined") return;
  try {
    if (printer === null) window.localStorage.removeItem(DEVICE_PRINTER_KEY);
    else window.localStorage.setItem(DEVICE_PRINTER_KEY, JSON.stringify(printer));
  } catch {
    // Nothing persisted, nothing crashed.
  }
}

// Another tab of this browser changed (or cleared) the record. The `storage`
// event never fires in the tab that wrote it. Returns the remover.
export function watchDevicePrinter(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => undefined;
  const handler = (event: StorageEvent): void => {
    if (event.key === null || event.key === DEVICE_PRINTER_KEY) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
