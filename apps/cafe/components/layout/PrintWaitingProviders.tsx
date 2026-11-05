"use client";

import type { ReactNode } from "react";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { PrintWaitingContext, PrintWaitingPrintersContext } from "@/components/layout/print-waiting-context";
import { printWaitingBadgeOf, printWaitingPrintersOf } from "@/lib/print-waiting";

// Session 1D's waiting count and PX-2's waiting printers (spec §6.5), each derived ONCE per pulse render from the pulse
// already read (no request, no timer) and served as a plain string, so the header button reads two narrow contexts and
// never the wide pulse: a quiet tick re-renders nothing. Its own file keeps PosPulseProvider within its 300 lines (F-I5).
export function PrintWaitingProviders({ data, children }: { data: PosPulseData | undefined; children: ReactNode }) {
  const waiting = printWaitingBadgeOf(data);
  const printers = printWaitingPrintersOf(data, Date.now());
  return (
    <PrintWaitingContext.Provider value={waiting}>
      <PrintWaitingPrintersContext.Provider value={printers}>{children}</PrintWaitingPrintersContext.Provider>
    </PrintWaitingContext.Provider>
  );
}
