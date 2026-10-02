"use client";

// The printer panel's prop-driven pieces (no state, no hooks, no print
// machinery): the inline yes/no and the row for the printer saved on this
// device. Generic product voice; every control is 44px (PR1).
import { Badge } from "@/components/ui/badge";
import { printerTypeIcon, printerTypeLabel } from "@/components/print/printer-type";
import {
  PRINTER_ACTION_CLASS,
  PRINTER_TILE_BRAND_CLASS,
  PRINTER_TILE_CLASS,
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

export interface PrinterRowProps {
  printer: DevicePrinter;
  status: PrinterStatus;
}

const CONNECTED_CHIP_CLASS = "border-green-600/40 bg-green-50 text-green-700";

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

// A bordered row: transport icon, the name (wraps), "{type} · {paper}" under it,
// and a status chip with words (the colour is never the only signal).
export function PrinterRow({ printer, status }: PrinterRowProps) {
  const Icon = printerTypeIcon(printer);
  const connected = status === "connected";
  const statusLabel = STATUS_LABEL[status];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand-rule p-3">
      <span aria-hidden="true" className={cn(PRINTER_TILE_CLASS, PRINTER_TILE_BRAND_CLASS)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-brand-ink">{printer.name}</p>
        <p className="text-sm text-brand-muted">
          {printerTypeLabel(printer)} · {printer.paper === "58mm" ? "58 mm" : "80 mm"}
        </p>
      </div>
      <Badge variant={connected ? "outline" : "secondary"} className={cn(connected && CONNECTED_CHIP_CLASS)}>
        {statusLabel}
      </Badge>
    </div>
  );
}
