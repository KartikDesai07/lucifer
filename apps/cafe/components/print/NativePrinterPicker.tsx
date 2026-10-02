"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  PRINTER_ACTION_CLASS,
  PRINTER_INPUT_CLASS,
  PRINTER_TILE_BRAND_CLASS,
  PRINTER_TILE_CLASS,
} from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NATIVE_TYPE_ICONS, NATIVE_TYPE_LABELS } from "@/components/print/printer-type";
import type { PaperWidth } from "@/lib/constants";
import { devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativeClient, nativeRequest } from "@/lib/printer/native-bridge";
import {
  DEFAULT_TCP_PRINTER_PORT,
  PRINTER_SCAN_MS,
  type NativeBluetoothState,
  type NativePrinter,
} from "@/lib/printer/native-bridge-protocol";
import { ADDRESS_MESSAGE, isValidPrinterHost, splitHostPort } from "@/lib/printer/network-address";
import { NATIVE_BLUETOOTH_BLOCKED_MESSAGE, nativeErrorMessage } from "@/lib/printer/transport-native";

const ROW_BUTTON_CLASS = cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto");
const MS_PER_SECOND = 1_000;
const TCP_PORT_MAX = 65_535;
const PORT_MESSAGE = "The port is a number from 1 to 65535. Most printers use 9100.";
const BLUETOOTH_UNSUPPORTED_MESSAGE = "This device has no Bluetooth. You can still use a USB or network printer.";
const BLUETOOTH_OFF_LINE = "Bluetooth is off on this device.";
const BLUETOOTH_BLOCKED_LINE = "The POS app needs permission to use Bluetooth.";
const NOTICE_CLASS = "space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900";
const BLOCK_CLASS = "space-y-2 rounded-md border border-brand-rule p-3";
const NETWORK_TITLE = "Network printer (Wi-Fi or Ethernet)";
const NONE_FOUND_MESSAGE = "No printers found yet. For USB, connect a powered printer with a USB OTG adapter and tap Refresh USB / paired printers. For Bluetooth, turn it on and tap Find printers.";

interface NativePrinterPickerProps {
  paper: PaperWidth;
  /** The section's one busy flag (a connect is running). */
  busy: boolean;
  /** Runs a connect attempt under the section's busy flag and toasts the outcome. */
  onAttempt: (attempt: Promise<ConnectOutcome>) => Promise<void>;
}

