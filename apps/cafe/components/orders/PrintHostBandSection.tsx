"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { PrintHostStaleRows } from "@/components/orders/PrintHostStaleRows";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useDismissPrintJob } from "@/hooks/use-print-host";
import {
  printHostLabelOf,
  printHostWarnings,
  printReadbackChips,
  printReadbackText,
  staleBandRows,
  type PrintReadbackEntry,
  type PrintReadbackState,
} from "@/lib/print-readback";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// Print-host plan §B7 (PH-8) — the band's print-host section, rendered by
// RequestAlertBar INSIDE its bandRef element so POS_ALERT_HEIGHT_VAR covers
// it (a second banner would need a second published height). Prop-driven on
// purpose: the pulse arrives from the bar, so this is NOT a seventh wide-pulse
// consumer (the pos-pulse-paths INVENTORY pin scans raw text). Three parts:
// the host warnings (offline · silent-off), the stale rows — Print + Dismiss
// ONLY on the host device (MERGED-06: a phone's Print would burn a kitchen
// ticket into a printerless dialog), a read-only count elsewhere — and this
// device's per-order readback chips (MERGED-10). The device id comes from
// PrintHostProvider's post-mount read (F8) — no storage read of its own.

const CHIP_TONE: Record<PrintReadbackState, string> = {
  waiting: "text-muted-foreground",
  printed: "text-green-700 dark:text-green-400",
  cancelled: "font-medium text-destructive",
  "cancelled-at-host": "font-medium text-destructive",
};

interface PrintHostBandSectionProps {
  pulse: PosPulseData | undefined;
  readback: PrintReadbackEntry[];
}

export function PrintHostBandSection({ pulse, readback }: PrintHostBandSectionProps) {
  const { isHostDevice, deviceId, printQueuedJob } = usePrintHostContext();
  const qc = useQueryClient();
  // Only the stable `.mutate` (useMutation returns a fresh object per render).
  const { mutate: dismissMutate } = useDismissPrintJob();
  // Rows whose Print/Dismiss was tapped and that have not left the feed yet —
  // the bar's own tappedIds precedent (review C5): the round trip plus one
  // tick pass before the row drops out, and an un-disabled button double-taps.
  const [tappedIds, setTappedIds] = useState<ReadonlySet<string>>(new Set());
  const stale = pulse?.stalePrintJobs;
  useEffect(() => {
    setTappedIds((prev) => {
      const live = new Set((stale ?? []).map((row) => row.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [stale]);

  const host = pulse?.printHost ?? null;
  const hostLabel = printHostLabelOf(host);
  const warnings = printHostWarnings(host);
  const { shown, hiddenCount } = staleBandRows(stale ?? [], Date.now());
  const truncated = pulse?.stalePrintJobsTruncated === true;
  const chips = printReadbackChips(readback);
  if (warnings.length === 0 && shown.length === 0 && chips.length === 0) return null;

  // The pulse's host binding, not just the local pref: a demoted device keeps
  // its pref until its next beat answers, and must not print in that window.
  const isHost = isHostDevice && deviceId !== "" && host?.deviceId === deviceId;
  const onPrint = (id: string) => {
    setTappedIds((prev) => new Set(prev).add(id));
    void printQueuedJob(id); // refreshes the pulse itself once the claim answers
  };
  const onDismiss = (id: string) => {
    setTappedIds((prev) => new Set(prev).add(id));
    dismissMutate(id, { onSettled: () => void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all }) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {warnings.map((warning) => (
        <span key={warning} className="font-medium text-amber-800 dark:text-amber-200">
          {warning}
        </span>
      ))}

      {shown.length > 0 && !isHost && (
        <span className="text-muted-foreground">
          {stale?.length}
          {truncated ? "+" : ""} older slip{stale?.length === 1 ? "" : "s"} waiting at {hostLabel}
        </span>
      )}
      {shown.length > 0 && isHost && (
        <PrintHostStaleRows
          rows={shown}
          hiddenCount={hiddenCount}
          truncated={truncated}
          tappedIds={tappedIds}
          onPrint={onPrint}
          onDismiss={onDismiss}
        />
      )}

      {chips.map((chip) => (
        <span key={chip.key} className={CHIP_TONE[chip.state]}>
          {chip.orderRef} {chip.kinds}: {printReadbackText(chip.state, hostLabel)}
        </span>
      ))}
    </div>
  );
}
