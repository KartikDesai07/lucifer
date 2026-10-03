"use client";

import { useEffect } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { isAlertSoundUnlocked, playAlertPing } from "@/lib/alert-sound";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printAlarmMessage, printAlarmRows } from "@/lib/print-waiting";
import { openPrinterPanel } from "@/lib/printer-panel-open";

// Session 1D (spec §10): the 20 s alarm. A KOT still not printed 20 s after it was made (it is in the
// waiting-slips feed from then on) sounds once and shows a lasting notice on the device that asked for
// it AND on the device that prints it; a bill that may already have printed tells its cashier. It rides
// the pulse the provider already polls (a query-cache subscription, never a request or a poll of its
// own), so it fires at the first pulse after the 20 s mark. The notice goes away when the slip leaves
// the feed (printed, cleared); a slip that comes back rings again. On a phone it covers the top bar, so
// it carries its own Show button that opens the printer sheet.

export function usePrintSlipAlarm(deviceId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (deviceId === "") return;
    const rung = new Set<string>();
    const check = (data: PosPulseData | undefined): void => {
      const rows = data?.printAttention;
      if (rows === undefined) return; // a failed read says nothing either way
      const live = new Set(rows.map((row) => row.id));
      for (const id of [...rung]) {
        if (live.has(id)) continue;
        rung.delete(id);
        toast.dismiss(`print-alarm-${id}`);
      }
      const fresh = printAlarmRows(rows, deviceId, rung);
      if (fresh.length === 0) return;
      if (readDevicePrefs().alertSound && isAlertSoundUnlocked()) playAlertPing();
      for (const row of fresh) {
        rung.add(row.id);
        toast.warning(printAlarmMessage(row), {
          id: `print-alarm-${row.id}`,
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Show", onClick: openPrinterPanel },
        });
      }
    };
    check(qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all));
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      check(event.query.state.data as PosPulseData | undefined);
    });
  }, [deviceId, qc]);
}
