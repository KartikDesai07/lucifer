"use client";

import { useEffect } from "react";

import { useBeatPrintHost } from "@/hooks/use-print-host-beat";
import { devicePrinter } from "@/lib/printer/device-printer";
import { NATIVE_READY_EVENT } from "@/lib/printer/native-bridge";
import { onWindowEvent } from "@/lib/printer/capabilities";
import { subscribeDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { beatPrinterReport, type BeatPrinterReport } from "@/lib/printer/print-lane";
import { createReportDebouncer } from "@/lib/printer/report-debounce";

// Bluetooth-print plan W4 — tells the server the moment THIS host's printer
// state changes, so the printer dot on the other devices follows within a
// second or two instead of waiting for the next 20 s heartbeat (which carries
// the same report). A flap is coalesced: every change restarts the timer and
// only a settled value that differs from the last one sent is posted. A tab
// that does not own the printer reports nothing (beatPrinterReport() is
// undefined there), and nothing is sent while this device is not the host.
export const PRINTER_STATUS_BEAT_DEBOUNCE_MS = 1000;

interface UsePrintHostPrinterBeatOptions {
  enabled: boolean;
  deviceId: string;
  /** The `isHost:false` answer: clear the local pref and stop beating. */
  onDemoted: () => void;
}

export function usePrintHostPrinterBeat({ enabled, deviceId, onDemoted }: UsePrintHostPrinterBeatOptions): void {
  const { mutate: beat } = useBeatPrintHost({ onNotHost: onDemoted });

  useEffect(() => {
    if (!enabled || deviceId === "") return;
    // The server holds no report until the first beat: send the current one at once
    // (a printer set up BEFORE this device became the host never changes again, so
    // the subscription below would stay silent until the 20 s routine beat).
    const first = beatPrinterReport();
    const debouncer = createReportDebouncer<BeatPrinterReport, number>({
      initial: first,
      delayMs: PRINTER_STATUS_BEAT_DEBOUNCE_MS,
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle),
      read: beatPrinterReport,
      send: (printer) => beat({ deviceId, printer }),
    });
    // The printer's own changes, a late-arriving app bridge (which changes the lane), and the
    // desktop shell's printer choice (the report is connected/disconnected by whether one is chosen).
    const offPrinter = devicePrinter().subscribe(debouncer.poke);
    const offBridge = onWindowEvent(NATIVE_READY_EVENT, debouncer.poke);
    const offDesktop = subscribeDesktopPrinterChosen(debouncer.poke);
    if (first !== undefined) beat({ deviceId, printer: first });
    return () => {
      offPrinter();
      offBridge();
      offDesktop();
      debouncer.dispose();
    };
  }, [enabled, deviceId, beat]);
}
