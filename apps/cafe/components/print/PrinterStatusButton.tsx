"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { GlyphPrinter } from "@/components/layout/nav-icons";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { usePrintWaitingCount } from "@/components/layout/print-waiting-context";
import { PrinterPanel, type PrinterPanelView } from "@/components/print/PrinterPanel";
import { PrinterPanelFrame } from "@/components/print/PrinterPanelFrame";
import {
  PRINTER_DOT_CLASS,
  PRINTER_DOT_OK_CLASS,
  PRINTER_DOT_WARN_CLASS,
  PRINTER_ICON_BUTTON_CLASS,
} from "@/components/print/printer-classes";
import { useDotPrinters } from "@/hooks/use-agent-printers";
import { useServerReach } from "@/hooks/use-server-reach";
import { useOfflinePrintsHere } from "@/hooks/use-offline-send";
import { offlineHeaderOf } from "@/lib/offline-guard";
import { heldPrinterSnapshotOf, useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerButtonName, printerDotOf, printerDotTone, type PrinterDotTone } from "@/lib/printer/printer-dot";
import { printWaitingName } from "@/lib/print-waiting";
import { onOpenPrinterPanel, reportPrinterPanelOpen } from "@/lib/printer-panel-open";
import { cn } from "@/lib/utils";

// The top-bar printer button (all staff). Reads NARROW inputs only — the dot
// context, this device's host flag, the device printer, the lane and the
// network — never the wide pulse, so a quiet pulse tick re-renders nothing
// here. The frame's panel (mounted only while open) is the one that reads the
// pulse for the labels. PX-2 (spec §6.1): the sheet's two views (status first, settings one tap away) are this button's
// state. Ruling Q: every OPEN starts on the status view; a close never resets it, so a sheet sliding down from the settings
// view keeps showing them (and the panel's view switch never runs inside a closing sheet).

const STATUS_TITLE = "Printer";
const SETTINGS_TITLE = "Printer settings";

export function PrinterStatusButton({ onToneChange }: { onToneChange?: (tone: PrinterDotTone) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PrinterPanelView>("status");
  // Session 1D: the 20 s alarm's Show button opens this sheet, on the status view (Ruling Q).
  useEffect(() => onOpenPrinterPanel(() => {
    setView("status");
    setOpen(true);
  }), []);
  // PX-2 (spec §6.9 B5): the sheet's state, whichever path opened or closed it, so the alarm keeps its toasts off it.
  useLayoutEffect(() => reportPrinterPanelOpen(open), [open]);
  const remote = usePrintHostDot();
  const { isHostDevice, deviceId } = usePrintHostContext();
  // PX-2 (spec §6.9 B6): held through the app's own retries, as the panel reads it (no red ↔ checking flicker).
  const snapshot = heldPrinterSnapshotOf(useDevicePrinter());
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const desktopChosen = useDesktopPrinterChosen();
  // Session 2D (spec §10): in printers mode, the printers this device writes.
  const dotPrinters = useDotPrinters(deviceId);
  // Session 1D: how many slips wait for people, cafe-wide (the panel inside lists them).
  const waiting = usePrintWaitingCount();
  const dot = printerDotOf({ remote, isHostDevice, lane, local: snapshot.status, printers: dotPrinters, deviceOffline: !online, desktopChosen });
  // Printing Phase 5 (spec 5.10): offline, the button says what a send does here, in amber (the warn dot), by the send's
  // own rule (the final review's m6: a network printer its app reaches counts too).
  const offlinePrintsHereNow = useOfflinePrintsHere();
  const offlineHeader = offlineHeaderOf({ offline: useServerReach().offline, printsHere: offlinePrintsHereNow });
  const name = offlineHeader !== null ? offlineHeader.name : printWaitingName(printerButtonName(dot), waiting);
  // A printer that is only being checked draws no dot (never red while it connects).
  const tone = offlineHeader !== null ? "red" : printerDotTone(dot);
  // U1 Task 1 (design 6.1): the /pos header's clock block shows this same dot; the header takes the tone from here,
  // before the first paint (U1 final fix wave), so the dot is never one frame stale entering /pos.
  useLayoutEffect(() => onToneChange?.(tone), [onToneChange, tone]);
  // The trigger's open path: the status view (Ruling Q); a close leaves the view as it is.
  const openChange = (next: boolean): void => {
    if (next) setView("status");
    setOpen(next);
  };

  return (
    <PrinterPanelFrame
      open={open}
      onOpenChange={openChange}
      title={view === "settings" ? SETTINGS_TITLE : STATUS_TITLE}
      onBack={view === "settings" ? () => setView("status") : undefined}
      trigger={
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(PRINTER_ICON_BUTTON_CLASS, HTML_PRESS_CLASS)}
          aria-label={name}
          title={name}
          data-printer-dot={tone}
          data-printer-waiting={waiting}
          data-ui="printer-button"
        >
          <GlyphPrinter aria-hidden strokeWidth={1.8} />
          {tone !== "none" && (
            <span
              aria-hidden="true"
              className={cn(PRINTER_DOT_CLASS, tone === "green" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_WARN_CLASS)}
              data-ui="printer-dot"
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
      }
    >
      <PrinterPanel view={view} onView={setView} onClose={() => setOpen(false)} />
    </PrinterPanelFrame>
  );
}
