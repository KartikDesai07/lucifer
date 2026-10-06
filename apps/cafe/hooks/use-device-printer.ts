"use client";

import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { onWindowEvent } from "@/lib/printer/capabilities";
import {
  SERVER_DESKTOP_CHOSEN,
  SERVER_DESKTOP_SNAPSHOT,
  desktopChosen,
  desktopPrinterSnapshot,
  subscribeDesktopPrinterChosen,
  type DesktopChosen,
  type DesktopPrinterSnapshot,
} from "@/lib/printer/desktop-printer-state";
import { NONE_SNAPSHOT, devicePrinter, type PrinterSnapshot } from "@/lib/printer/device-printer";
import { NATIVE_READY_EVENT } from "@/lib/printer/native-bridge";
import { EMPTY_POOL, nativePool, type NativePoolSnapshot } from "@/lib/printer/native-pool";
import { canPrintNow, canPrintOnAny, currentLane, printCapabilities, type PrintCapabilities, type PrintLane } from "@/lib/printer/print-lane";

// Reactive views of the device printer and the print lane. Every hook is a
// useSyncExternalStore with an explicit SERVER snapshot, so the server render
// and the first client render agree (hydration-safe) and the real value lands
// on the next commit.
const SERVER_LANE: PrintLane = "pending";
const NO_CAPABILITIES: PrintCapabilities = { serial: false, bluetooth: false, native: false };

function subscribePrinter(onChange: () => void): () => void {
  return devicePrinter().subscribe(onChange);
}

// The lane also changes when a late-arriving app bridge announces itself, and
// whether the desktop shell has a printer chosen decides canPrintNow().
function subscribeLane(onChange: () => void): () => void {
  const offPrinter = devicePrinter().subscribe(onChange);
  const offBridge = onWindowEvent(NATIVE_READY_EVENT, onChange);
  const offDesktop = subscribeDesktopPrinterChosen(onChange);
  return () => {
    offPrinter();
    offBridge();
    offDesktop();
  };
}

function subscribeBridge(onChange: () => void): () => void {
  return onWindowEvent(NATIVE_READY_EVENT, onChange);
}

function subscribeOnline(onChange: () => void): () => void {
  return onlineManager.subscribe(onChange);
}

export function useDevicePrinter(): PrinterSnapshot {
  return useSyncExternalStore(subscribePrinter, () => devicePrinter().getSnapshot(), () => NONE_SNAPSHOT);
}

export function usePrintLane(): PrintLane {
  return useSyncExternalStore(subscribeLane, currentLane, () => SERVER_LANE);
}

export function useDesktopPrinterChosen(): DesktopChosen {
  return useSyncExternalStore(subscribeDesktopPrinterChosen, desktopChosen, () => SERVER_DESKTOP_CHOSEN);
}

/** Phase 2 Session 2E: the Windows app's chosen printer and every printer Windows reports on this PC. */
export function useDesktopPrinterSnapshot(): DesktopPrinterSnapshot {
  return useSyncExternalStore(subscribeDesktopPrinterChosen, desktopPrinterSnapshot, () => SERVER_DESKTOP_SNAPSHOT);
}

export function useCanPrintNow(): boolean {
  return useSyncExternalStore(subscribeLane, canPrintNow, () => false);
}

function subscribePool(onChange: () => void): () => void {
  return nativePool().subscribe(onChange);
}

/** Phase 2 Session 2F1 (spec §9.2): the POS app's printers on bridge v2 (inactive everywhere else). */
export function useNativePool(): NativePoolSnapshot {
  return useSyncExternalStore(subscribePool, () => nativePool().getSnapshot(), () => EMPTY_POOL);
}

function subscribeAny(onChange: () => void): () => void {
  const offLane = subscribeLane(onChange);
  const offPool = subscribePool(onChange);
  return () => {
    offLane();
    offPool();
  };
}

/** Session 2F1: a printer here can print right now (this device's own, or another of the app's printers). */
export function useCanPrintOnAny(): boolean {
  return useSyncExternalStore(subscribeAny, canPrintOnAny, () => false);
}

export function useDeviceOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true);
}

// Re-read on every snapshot, but the previous object is kept while nothing
// changed — useSyncExternalStore needs a stable reference between reads.
let cachedCapabilities: PrintCapabilities = NO_CAPABILITIES;
function readCapabilities(): PrintCapabilities {
  const next = printCapabilities();
  const same =
    next.serial === cachedCapabilities.serial &&
    next.bluetooth === cachedCapabilities.bluetooth &&
    next.native === cachedCapabilities.native;
  if (!same) cachedCapabilities = next;
  return cachedCapabilities;
}

export function usePrintCapabilities(): PrintCapabilities {
  return useSyncExternalStore(subscribeBridge, readCapabilities, () => NO_CAPABILITIES);
}
