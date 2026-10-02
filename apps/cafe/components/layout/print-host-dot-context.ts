"use client";

import { createContext, useContext } from "react";

import type { PrintHostDot } from "@/lib/printer/printer-dot";

// The remote printer dot as its OWN narrow context, derived ONCE in
// PosPulseProvider (printHostDotOf) and served as a plain string. A consumer
// re-renders only when the dot value itself moves, never per pulse tick — the
// header button reads this instead of the wide pulse context. `null` default
// = the same crash fence as the other pulse accessors.
export const PrintHostDotContext = createContext<PrintHostDot | null>(null);

export function usePrintHostDot(): PrintHostDot {
  const dot = useContext(PrintHostDotContext);
  if (dot === null) {
    throw new Error("usePrintHostDot must be used inside <PosPulseProvider>");
  }
  return dot;
}
