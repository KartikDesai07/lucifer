"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { usePrintWaitingPrinters } from "@/components/layout/print-waiting-context";
import { useDesktopLan, useDesktopPrinterSnapshot, useDevicePrinter, useNativePool, usePrintLane } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { heldPoolOf, printersHereOf, printersNotHereOf } from "@/lib/print-agent-here";
import { agentPrintersOf, dotPrintersOf, lanPrintersToAdd, lanPrintersToRemove, ownPrinterInSetup, type AgentPrinters, type DesktopPrinters, type NativePoolView } from "@/lib/print-agent-printers";
import { onPrintersWritingChange, onTakenOverChange, printersBeingWritten, takenOverPrinterIds } from "@/lib/print-agent-seams";
import { waitingPrintersOf } from "@/lib/print-waiting";
import { DESKTOP_LAN_CHECK_MS, desktopLan, desktopLanApi, type DesktopLanPrinter, type DesktopLanTarget } from "@/lib/printer/desktop-lan";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { PAGE_HELD_STATUS, heldPrinterStatusOf } from "@/lib/printer/held-status";
import { nativePool, type NativePoolSnapshot } from "@/lib/printer/native-pool";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";
import { subscribeRealtime } from "@/lib/realtime-client";

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 30 min (the fallback when a frame was missed; print-budget.test.ts). Never
// a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];
const NO_STATIONS: StationConfig[] = [];
const NO_IDS: readonly string[] = [];

/** Printing Phase 5 (spec 5.3): the printers read carries the stations in the same one request (`?stations=1`), so an
 *  offline KOT is routed on the device as the server routes it. An older server answers the plain list: no stations. */
export interface PrintersRead {
  printers: PrinterConfig[];
  stations: StationConfig[];
}

export async function readPrinters(): Promise<PrintersRead> {
  const data = await apiGet<PrinterConfig[] | PrintersRead>("/api/printers?stations=1");
  return Array.isArray(data) ? { printers: data, stations: NO_STATIONS } : data;
}

/** The printers in the cache entry (a screen that reads it without an observer of its own). */
export const printersOfRead = (data: PrintersRead | undefined): PrinterConfig[] => data?.printers ?? NO_PRINTERS;

/** Session 2D: the printers read for a screen that only shows them (the dot, the bill printer, the setup page): the
 *  same cache entry as the agent's, without a print-setup subscription of its own, so an admin save costs one read
 *  per device, never one per screen (the 2D gate's review, M-5). `loaded` is false until the first answer (and again
 *  while a refetch has failed); `answered`: some answer is in hand (a failed refetch keeps it; the final Phase 2 gate). */
export function usePrintersRead(enabled: boolean): { printers: PrinterConfig[]; stations: StationConfig[]; loaded: boolean; failed: boolean; answered: boolean } {
  const query = useQuery({
    queryKey: PRINTERS_KEYS.all,
    queryFn: readPrinters,
    enabled,
    staleTime: PRINTERS_STALE_MS,
    refetchOnWindowFocus: true,
  });
  return { printers: printersOfRead(query.data), stations: query.data?.stations ?? NO_STATIONS, loaded: query.isSuccess, failed: query.isError, answered: query.data !== undefined };
}

/** The agent's read: the same query, plus the one print-setup subscription. Session 2E: the Windows app's own printer
 *  list is read again with every printers read (a local call to the app, no request), so a printer just added in
 *  Windows and saved in the setup is this PC's at once. */
export function usePrinters(enabled: boolean): PrinterConfig[] {
  const qc = useQueryClient();
  const { printers } = usePrintersRead(enabled);
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((kind) => {
      if (kind === "print-setup") void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    });
  }, [enabled, qc]);
  useEffect(() => {
    if (enabled && isDesktopShell()) void refreshDesktopPrinterChosen();
  }, [enabled, printers]);
  return printers;
}

/** Session 2E (spec §9.2): the Windows app's printers, by name; null on any other device. */
export function useDesktopPrinters(): DesktopPrinters | null {
  const snapshot = useDesktopPrinterSnapshot();
  const lane = usePrintLane();
  // Phase 3 Session 3E: `lan`, the app writes network printers itself (1.12.0).
  return useMemo(() => (lane === "desktop" ? { selected: snapshot.selected, names: snapshot.names, named: desktopPrintsOnNamed(), lan: desktopLanApi() !== null } : null), [lane, snapshot]);
}

