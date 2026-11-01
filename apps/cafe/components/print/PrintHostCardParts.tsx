"use client";

// The printer panel's prop-driven pieces (no state, no hooks, no print
// machinery): the inline yes/no and the row for the printer saved on this
// device. Generic product voice; every control is 44px (PR1).
import { Badge } from "@/components/ui/badge";
import { printerTypeIcon, printerTypeLabel } from "@/components/print/printer-type";
import {
  PRINTER_BUTTON_CLASS,
  PRINTER_ROW_CLASS,
  PRINTER_ROW_DOT_CLASS,
  PRINTER_ROW_DOT_OFF_CLASS,
  PRINTER_ROW_DOT_ON_CLASS,
  PRINTER_ROW_META_CLASS,
  PRINTER_ROW_NAME_CLASS,
  PRINTER_ROW_OFF_CLASS,
  PRINTER_ROW_ON_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const CHIP_CLASS = "border-0 bg-transparent px-0 text-[12px]";
const CONNECTED_CHIP_CLASS = "font-semibold text-status-ok-ink";
const IDLE_CHIP_CLASS = "font-medium text-muted-foreground";

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

// The HTML's printer row (values 19): the dot (green and pulsing while connected), the name (wraps), the transport icon and
// "{type} · {paper}" under it, and a status word (the colour is never the only signal).
export function PrinterRow({ printer, status }: PrinterRowProps) {
  const Icon = printerTypeIcon(printer);
  const connected = status === "connected";
  const statusLabel = STATUS_LABEL[status];
  return (
    <div className={cn(PRINTER_ROW_CLASS, connected ? PRINTER_ROW_ON_CLASS : PRINTER_ROW_OFF_CLASS)}>
      <span aria-hidden="true" className={cn(PRINTER_ROW_DOT_CLASS, connected ? PRINTER_ROW_DOT_ON_CLASS : PRINTER_ROW_DOT_OFF_CLASS)} />
      <div className="min-w-0 flex-1">
        <p className={PRINTER_ROW_NAME_CLASS}>{printer.name}</p>
        <p className={PRINTER_ROW_META_CLASS}>
          <Icon aria-hidden="true" />
          <span>
            {printerTypeLabel(printer)} · {printer.paper === "58mm" ? "58 mm" : "80 mm"}
          </span>
        </p>
      </div>
      <Badge variant={connected ? "outline" : "secondary"} className={cn(CHIP_CLASS, connected ? CONNECTED_CHIP_CLASS : IDLE_CHIP_CLASS)}>
        {statusLabel}
      </Badge>
    </div>
  );
}
