"use client";

import { printReadbackText, type PrintReadbackChip, type PrintReadbackState } from "@/lib/print-readback";

// This device's own per-order readback chips (MERGED-10) — "order #12 KOT:
// printed at Counter PC". Lives here rather than in PrintHostBandSection so
// that file keeps its own 120-line budget (pinned by
// lib/print-host-band-paths.test.ts); it is presentational either way.

const CHIP_TONE: Record<PrintReadbackState, string> = {
  waiting: "text-muted-foreground",
  printed: "text-green-700 dark:text-green-400",
  cancelled: "font-medium text-destructive",
  "cancelled-at-host": "font-medium text-destructive",
};

export function PrintReadbackChips({
  chips,
  hostLabel,
}: {
  chips: readonly PrintReadbackChip[];
  hostLabel: string;
}) {
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.key} className={CHIP_TONE[chip.state]}>
          {chip.orderRef} {chip.kinds}: {printReadbackText(chip.state, hostLabel)}
        </span>
      ))}
    </>
  );
}
