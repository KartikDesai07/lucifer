"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { devicePrinter } from "@/lib/printer/device-printer";
import { NATIVE_READY_EVENT, nativeClient, nativeRequest } from "@/lib/printer/native-bridge";
import type { NativeBluetoothState, NativePrinter } from "@/lib/printer/native-bridge-protocol";
import { createStatusOrder, loadPicker } from "@/lib/printer/native-picker-state";
import { ADDRESS_MESSAGE, isValidPrinterHost, splitHostPort } from "@/lib/printer/network-address";
import { NATIVE_BLUETOOTH_BLOCKED_MESSAGE, nativeErrorMessage } from "@/lib/printer/transport-native";

// The POS app's printer list (PX-3 Task 11, spec §6.7): the inline NativePrinterPicker's logic, moved as it was for the
// guided connect's found list. USB and paired printers load on mount (and again when a late bridge announces itself);
// Bluetooth's state follows the app's pushed status; the scan, Refresh, Turn on Bluetooth and Allow Bluetooth. Every read
// is the app's own (no server). The pure rules live in lib/printer/native-picker-state.ts.

const TCP_PORT_MAX = 65_535;
const PORT_MESSAGE = "The port is a number from 1 to 65535. Most printers use 9100.";

export interface NativePrinterList {
  /** null until the first list answers. */
  printers: NativePrinter[] | null;
  bluetooth: NativeBluetoothState | null;
  scanning: boolean;
  refreshing: boolean;
  /** Turn on Bluetooth or Allow Bluetooth is running. */
  working: boolean;
  /** The app's Bluetooth scan (about 8 s). Resolves to its error, null when it listed, or undefined when it did nothing (a
   *  scan, Refresh, Turn on or Allow Bluetooth holds the list), so a tap then never clears that job's outcome (the final
   *  review's I2). Never toasts: the list says it. */
  scan(): Promise<unknown>;
  refresh(): Promise<void>;
  turnOnBluetooth(): Promise<void>;
  allowBluetooth(): Promise<void>;
}

export function useNativePrinterList(): NativePrinterList {
  const [printers, setPrinters] = useState<NativePrinter[] | null>(null);
  const [bluetooth, setBluetooth] = useState<NativeBluetoothState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const locked = scanning || working || refreshing;
  const statusOrder = useRef(createStatusOrder()).current;
  const mounted = useRef(true);

  // One loader for mount and Refresh. Status and list settle independently: a USB printer still
  // lists when the Bluetooth status cannot be read, and a reply older than a pushed status event
  // never overwrites it.
  const load = useCallback(async () => {
    const startedAt = statusOrder.start();
    const result = await loadPicker(() => nativeRequest("printer.status"), () => devicePrinter().listNative(false));
    if (!mounted.current) return;
    if (result.bluetooth !== null && statusOrder.fresh(startedAt)) setBluetooth(result.bluetooth);
    if (result.printers !== null) {
      setPrinters(result.printers);
      return;
    }
    setPrinters((current) => current ?? []);
    const error = result.listError;
    toast.error(nativeErrorMessage(error));
  }, [statusOrder]);

  useEffect(() => {
    mounted.current = true;
    let off: (() => void) | undefined;
    const subscribe = (): void => {
      if (off !== undefined) return;
      off = nativeClient()?.on("printer.status", (status) => {
        if (!mounted.current) return;
        statusOrder.event();
        setBluetooth(status.bluetooth);
      });
    };
    // The bridge can announce itself after this panel mounted (a slow app start): subscribe and load then.
    const onReady = (): void => {
      subscribe();
      void load();
    };
    subscribe();
    window.addEventListener(NATIVE_READY_EVENT, onReady);
    void load();
    return () => {
      mounted.current = false;
      window.removeEventListener(NATIVE_READY_EVENT, onReady);
      off?.();
    };
  }, [load, statusOrder]);

  const scan = async (): Promise<unknown> => {
    if (locked) return undefined;
    setScanning(true);
    try {
      setPrinters(await devicePrinter().listNative(true));
      return null;
    } catch (error) {
      return error;
    } finally {
      setScanning(false);
    }
  };

  const refresh = async () => {
    if (locked) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  const turnOnBluetooth = async () => {
    setWorking(true);
    try {
      const { on } = await nativeRequest("bluetooth.enable");
      setBluetooth(on ? "on" : "off");
      if (on) setPrinters(await devicePrinter().listNative(false));
    } catch (error) {
      toast.error(nativeErrorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  const allowBluetooth = async () => {
    setWorking(true);
    try {
      const { granted } = await nativeRequest("permissions.request", { kind: "bluetooth" });
      if (!granted) toast.error(NATIVE_BLUETOOTH_BLOCKED_MESSAGE);
      else setBluetooth((await nativeRequest("printer.status")).bluetooth);
    } catch (error) {
      toast.error(nativeErrorMessage(error));
    } finally {
      setWorking(false);
    }
  };

  return { printers, bluetooth, scanning, refreshing, working, scan, refresh, turnOnBluetooth, allowBluetooth };
}

export interface NetworkCheck {
  /** The fields as they read after the check (a pasted "host:port" fills both). */
  address: string;
  port: string;
  /** The printer to connect, or null with the form's error. */
  target: { tcp: { host: string; port: number } } | null;
  error: string | null;
}

/** The network form's checks, as the picker made them: a pasted "host:port" fills both fields, so it works even typed by
 *  hand; the address is checked as the app checks it; the port is a number from 1 to 65535. */
export function networkTargetOf(address: string, port: string): NetworkCheck {
  const pasted = splitHostPort(address);
  const host = (pasted?.host ?? address).trim().toLowerCase();
  const portText = pasted?.port ?? port;
  const fields = pasted !== null ? { address: pasted.host, port: pasted.port } : { address, port };
  if (!isValidPrinterHost(host)) return { ...fields, target: null, error: ADDRESS_MESSAGE };
  const portNumber = Number(portText);
  if (!/^\d+$/.test(portText) || portNumber < 1 || portNumber > TCP_PORT_MAX) return { ...fields, target: null, error: PORT_MESSAGE };
  return { ...fields, target: { tcp: { host, port: portNumber } }, error: null };
}
