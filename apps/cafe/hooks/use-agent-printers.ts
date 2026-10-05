"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDesktopPrinterSnapshot, useDevicePrinter, useNativePool, usePrintLane } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { agentPrintersOf, dotPrintersOf, lanPrintersToAdd, lanPrintersToRemove, ownPrinterInSetup, type AgentPrinters, type DesktopPrinters } from "@/lib/print-agent-printers";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { nativePool, type NativePoolSnapshot } from "@/lib/printer/native-pool";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
import { subscribeRealtime } from "@/lib/realtime-client";

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 30 min (the fallback when a frame was missed; print-budget.test.ts). Never
// a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];

/** Session 2D: the printers read for a screen that only shows them (the dot, the bill printer, the setup page): the
 *  same cache entry as the agent's, without a print-setup subscription of its own, so an admin save costs one read
 *  per device, never one per screen (the 2D gate's review, M-5). `loaded` is false until the first answer. */
export function usePrintersRead(enabled: boolean): { printers: PrinterConfig[]; loaded: boolean; failed: boolean } {
  const query = useQuery({
    queryKey: PRINTERS_KEYS.all,
    queryFn: () => apiGet<PrinterConfig[]>("/api/printers"),
    enabled,
    staleTime: PRINTERS_STALE_MS,
    refetchOnWindowFocus: true,
  });
  return { printers: query.data ?? NO_PRINTERS, loaded: query.isSuccess, failed: query.isError };
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
  return useMemo(() => (lane === "desktop" ? { selected: snapshot.selected, names: snapshot.names, named: desktopPrintsOnNamed() } : null), [lane, snapshot]);
}

/** Session 2F1 (spec §9.2): the POS app's printers on bridge v2; null on any other device, and on an app on v1. */
export function usePoolView(): NativePoolSnapshot | null {
  const pool = useNativePool();
  return pool.active ? pool : null;
}

/** The 2F2 review gate (M-4): this device's own printer is one the setup prints through this device (ownPrinterInSetup):
 *  the printer panel then offers no Remove for it. `known`: the printers read has answered (or failed, or this device
 *  has no id), so the panel offers Remove only once it knows (its review, m-C). The same printers read as the agent's:
 *  no request of its own. */
export function useOwnPrinterInSetup(deviceId: string): { inSetup: boolean; known: boolean } {
  const { printers, loaded, failed } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  const pool = usePoolView();
  return useMemo(() => ({ inSetup: ownPrinterInSetup(printers, deviceId, local, pool, pool?.defaultId ?? null), known: deviceId === "" || loaded || failed }), [printers, loaded, failed, deviceId, local, pool]);
}

/** Session 2D (spec §10): the top-bar dot's view of printers mode. The same printers read as the agent's (one cache
 *  entry): no request of its own. */
export function useDotPrinters(deviceId: string): PrinterDotPrinters {
  const { printers } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  return useMemo(() => dotPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
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
 *  printer this device writes is added to the POS app's printers on bridge v2 (a local call, no request). */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const { loaded } = usePrintersRead(enabled);
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
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
    const { remove, record } = loaded ? lanPrintersToRemove(printers, deviceId, pool, pool.defaultId, added) : { remove: [], record: added };
    for (const id of remove) void nativePool().remove(id).catch(() => undefined);
    if (JSON.stringify(record) !== JSON.stringify(readLanAdded())) writeLanAdded(record);
  }, [enabled, loaded, printers, deviceId, pool]);
  return useMemo(() => agentPrintersOf(printers, deviceId, local, desktop, pool), [printers, deviceId, local, desktop, pool]);
}
