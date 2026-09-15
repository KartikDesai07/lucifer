"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { StaleBandRow } from "@/lib/print-readback";

// Print-host plan §B7 (PH-8) — the HOST device's stale rows, split out of
// PrintHostBandSection.tsx for its 120-line budget (the PrintHostCardParts
// idiom): prop-driven, no hooks, no print machinery. Each row is a >30-min
// queued slip the drain will never take (D1 is age-fenced): its label, its
// age (owner Q3+Q5), a Print that claims it for THIS host, and a Dismiss
// (`dismissReason:"staff"`, CC-10/SEC-7). Capped rows + the "+k older" link
// (MERGED-18); the section renders this ONLY on the host (MERGED-06).

const ORDERS_PATH = "/orders";
const AGE_UNIT = "min";

export interface PrintHostStaleRowsProps {
  rows: StaleBandRow[];
  hiddenCount: number;
  truncated: boolean;
  /** Rows whose Print/Dismiss was tapped and that have not left the feed yet. */
  tappedIds: ReadonlySet<string>;
  onPrint: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PrintHostStaleRows({ rows, hiddenCount, truncated, tappedIds, onPrint, onDismiss }: PrintHostStaleRowsProps) {
  return (
    <>
      {rows.map((row) => (
        <span key={row.id} className="flex items-center gap-1">
          <span className="text-muted-foreground">
            {row.label} · {row.ageMinutes} {AGE_UNIT}
          </span>
          <Button size="sm" variant="outline" disabled={tappedIds.has(row.id)} onClick={() => onPrint(row.id)}>
            Print
          </Button>
          <Button size="sm" variant="ghost" disabled={tappedIds.has(row.id)} onClick={() => onDismiss(row.id)}>
            Dismiss
          </Button>
        </span>
      ))}
      {(hiddenCount > 0 || truncated) && (
        <Link href={ORDERS_PATH} className="text-xs underline">
          +{hiddenCount}
          {truncated ? "+" : ""} older — reprint from Orders
        </Link>
      )}
    </>
  );
}
