"use client";

import { createContext, useContext } from "react";

// Session 1D (spec §10): how many slips wait for people ("", "3", "20+"), as its OWN narrow context,
// derived ONCE in PosPulseProvider (printWaitingBadgeOf) and served as a plain string, exactly like the
// printer dot: the header button reads this instead of the wide pulse context, so a quiet tick
// re-renders nothing. `null` default = the same crash fence as the other pulse accessors.
export const PrintWaitingContext = createContext<string | null>(null);

export function usePrintWaitingCount(): string {
  const count = useContext(PrintWaitingContext);
  if (count === null) {
    throw new Error("usePrintWaitingCount must be used inside <PosPulseProvider>");
  }
  return count;
}
