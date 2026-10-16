import { z } from "zod";

import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing Phase 4 (spec 2026-10-15 §5.1, P4-3, S1, S2): the "Fast text KOTs" switch of each printer this device prints,
// kept only in this device's storage, under its own key (never inside the device printer's strict record, which an open
// older page would then fail to read). A printer is on when its key is here; only the 80 mm "42 characters per line"
// choice is kept, never the columns (they come from the printer's paper at each print). Like the device printer's store,
// every access is try/caught and anything absent, unreadable or foreign reads as every switch off: today's pictures.

export const TEXT_KOT_KEY = "pos.text-kot.v1";

/** A printer whose switch is on: whether its 80 mm paper prints 42 characters per line instead of 48. */
export interface TextKotChoice {
  narrow80: boolean;
}

const KEY_MAX_CHARS = 400;
const choiceSchema = z.object({ narrow80: z.boolean() }).strict();
const recordSchema = z.object({ v: z.literal(1), printers: z.record(z.string().min(1).max(KEY_MAX_CHARS), choiceSchema) }).strict();
type TextKotRecord = z.infer<typeof recordSchema>;

/** How this device reaches a printer, exactly as the picture's writer does: this device's own printer (the POS app's, a
 *  serial or a Bluetooth LE printer), one of the POS app's printers by the app's id (bridge v2), a network printer of the
 *  Windows app by its address, or a Windows printer by its name. */
export type TextKotReach =
  | DevicePrinter
  | { kind: "app"; nativeId: string }
  | { kind: "lan"; host: string; port: number }
  | { kind: "windows"; name: string };

function reachOf(reach: TextKotReach): string {
  switch (reach.kind) {
    case "native":
      return `native:${reach.printerId}`;
    case "serial":
      // A serial printer with no USB ids (a Bluetooth serial port) by its name: the planning review's m-8.
      return reach.usbVendorId !== undefined && reach.usbProductId !== undefined ? `serial:${reach.usbVendorId}:${reach.usbProductId}` : `serial:${reach.name}`;
    case "ble":
      return `ble:${reach.deviceId}`;
    case "app":
      return `app:${reach.nativeId}`;
    case "lan":
      return `lan:${reach.host}:${reach.port}`;
    case "windows":
      return `windows:${reach.name}`;
  }
}

/** A setup printer's key (printers mode): its id and how this device reaches it, so a printer pointed elsewhere in Printer
 *  setup, or reached here through another printer, is a new key, off until its own text test printed (the planning
 *  review's I-2). Lower-cased: the app spells a MAC upper-case, the setup may not. */
export function textKotKeyForPrinter(printerId: string, reach: TextKotReach): string {
  return `printer:${printerId}:${reachOf(reach)}`.toLowerCase();
}

/** This device's own printer's key (simple mode). */
export function textKotKeyForDevice(reach: TextKotReach): string {
  return `device:${reachOf(reach)}`.toLowerCase();
}

function readRecord(): TextKotRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEXT_KOT_KEY);
    if (raw === null) return null;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** That printer's switch: its choice when on, null when off (or when nothing can be read). */
export function readTextKot(key: string): TextKotChoice | null {
  const record = readRecord();
  return record !== null && Object.hasOwn(record.printers, key) ? { narrow80: record.printers[key].narrow80 } : null;
}

const listeners = new Set<() => void>();
let unwatch: (() => void) | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Turns that printer on (with its choice) or off (null); every other printer's switch stays as it is. A blocked storage
 *  keeps nothing: the printer then prints pictures. */
export function writeTextKot(key: string, choice: TextKotChoice | null): void {
  if (typeof window === "undefined") return;
  try {
    const printers = { ...(readRecord()?.printers ?? {}) };
    if (choice === null) delete printers[key];
    else printers[key] = { narrow80: choice.narrow80 };
    if (Object.keys(printers).length === 0) window.localStorage.removeItem(TEXT_KOT_KEY);
    else window.localStorage.setItem(TEXT_KOT_KEY, JSON.stringify({ v: 1, printers }));
  } catch {
    // Nothing kept, nothing crashed.
  }
  notify();
}

/** A switch changed on this page or in another tab of this browser (the `storage` event never fires in the tab that
 *  wrote). Returns the remover. */
export function subscribeTextKot(onChange: () => void): () => void {
  listeners.add(onChange);
  if (unwatch === null && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const handler = (event: StorageEvent): void => {
      if (event.key === null || event.key === TEXT_KOT_KEY) notify();
    };
    window.addEventListener("storage", handler);
    unwatch = () => window.removeEventListener("storage", handler);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && unwatch !== null) {
      unwatch();
      unwatch = null;
    }
  };
}
