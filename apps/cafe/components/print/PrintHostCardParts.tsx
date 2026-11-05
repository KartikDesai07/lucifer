"use client";

// The printer panel's prop-driven pieces (no state, no hooks, no print
// machinery): the inline yes/no and the row for the printer saved on this
// device. Generic product voice; the buttons are the panel's 36px.
import {
  PRINTER_BUTTON_CLASS,
  PRINTER_HERE_DOT_CLASS,
  PRINTER_HERE_NAME_CLASS,
  PRINTER_HERE_SUB_CLASS,
  PRINTER_HERE_TONE,
  PRINTER_HERE_WORD_CLASS,
  PRINTER_ROW_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import { printerSubOf } from "@/lib/printer/settings-view";
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
// member is looking at right now. The sentence wraps; the buttons are the panel's 36px.
export function InlineConfirm({ question, yes, no, disabled, onYes, onNo }: InlineConfirmProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 basis-full text-[13.5px] sm:basis-auto">{question}</span>
      <Button className={PRINTER_BUTTON_CLASS} onClick={onYes} disabled={disabled}>{yes}</Button>
      <Button className={PRINTER_BUTTON_CLASS} variant="outline" onClick={onNo} disabled={disabled}>{no}</Button>
    </div>
  );
}

export interface PrinterRowProps {
  printer: DevicePrinter;
  status: PrinterStatus;
}

// Every status in words (the colour is never the only signal). "elsewhere": another tab of this
// browser holds the printer — the section says so, and the chip must not contradict it.
const STATUS_LABEL: Record<PrinterStatus, string> = {
  none: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Not connected",
  "needs-tap": "Tap Reconnect",
  elsewhere: "In another tab",
};

// This device's printer's row (PX-3 Task 10, spec §6.6 item 1; mockup t-settings): the 9px dot (ok green while connected,
// else --subtle), the name (wraps) over "Bluetooth · 80 mm paper", and the state word on the right (the colour is never
// the only signal).
export function PrinterRow({ printer, status }: PrinterRowProps) {
  const tone = status === "connected" ? PRINTER_HERE_TONE.ok : PRINTER_HERE_TONE.quiet;
  return (
    <div className={PRINTER_ROW_CLASS}>
      <span aria-hidden="true" className={cn(PRINTER_HERE_DOT_CLASS, tone.dot)} />
      <p className={PRINTER_HERE_NAME_CLASS}>
        {printer.name}
        <span className={PRINTER_HERE_SUB_CLASS}>{printerSubOf(printer)}</span>
      </p>
      <span className={cn(PRINTER_HERE_WORD_CLASS, tone.word)}>{STATUS_LABEL[status]}</span>
    </div>
  );
}
