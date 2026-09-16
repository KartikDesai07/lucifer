"use client";

import { useEffect } from "react";

import { useOrders, useOrderSummary } from "@/hooks/use-orders";
import { useSettings } from "@/hooks/use-settings";
import { EndOfDaySummary } from "@/components/reports/EndOfDaySummary";

interface PrintHostEodSourceProps {
  dateKey: string;
  dateLabel: string;
  /** Derived on the host at claim time (lib/print-host-slips.ts): today's
   *  slip carries the open-tabs section, a past day's does not. */
  isToday: boolean;
  onReady: (ready: boolean) => void;
}

// Print-host plan §B1/§B5 (PH-5) — the end-of-day figures for a CLAIMED eod
// job. Mounted by PrintHostPrintSources only while an eod slip is current
// (PH-10 pins it dynamic, ssr:false, declared at MODULE scope there — RR-13),
// so these queries run on the host only for as long as one slip needs them.
// `ready` reproduces EndOfDayButton.tsx's own gate verbatim: figures AND
// settings loaded, and for today the open-tabs query succeeded (isSuccess is
// true for an empty list, false while loading or on error) — a false "all
// tabs settled" must never reach paper. Data-only: it owns NO print trigger;
// the bridge's eod surface fires once `onReady(true)` lands.
export function PrintHostEodSource({ dateKey, dateLabel, isToday, onReady }: PrintHostEodSourceProps) {
  // undefined for today shares the dashboard's own summary cache entry; a past
  // day is fetched once and never polled (use-orders' own rule).
  const summary = useOrderSummary(isToday ? undefined : dateKey);
  const openTabs = useOrders(
    { payment: "Unpaid", status: "Pending", limit: 200 },
    { enabled: isToday },
  );
  const settings = useSettings();

  const ready =
    !!summary.data && !!settings.data && (!isToday || openTabs.isSuccess);

  useEffect(() => {
    onReady(ready);
    return () => onReady(false);
  }, [ready, onReady]);

  return (
    <EndOfDaySummary
      summary={summary.data}
      openTabs={isToday ? (openTabs.data ?? []) : null}
      settings={settings.data}
      dateLabel={dateLabel}
    />
  );
}