// USB and paired devices are always available; Bluetooth scanning is separate.
export function NativePrinterPicker({ paper, busy, onAttempt }: NativePrinterPickerProps) {
  const [printers, setPrinters] = useState<NativePrinter[] | null>(null);
  const [bluetooth, setBluetooth] = useState<NativeBluetoothState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState(false);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(DEFAULT_TCP_PRINTER_PORT));
  const [formError, setFormError] = useState<string | null>(null);
  const locked = busy || scanning || working;

  useEffect(() => {
    let live = true;
    const off = nativeClient()?.on("printer.status", (status) => {
      if (live) setBluetooth(status.bluetooth);
    });
    Promise.allSettled([nativeRequest("printer.status"), devicePrinter().listNative(false)])
      .then(([status, list]) => {
        if (!live) return;
        if (status.status === "fulfilled") setBluetooth(status.value.bluetooth);
        if (list.status === "fulfilled") setPrinters(list.value);
        else {
          setPrinters([]);
          toast.error(nativeErrorMessage(list.reason));
        }
      });
    return () => {
      live = false;
      off?.();
    };
  }, []);

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
    setWorking(true);
    try {
      const [status, list] = await Promise.all([
        nativeRequest("printer.status"), devicePrinter().listNative(false),
      ]);
      setBluetooth(status.bluetooth);
      setPrinters(list);
    } catch (error) {
      toast.error(nativeErrorMessage(error));
    } finally {
      setWorking(false);
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
    void onAttempt(devicePrinter().selectNative({ tcp: { host, port: portNumber } }, paper));
  };

  return (
    <div className="space-y-4">
      {bluetooth === "off" && (
        <div role="status" className={NOTICE_CLASS}>
          <p>{BLUETOOTH_OFF_LINE}</p>
          <Button className={PRINTER_ACTION_CLASS} onClick={() => void turnOnBluetooth()} disabled={locked}>
            Turn on Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unauthorized" && (
        <div role="status" className={NOTICE_CLASS}>
          <p>{BLUETOOTH_BLOCKED_LINE}</p>
          <Button className={PRINTER_ACTION_CLASS} onClick={() => void allowBluetooth()} disabled={locked}>
            Allow Bluetooth
          </Button>
        </div>
      )}
      {bluetooth === "unsupported" && <p role="status" className={NOTICE_CLASS}>{BLUETOOTH_UNSUPPORTED_MESSAGE}</p>}

        <div className="space-y-2">
          <p className="font-medium text-brand-ink">Printers this device can see</p>
          <p className="text-sm text-brand-muted">USB connects directly to this phone or tablet using OTG. A printer cabled to a PC must be selected in the POS desktop app on that PC.</p>
          {printers === null ? (
            <p role="status" className="text-brand-muted">Reading the printer list…</p>
          ) : printers.length === 0 ? (
            <p className="text-brand-muted">{NONE_FOUND_MESSAGE}</p>
          ) : (
            <ul className="space-y-2">
              {printers.map((printer) => {
                const Icon = NATIVE_TYPE_ICONS[printer.transport];
                return (
                  <li key={printer.id} className="flex items-center gap-3 rounded-md border border-brand-rule p-3">
                    <span aria-hidden="true" className={cn(PRINTER_TILE_CLASS, PRINTER_TILE_BRAND_CLASS)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium text-brand-ink">{printer.name}</p>
                      <p className="text-sm text-brand-muted">{NATIVE_TYPE_LABELS[printer.transport]}</p>
                    </div>
                    {/* Beside the name, not under it: a list row, compact on a phone too. */}
                    <Button
                      className={cn(PRINTER_ACTION_CLASS, "shrink-0")}
                      variant="outline"
                      aria-label={`Use this printer: ${printer.name}`}
                      onClick={() => void onAttempt(devicePrinter().selectNative({ id: printer.id }, paper))}
                      disabled={locked}
                    >
                      Use
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button className={ROW_BUTTON_CLASS} variant="outline" onClick={() => void refreshPrinters()} disabled={locked}>
            {working ? "Refreshing printers…" : "Refresh USB / paired printers"}
          </Button>
          {bluetooth !== "unsupported" && <Button className={ROW_BUTTON_CLASS} variant={printers?.length === 0 ? "default" : "outline"} onClick={() => void findPrinters()} disabled={locked || bluetooth !== "on"}>
            {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {scanning ? `Looking for printers (about ${PRINTER_SCAN_MS / MS_PER_SECOND} seconds)…` : "Find printers"}
          </Button>}
        </div>
      <form
        method="post"
        className={BLOCK_CLASS}
        onSubmit={(e) => {
          e.preventDefault();
          connectNetworkPrinter();
        }}
      >
        <p className="font-medium text-brand-ink">{NETWORK_TITLE}</p>
        <div className="flex flex-wrap gap-2">
          <label className="min-w-0 flex-1 basis-48 space-y-1">
            <span className="text-[13px] font-medium text-brand-ink">Printer address</span>
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
              className={PRINTER_INPUT_CLASS}
            />
          </label>
          <label className="w-28 space-y-1">
            <span className="text-[13px] font-medium text-brand-ink">Port</span>
            <Input value={port} inputMode="numeric" autoComplete="off" disabled={locked} onChange={(e) => { setPort(e.target.value); setFormError(null); }} className={PRINTER_INPUT_CLASS} />
          </label>
        </div>
        {formError !== null && <p role="alert" className="text-xs text-brand-danger">{formError}</p>}
        <Button type="submit" className={ROW_BUTTON_CLASS} variant="outline" disabled={locked}>
          Use this network printer
        </Button>
      </form>
    </div>
  );
}