/** Session 2F1 (spec §9.2): the POS app's printers on bridge v2; null on any other device, and on an app on v1. */
export function usePoolView(): NativePoolSnapshot | null {
  const pool = useNativePool();
  return pool.active ? pool : null;
}

/** The 2F2 review gate (M-4): this device's own printer is one the setup prints through this device (ownPrinterInSetup):
 *  the printer panel then offers no Remove for it. `known`: the printers read has answered (or this device has no id),
 *  so the panel offers Remove only once it knows (its review, m-C); a failed read with nothing in hand is not known (the
 *  final Phase 2 gate, m-2: Change printer then keeps this device's printer in the app). The same printers read as the
 *  agent's: no request of its own. */
export function useOwnPrinterInSetup(deviceId: string): { inSetup: boolean; known: boolean } {
  const { printers, answered } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  const pool = usePoolView();
  return useMemo(() => ({ inSetup: ownPrinterInSetup(printers, deviceId, local, pool, pool?.defaultId ?? null), known: deviceId === "" || answered }), [printers, answered, deviceId, local, pool]);
}

// PX-2 (spec §6.9 B6): the page's one held-status memory, so the button and the panel read the same value.
const HELD = (key: string, status: PrinterStatus): PrinterStatus => heldPrinterStatusOf(PAGE_HELD_STATUS, key, status);

/** Session 2D (spec §10): the top-bar dot's view of printers mode. The same printers read as the agent's (one cache
 *  entry): no request of its own. Session 3B: with the network printers the wake says this device took over. PX-2 (spec
 *  §6.5, §6.9 B6): the app's printers held through its own retries before the dot reads them; `here` (every printer it
 *  prints now, held) and `notHere` for the status card; `waiting`, the printer with the most fresh slips waiting that it
 *  does not print (R1: a writer whose own printer has more slips still sees another one stuck), named from this read and
 *  the narrow string the pulse provider derives: no request, no poll, no timer (SR-2). */
export function useDotPrinters(deviceId: string): PrinterDotPrinters {
  const { printers } = usePrintersRead(deviceId !== "");
  const device = useDevicePrinter();
  const local = device.printer;
  const desktop = useDesktopPrinters();
  const appPool = usePoolView();
  const pool = useMemo(() => heldPoolOf(appPool, HELD), [appPool]);
  const takenOver = useSyncExternalStore(onTakenOverChange, takenOverPrinterIds, () => NO_IDS);
  // Session 3E: the Windows app's network printers (1.12.0).
  const lanSnapshot = useDesktopLan();
  const lan = lanSnapshot.active ? lanSnapshot.printers : null;
  const dot = useDotPrintersOf(printers, deviceId, local, desktop, pool, takenOver, lan);
  const waitingKey = usePrintWaitingPrinters();
  const localStatus = device.status;
  return useMemo(() => {
    const agent = agentPrintersOf(printers, deviceId, local, desktop, appPool);
    const here = printersHereOf(printers, agent, appPool, lan, local, localStatus, HELD, takenOver);
    const waiting = waitingPrintersOf(waitingKey, printers).find((entry) => !here.some((mine) => mine.id === entry.printerId));
    return { ...dot, here, notHere: printersNotHereOf(printers, deviceId, agent), ...(waiting !== undefined ? { waiting } : {}) };
  }, [dot, printers, deviceId, local, desktop, appPool, lan, localStatus, takenOver, waitingKey]);
}

// Sessions 2D–3E's dot (dotPrintersOf: writer, all local, the worst held state, a problem), memoized on its own inputs.
function useDotPrintersOf(
  printers: PrinterConfig[],
  deviceId: string,
  local: DevicePrinter | null,
  desktop: DesktopPrinters | null,
  pool: NativePoolView | null,
  takenOver: readonly string[],
  lan: readonly DesktopLanPrinter[] | null,
): PrinterDotPrinters {
  return useMemo(() => dotPrintersOf(printers, deviceId, local, desktop, pool, takenOver, lan), [printers, deviceId, local, desktop, pool, takenOver, lan]);
}

