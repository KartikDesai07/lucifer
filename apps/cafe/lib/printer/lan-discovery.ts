import { z } from "zod";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { desktopShell } from "@/lib/desktop-shell";
import { nativeHasFeature, nativeRequest } from "@/lib/printer/native-bridge";

// Printing Phase 4 (spec 2026-10-15 §7.3): "Find network printers" on the page. Only where this device's app can scan
// (the POS app that says lanScan, the Windows app 2.0.2): the app tries port 9100 on its own network (nothing is sent)
// and answers the addresses that accepted; the page lists them, marks the ones the setup or the app already has, and a
// tap only fills the address. No request of any kind.

export const FIND_NETWORK_PRINTERS_LABEL = "Find network printers";
export const LAN_SCANNING_MESSAGE = "Looking for printers on this Wi-Fi…";
export const LAN_NONE_FOUND_MESSAGE = "No network printer found on this Wi-Fi. Check that the printer is on and on the same Wi-Fi, or type its address.";
export const LAN_NO_NETWORK_MESSAGE = "This device is not on a Wi-Fi or wired network.";

export function alreadyAddedText(name: string): string {
  return `Already added: ${name}`;
}

export interface LanFound {
  host: string;
  port: number;
}

/** What the scan says: printers found, none, or this device is not on a Wi-Fi or wired network. */
export type LanScanOutcome = { kind: "found"; printers: LanFound[] } | { kind: "none" } | { kind: "no-network" };

const MAX_FOUND = 64;
const answerSchema = z.object({
  found: z.array(z.object({ host: z.string().min(1).max(64), port: z.number().int().min(1).max(65535) })).max(MAX_FOUND),
  subnet: z.string().optional(),
  reason: z.literal("no-network").optional(),
});

/** This device's app can list the network printers on its own network. */
export function lanScanAvailable(): boolean {
  if (nativeHasFeature("lanScan")) return true;
  return typeof desktopShell()?.findLanPrinters === "function";
}

function ipv4Key(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

function byAddress(a: LanFound, b: LanFound): number {
  const x = ipv4Key(a.host);
  const y = ipv4Key(b.host);
  if (x !== null && y !== null && x !== y) return x - y;
  return a.host === b.host ? a.port - b.port : a.host.localeCompare(b.host);
}

/** The app's answer as one of the three outcomes; anything unreadable is none (staff type the address, as today). */
export function lanOutcomeOf(raw: unknown): LanScanOutcome {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return { kind: "none" };
  if (parsed.data.reason === "no-network") return { kind: "no-network" };
  const seen = new Set<string>();
  const printers: LanFound[] = [];
  for (const entry of parsed.data.found) {
    const key = `${entry.host.toLowerCase()}:${entry.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    printers.push({ host: entry.host, port: entry.port });
  }
  printers.sort(byAddress);
  return printers.length === 0 ? { kind: "none" } : { kind: "found", printers };
}

/** One scan through this device's app (up to about 10 s); a failure reads as none found. */
export async function scanNetworkPrinters(): Promise<LanScanOutcome> {
  try {
    if (nativeHasFeature("lanScan")) return lanOutcomeOf(await nativeRequest("network.findPrinters"));
    const shell = desktopShell();
    if (typeof shell?.findLanPrinters === "function") return lanOutcomeOf(await shell.findLanPrinters());
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** A network printer the setup or this device's POS app already has. */
export interface LanKnownPrinter {
  host: string;
  port: number;
  name: string;
}

const APP_TCP_ID = /^tcp:(.+):(\d+)$/;

/** The setup's network printers and the POS app's network printers (its ids are `tcp:<host>:<port>`). */
export function knownLanPrinters(setup: readonly PrinterConfig[], app: ReadonlyArray<{ id: string; name: string }>): LanKnownPrinter[] {
  const known: LanKnownPrinter[] = [];
  for (const printer of setup) {
    if (printer.connection.kind === "lan") known.push({ host: printer.connection.host, port: printer.connection.port, name: printer.name });
  }
  for (const printer of app) {
    const match = APP_TCP_ID.exec(printer.id);
    if (match !== null) known.push({ host: match[1] ?? "", port: Number(match[2]), name: printer.name });
  }
  return known;
}

export interface LanFoundRow {
  host: string;
  port: number;
  label: string;
  /** The name of the printer already added at this address and port, or null. */
  alreadyAdded: string | null;
}

export function lanFoundRows(printers: readonly LanFound[], known: readonly LanKnownPrinter[]): LanFoundRow[] {
  return printers.map((printer) => {
    const match = known.find((entry) => entry.host.toLowerCase() === printer.host.toLowerCase() && entry.port === printer.port);
    return { host: printer.host, port: printer.port, label: `${printer.host} · port ${printer.port}`, alreadyAdded: match?.name ?? null };
  });
}
