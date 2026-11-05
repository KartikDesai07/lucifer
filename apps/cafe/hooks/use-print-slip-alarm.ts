"use client";

import { useEffect } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { PRINTERS_KEYS, printersOfRead, type PrintersRead } from "@/hooks/use-agent-printers";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { isAlertSoundUnlocked, playAlertPing } from "@/lib/alert-sound";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printAlarmMessage, printAlarmStep, printAlarmSummary, printerNameOf, type PrintAlarmMemory } from "@/lib/print-waiting";
import { onPrinterPanelOpenChange, openPrinterPanel, printerPanelIsOpen } from "@/lib/printer-panel-open";

// Session 1D (spec §10): the 20 s alarm. A KOT still not printed 20 s after it was made (it is in the
// waiting-slips feed from then on) sounds once and shows a lasting notice on the device that asked for
// it AND on the device that prints it; a bill that may already have printed tells its cashier, and any
// slip that could not print says so. It rides the pulse the provider already polls (a query-cache
// subscription, never a request or a poll of its own), so it fires at the first pulse after the 20 s
// mark. The rules are printAlarmStep's (lib/print-waiting.ts): once per slip, again only when it gets
// worse; a notice goes when its slip leaves the feed or staff acted on it. On a phone the notice covers
// the top bar, so it carries its own Show button that opens the printer sheet.
//
// The 1D review gate: what this page already rang is kept per page, not per mount (a remount rings
// nothing twice), a page that opens while slips wait shows one summary notice instead of one per slip,
// and an unmount takes its notices down (none is left behind after signing out). The Phase 1 final gate
// (M4): the summary stands for the slips that already waited, re-worded as they print, gone with the last.

const SHOW = { label: "Show", onClick: openPrinterPanel };
// Sonner's action button is small; 44 px is the house tap target (1D gate M-5).
const SHOW_STYLE = { minHeight: 44, minWidth: 44 };
const SUMMARY_ID = "print-alarm-summary";

let page: { deviceId: string; memory: Map<string, PrintAlarmMemory>; seeded: boolean; summary: number } = { deviceId: "", memory: new Map(), seeded: false, summary: 0 };

export function usePrintSlipAlarm(deviceId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (deviceId === "") return;
    if (page.deviceId !== deviceId) page = { deviceId, memory: new Map(), seeded: false, summary: 0 };
    const check = (data: PosPulseData | undefined): void => {
      const rows = data?.printAttention;
      if (rows === undefined) return; // a failed read says nothing either way
      const step = printAlarmStep(page.memory, { rows, truncated: data?.printAttentionTruncated === true }, deviceId, Date.now(), !page.seeded, printerPanelIsOpen());
      page.memory = step.memory;
      page.seeded = true;
      for (const id of step.dismiss) toast.dismiss(`print-alarm-${id}`);
      if ((step.ring || step.summary > 0) && readDevicePrefs().alertSound && isAlertSoundUnlocked()) playAlertPing();
      for (const row of step.show) {
        // Session 3B: its printer's problem, named from the printers this device already read (no request).
        const message = printAlarmMessage(row, printerNameOf(printersOfRead(qc.getQueryData<PrintersRead>(PRINTERS_KEYS.all)), row.printerId));
        toast.warning(message, { id: `print-alarm-${row.id}`, duration: Number.POSITIVE_INFINITY, action: SHOW, actionButtonStyle: SHOW_STYLE });
      }
      if (step.summaryWaiting !== page.summary) {
        if (step.summaryWaiting === 0) toast.dismiss(SUMMARY_ID);
        else toast.warning(printAlarmSummary(step.summaryWaiting), { id: SUMMARY_ID, duration: Number.POSITIVE_INFINITY, action: SHOW, actionButtonStyle: SHOW_STYLE });
        page.summary = step.summaryWaiting;
      }
    };
    check(qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all));
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      check(event.query.state.data as PosPulseData | undefined);
    });
    // PX-2 (spec §6.9 B5): no toast ever covers the open printer panel. While it is open check is quiet (the ping still
    // plays for a slip that newly waits); its open takes down every notice that is up, each remembered shown: false, and
    // takes the slips out from under the summary: staff see them all there, so nothing pops after the close (F-M8).
    const offOpen = onPrinterPanelOpenChange((open) => {
      if (!open) return;
      toast.dismiss(SUMMARY_ID);
      page.summary = 0;
      for (const [id, { summary: _listed, ...slip }] of page.memory) {
        if (slip.shown) toast.dismiss(`print-alarm-${id}`);
        page.memory.set(id, { ...slip, shown: false });
      }
    });
    return () => {
      unsubscribe();
      toast.dismiss(SUMMARY_ID);
      offOpen();
      page.summary = 0;
      for (const [id, slip] of page.memory) {
        if (!slip.shown) continue;
        toast.dismiss(`print-alarm-${id}`);
        page.memory.set(id, { ...slip, shown: false });
      }
    };
  }, [deviceId, qc]);
}