// The network printers this page asked the app to add that the app does not list yet: one ask per printer (one the app
// could not reach stays in its list, down, and its own reconnect loop keeps trying). The 2F2 review gate (M-4): a key
// goes once the app lists that printer, so a setup printer that leaves the app another way (an older page's Change
// printer, an older app) is added back with no reload. The panel offers no Remove for a printer the setup prints through
// this device (ownPrinterInSetup), so no staff action is undone by this (the 2E gate's I-3).
const lanAsked = new Set<string>();
// The 2F2 review gate (m-3): the app's ids of the network printers this page added by itself, kept on the device, so one
// the setup stops naming is removed from the app again (lanPrintersToRemove), even after a reload.
const LAN_ADDED_KEY = "pos.app-lan-added.v1";
const LAN_ADDED_MAX = 32;

function readLanAdded(): string[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(LAN_ADDED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(0, LAN_ADDED_MAX) : [];
  } catch {
    return [];
  }
}

function writeLanAdded(ids: readonly string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(LAN_ADDED_KEY);
    else window.localStorage.setItem(LAN_ADDED_KEY, JSON.stringify(ids.slice(0, LAN_ADDED_MAX)));
  } catch {
    // Storage blocked: the page forgets what it added, so it removes nothing (never a printer staff added).
  }
}

/** The printers this device writes, and which it prints here (lib/print-agent-printers.ts). Session 2F1: a network
 *  printer this device writes is added to the POS app's printers on bridge v2 (a local call, no request). Session 3B:
 *  every network printer it may take over too, ahead of time; a removal waits while a job is being written to it. */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const { loaded } = usePrintersRead(enabled);
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const writing = useSyncExternalStore(onPrintersWritingChange, printersBeingWritten, () => "");
  useEffect(() => {
    if (!enabled || pool === null || deviceId === "") return;
    for (const key of [...lanAsked]) if (pool.printers.some((entry) => entry.id.toLowerCase() === `tcp:${key}`)) lanAsked.delete(key);
    const added = readLanAdded();
    for (const lan of lanPrintersToAdd(printers, deviceId, pool)) {
      const key = `${lan.host}:${lan.port}`;
      if (lanAsked.has(key)) continue;
      lanAsked.add(key);
      if (!added.includes(`tcp:${key}`)) added.push(`tcp:${key}`);
      void nativePool().add({ tcp: lan }).catch(() => undefined);
    }
    // Only against a printers read that has loaded: before it, every printer the page added would look unnamed.
    const busy = writing === "" ? [] : writing.split(",");
    const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added, busy) : { remove: [], record: added };
    for (const id of remove) void nativePool().remove(id).catch(() => undefined);
    if (JSON.stringify(record) !== JSON.stringify(readLanAdded())) writeLanAdded(record);
  }, [enabled, loaded, printers, deviceId, pool, writing]);
  const agent = useMemo(() => agentPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
  // Phase 3 Session 3E (spec §9.6): on the Windows app 1.12.0 the network printers it prints (its own and the ones it may
  // take over) are checked by the app at once and every DESKTOP_LAN_CHECK_MS (a connect and DLE EOT from the app: no
  // request), so a printer is named in a lease only while the app reaches it; and every DESKTOP_LAN_CHECK_MS the app's
  // Windows printers are read again (presence: one Windows no longer reports reads down in the beat).
  const desktopLanOn = enabled && desktop?.lan === true;
  const lanTargets = JSON.stringify(Object.values(agent.targets).flatMap((target) => (target.lan === undefined ? [] : [target.lan])));
  useEffect(() => {
    if (!desktopLanOn) return;
    desktopLan().watch(JSON.parse(lanTargets) as DesktopLanTarget[]);
  }, [desktopLanOn, lanTargets]);
  useEffect(() => {
    if (!desktopLanOn) return;
    const timer = window.setInterval(() => {
      void desktopLan().check();
      void refreshDesktopPrinterChosen();
    }, DESKTOP_LAN_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [desktopLanOn]);
  return agent;
}
