"use client";

import { memo } from "react";

import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import type { Order } from "@/types";

interface SelfOrderAutoPrintProps {
  /** Any print job queued or physically in flight, or an in-flight order write —
   *  not a safe moment to claim and print another ticket. */
  busy: boolean;
  queueKotRound: (order: Order, round?: number) => void;
}

// CB-1d.3b (C1) — the POS screen's self-order auto-print, moved OUT of PosPage's
// own render path. useSelfOrderAutoPrint subscribes to the pulse context, so the
// component that calls it re-renders on every payload-changing tick; when that
// was PosPage itself, a tick re-rendered the whole screen (~187 renders after
// C2). Hosted in this null-rendering child, a tick re-renders exactly this.
// memo: its props are one boolean and usePrintRouting's stable queueKotRound, so
// PosPage's own re-renders (taps, keystrokes) bail out here; a context change
// still re-renders a memoized consumer, so memo never blocks the pulse.
export const SelfOrderAutoPrint = memo(function SelfOrderAutoPrint({
  busy,
  queueKotRound,
}: SelfOrderAutoPrintProps) {
  useSelfOrderAutoPrint({ enabled: true, busy, queueKotRound });
  return null;
});
