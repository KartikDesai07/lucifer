"use client";

// The printer panel's prop-driven pieces (no state, no hooks, no print
// machinery): the inline yes/no and the one-line summary of the printer saved
// on this device. Generic product voice; every control is 44px (PR1).
import { Badge } from "@/components/ui/badge";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

export interface InlineConfirmProps {
  question: string;
  yes: string;
  no: string;
  disabled: boolean;
  onYes: () => void;
  onNo: () => void;
}

// A small inline yes/no, not a modal: the question is about paper the staff
// member is looking at right now. The sentence wraps; the buttons are 44px.
export function InlineConfirm({ question, yes, no, disabled, onYes, onNo }: InlineConfirmProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 basis-full sm:basis-auto">{question}</span>
      <Button className={PRINTER_ACTION_CLASS} onClick={onYes} disabled={disabled}>{yes}</Button>
      <Button className={PRINTER_ACTION_CLASS} variant="outline" onClick={onNo} disabled={disabled}>{no}</Button>
    </div>
  );
}

export const NATIVE_TYPE_LABELS = { "bt-classic": "Bluetooth", ble: "Bluetooth LE", tcp: "Network", usb: "USB" } as const;

// How the printer connects, in words: Bluetooth / Bluetooth LE / Network / USB / PC printer.
export function printerTypeLabel(printer: DevicePrinter): string {
  if (printer.kind === "ble") return "Bluetooth LE";
  if (printer.kind === "native") return NATIVE_TYPE_LABELS[printer.transport];
  if (printer.bluetoothServiceClassId !== undefined) return "Bluetooth";
  return printer.usbVendorId !== undefined ? "USB" : "PC printer";
}

export interface PrinterRowProps {
  printer: DevicePrinter;
  status: PrinterStatus;
}

// name · type badge · paper badge · plain-words status (the colour is never the only signal).
export function PrinterRow({ printer, status }: PrinterRowProps) {
  const connected = status === "connected";
  const statusLabel = connected ? "Connected" : status === "connecting" ? "Connecting…" : "Not connected";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 break-words font-medium text-brand-ink">{printer.name}</span>
      <Badge variant="outline">{printerTypeLabel(printer)}</Badge>
      <Badge variant="outline">{printer.paper === "58mm" ? "58 mm" : "80 mm"}</Badge>
      <Badge variant={connected ? "default" : "secondary"}>{statusLabel}</Badge>
    </div>
  );
}
