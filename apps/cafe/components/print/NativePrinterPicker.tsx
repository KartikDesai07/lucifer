"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PRINTER_BLOCK_CLASS, PRINTER_BUTTON_CLASS, PRINTER_BUTTON_PRIMARY_CLASS, PRINTER_BUTTON_SMALL_CLASS, PRINTER_ERROR_CLASS, PRINTER_FIELD_CLASS, PRINTER_LABEL_CLASS, PRINTER_LIST_ROW_CLASS, PRINTER_NOTE_CLASS, PRINTER_NOTICE_CLASS, PRINTER_ROW_NAME_CLASS, PRINTER_SECTION_TILE_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FindNetworkPrinters } from "@/components/print/FindNetworkPrinters";
import { NATIVE_TYPE_ICONS, NATIVE_TYPE_LABELS } from "@/components/print/printer-type";
import type { PaperWidth } from "@/lib/constants";
import { devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";
import { NATIVE_READY_EVENT, nativeClient, nativeRequest } from "@/lib/printer/native-bridge";
import {
  DEFAULT_TCP_PRINTER_PORT,
  PRINTER_SCAN_MS,
  type NativeBluetoothState,
  type NativePrinter,
} from "@/lib/printer/native-bridge-protocol";
import { canScanBluetooth, createStatusOrder, loadPicker } from "@/lib/printer/native-picker-state";
import { ADDRESS_MESSAGE, isValidPrinterHost, splitHostPort } from "@/lib/printer/network-address";
import { NATIVE_BLUETOOTH_BLOCKED_MESSAGE, nativeErrorMessage, type NativeSelectTarget } from "@/lib/printer/transport-native";

const MS_PER_SECOND = 1_000;
const TCP_PORT_MAX = 65_535;
const PORT_MESSAGE = "The port is a number from 1 to 65535. Most printers use 9100.";
const BLUETOOTH_UNSUPPORTED_MESSAGE = "This device has no Bluetooth. You can still use a USB or network printer.";
const BLUETOOTH_OFF_LINE = "Bluetooth is off on this device.";
const BLUETOOTH_BLOCKED_LINE = "The POS app needs permission to use Bluetooth.";
const NETWORK_TITLE = "Network printer (Wi-Fi or Ethernet)";
const NONE_FOUND_MESSAGE = "No printers found yet. For USB, connect a powered printer with a USB OTG adapter and tap Refresh USB / paired printers. For Bluetooth, turn it on and tap Find printers.";

interface NativePrinterPickerProps {
  paper: PaperWidth;
  /** The section's one busy flag (a connect is running). */
  busy: boolean;
  /** Runs a connect attempt under the section's busy flag and toasts the outcome. */
  onAttempt: (attempt: Promise<ConnectOutcome>) => Promise<void>;
  /** Phase 2 Session 2F1: adds the printer to the app's printers (bridge v2) instead of replacing this device's own. The 2F2
   *  review gate (M-4): also Change printer of a printer the setup prints here (added, then made this device's printer). */
  add?: (target: NativeSelectTarget) => Promise<ConnectOutcome>;
}

// USB and paired devices are always available; Bluetooth scanning is separate.
export function NativePrinterPicker({ paper, busy, onAttempt, add }: NativePrinterPickerProps) {
  const [printers, setPrinters] = useState<NativePrinter[] | null>(null);
  const [bluetooth, setBluetooth] = useState<NativeBluetoothState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(DEFAULT_TCP_PRINTER_PORT));
  const [formError, setFormError] = useState<string | null>(null);
  const locked = busy || scanning || working || refreshing;
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

  const findPrinters = async () => {
    if (locked) return;
    setScanning(true);
    try {
      setPrinters(await devicePrinter().listNative(true));
    } catch (error) {
      toast.error(nativeErrorMessage(error));
    } finally {
      setScanning(false);
    }
  };

  const refreshPrinters = async () => {
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

  const connectNetworkPrinter = () => {
    if (locked) return;
    // A pasted "host:port" fills both fields, so it works even typed by hand.
    const pasted = splitHostPort(address);
    const host = (pasted?.host ?? address).trim().toLowerCase();
    const portText = pasted?.port ?? port;
    if (pasted !== null) {
      setAddress(pasted.host);
      setPort(pasted.port);
    }
    if (!isValidPrinterHost(host)) return setFormError(ADDRESS_MESSAGE);
    const portNumber = Number(portText);
    if (!/^\d+$/.test(portText) || portNumber < 1 || portNumber > TCP_PORT_MAX) return setFormError(PORT_MESSAGE);
    setFormError(null);
    void onAttempt(add !== undefined ? add({ tcp: { host, port: portNumber } }) : devicePrinter().selectNative({ tcp: { host, port: portNumber } }, paper));
  };

  return (
    <div className="flex flex-col gap-3">
      {bluetooth === "off" && (
        <div role="status" className={PRINTER_NOTICE_CLASS}>
          <p>{BLUETOOTH_OFF_LINE}</p>
          <Button className={PRINTER_BUTTON_CLASS} onClick={() => void turnOnBluetooth()} disabled={locked}>
            Turn on Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unauthorized" && (
        <div role="status" className={PRINTER_NOTICE_CLASS}>
          <p>{BLUETOOTH_BLOCKED_LINE}</p>
          <Button className={PRINTER_BUTTON_CLASS} onClick={() => void allowBluetooth()} disabled={locked}>
            Allow Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unsupported" && <p role="status" className={PRINTER_NOTICE_CLASS}>{BLUETOOTH_UNSUPPORTED_MESSAGE}</p>}

      <div className="flex flex-col gap-2">
        <p className={PRINTER_LABEL_CLASS}>Printers this device can see</p>
        <p className={PRINTER_NOTE_CLASS}>USB connects directly to this phone or tablet using OTG. A printer cabled to a PC must be selected in the POS desktop app on that PC.</p>
        {printers === null ? (
          <p role="status" className="text-muted-foreground">Reading the printer list…</p>
        ) : printers.length === 0 ? (
          <p className="text-muted-foreground">{NONE_FOUND_MESSAGE}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {printers.map((printer) => {
              const Icon = NATIVE_TYPE_ICONS[printer.transport];
              return (
                <li key={printer.id} className={PRINTER_LIST_ROW_CLASS}>
                  <span aria-hidden="true" className={PRINTER_SECTION_TILE_CLASS}>
                    <Icon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={PRINTER_ROW_NAME_CLASS}>{printer.name}</p>
                    <p className={PRINTER_NOTE_CLASS}>{NATIVE_TYPE_LABELS[printer.transport]}</p>
                  </div>
                  {/* Beside the name, not under it: a list row, compact on a phone too. */}
                  <Button
                    className={cn(PRINTER_BUTTON_SMALL_CLASS, "shrink-0")}
                    variant="outline"
                    aria-label={`Use this printer: ${printer.name}`}
                    onClick={() => void onAttempt(add !== undefined ? add({ id: printer.id }) : devicePrinter().selectNative({ id: printer.id }, paper))}
                    disabled={locked}
                  >
                    Use
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Button className={PRINTER_BUTTON_CLASS} variant="outline" onClick={() => void refreshPrinters()} disabled={locked}>
          {refreshing ? "Refreshing printers…" : "Refresh USB / paired printers"}
        </Button>
        {bluetooth !== "unsupported" && <Button className={printers?.length === 0 ? PRINTER_BUTTON_PRIMARY_CLASS : PRINTER_BUTTON_CLASS} variant={printers?.length === 0 ? "default" : "outline"} onClick={() => void findPrinters()} disabled={locked || !canScanBluetooth(bluetooth)}>
          {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {scanning ? `Looking for printers (about ${PRINTER_SCAN_MS / MS_PER_SECOND} seconds)…` : "Find printers"}
        </Button>}
      </div>
      <form
        method="post"
        className={PRINTER_BLOCK_CLASS}
        onSubmit={(e) => {
          e.preventDefault();
          connectNetworkPrinter();
        }}
      >
        <p className={PRINTER_LABEL_CLASS}>{NETWORK_TITLE}</p>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
            <span className={PRINTER_LABEL_CLASS}>Printer address</span>
            <Input
              value={address}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="192.168.1.50"
              disabled={locked}
              aria-invalid={formError !== null}
              onChange={(e) => { setAddress(e.target.value); setFormError(null); }}
              onPaste={(e) => {
                const pasted = splitHostPort(e.clipboardData.getData("text"));
                if (pasted === null) return;
                e.preventDefault();
                setAddress(pasted.host);
                setPort(pasted.port);
              }}
              className={PRINTER_FIELD_CLASS}
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className={PRINTER_LABEL_CLASS}>Port</span>
            <Input value={port} inputMode="numeric" autoComplete="off" disabled={locked} onChange={(e) => { setPort(e.target.value); setFormError(null); }} className={PRINTER_FIELD_CLASS} />
          </label>
        </div>
        {formError !== null && <p role="alert" className={PRINTER_ERROR_CLASS}>{formError}</p>}
        <FindNetworkPrinters disabled={locked} onPick={(host, picked) => { setAddress(host); setPort(String(picked)); setFormError(null); }} />
        <Button type="submit" className={PRINTER_BUTTON_PRIMARY_CLASS} disabled={locked}>
          Use this network printer
        </Button>
      </form>
    </div>
  );
}
