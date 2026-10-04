"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { usePrintWaitingCount } from "@/components/layout/print-waiting-context";
import { PrinterPanel } from "@/components/print/PrinterPanel";
import {
  PRINTER_DOT_BAD_CLASS,
  PRINTER_DOT_CLASS,
  PRINTER_DOT_OK_CLASS,
  PRINTER_ICON_BUTTON_CLASS,
} from "@/components/print/printer-classes";
import { useDotPrinters } from "@/hooks/use-agent-printers";
import { useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerButtonName, printerDotOf, printerDotTone } from "@/lib/printer/printer-dot";
import { printWaitingName } from "@/lib/print-waiting";
import { onOpenPrinterPanel } from "@/lib/printer-panel-open";
import { cn } from "@/lib/utils";

// The top-bar printer button (all staff). Reads NARROW inputs only — the dot
// context, this device's host flag, the device printer, the lane and the
// network — never the wide pulse, so a quiet pulse tick re-renders nothing
// here. The sheet's panel (mounted only while open) is the one that reads the
// pulse for the labels.
const SHEET_TITLE = "Printer";
const SHEET_DESCRIPTION = "Printer status and setup for this device.";

export function PrinterStatusButton() {
  const [open, setOpen] = useState(false);
  // Session 1D: the 20 s alarm's Show button opens this sheet.
  useEffect(() => onOpenPrinterPanel(() => setOpen(true)), []);
  const remote = usePrintHostDot();
  const { isHostDevice, deviceId } = usePrintHostContext();
  const snapshot = useDevicePrinter();
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const desktopChosen = useDesktopPrinterChosen();
  // Session 2D (spec §10): in printers mode, the printers this device writes.
  const dotPrinters = useDotPrinters(deviceId);
  // Session 1D: how many slips wait for people, cafe-wide (the panel inside lists them).
  const waiting = usePrintWaitingCount();
  const dot = printerDotOf({ remote, isHostDevice, lane, local: snapshot.status, printers: dotPrinters, deviceOffline: !online, desktopChosen });
  const name = printWaitingName(printerButtonName(dot), waiting);
  // A printer that is only being checked draws no dot (never red while it connects).
  const tone = printerDotTone(dot);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={PRINTER_ICON_BUTTON_CLASS}
          aria-label={name}
          title={name}
          data-printer-dot={tone}
          data-printer-waiting={waiting}
        >
          <Printer />
          {tone !== "none" && (
            <span
              aria-hidden="true"
              className={cn(PRINTER_DOT_CLASS, tone === "green" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_BAD_CLASS)}
            />
          )}
          {waiting !== "" && (
            <span
              aria-hidden="true"
              className="absolute -left-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold leading-5 text-white"
            >
              {waiting}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{SHEET_TITLE}</SheetTitle>
          <SheetDescription>{SHEET_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <PrinterPanel onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
