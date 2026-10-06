"use client";

import { useEffect, useMemo, useState } from "react";

import {
  loadSlipCode,
  slipCodeStatus,
  subscribeSlipCode,
  templateNeedsSlipCode,
  tokenTemplateNeedsSlipCode,
} from "@/components/print/slip/slip-code";
import { useSettings } from "@/hooks/use-settings";
import { billTemplateOf, kotTemplateOf, readTokenTemplate } from "@/lib/print-template-resolve";
import type { Settings } from "@/types";

/** How long the print host holds a slip for the chunk before it prints the legacy slip instead: well inside the 20 s
 *  kitchen alarm (PRINT_KOT_ALARM_MS) and the 90 s lease (PRINT_LEASE_MS), so a hung fetch can neither expire a
 *  lease (a duplicate kitchen ticket) nor hold the queue behind it. */
export const SLIP_CODE_WAIT_MAX_MS = 8_000;

/**
 * Whether this cafe's saved bill, kitchen-ticket or token template prints through the lazy slip chunk (slip-code.ts).
 * A token only ever needs it for a QR line (its designs are eager), and only a STORED token template can have one:
 * a cafe with none adds nothing here.
 */
export function settingsNeedSlipCode(settings: Settings | null | undefined): boolean {
  const bill = billTemplateOf(settings);
  const kot = kotTemplateOf(settings);
  const token = readTokenTemplate(settings);
  return (
    (bill !== null && templateNeedsSlipCode(bill)) ||
    (kot !== null && templateNeedsSlipCode(kot)) ||
    (token.state === "ok" && tokenTemplateNeedsSlipCode(token.template))
  );
}

/**
 * R6, the print host's load gate: true while this cafe's saved template needs the lazy slip chunk and it has neither
 * loaded nor failed, for at most SLIP_CODE_WAIT_MAX_MS per wait. The host holds a bill or kitchen ticket's dispatch
 * while it is true, so its empty-slip and node checks and react-to-print's clone all see the finished slip (the
 * receipts render the design once the chunk is in, and their legacy slip until then or if it fails). False, and
 * nothing fetched, for a cafe with no such template. On mount it starts the fetch, or retries a failed one, so the
 * chunk is usually in before the first job is claimed. Built on useState/useEffect, not useSyncExternalStore: the
 * host bridge runs under lib/hook-harness.ts in node:test.
 */
export function useSlipCodePending(): boolean {
  const settings = useSettings().data;
  const needs = useMemo(() => settingsNeedSlipCode(settings), [settings]);
  const [, setSeen] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!needs) return;
    const unsubscribe = subscribeSlipCode(() => setSeen((seen) => seen + 1));
    const now = slipCodeStatus();
    if (now === "idle" || now === "failed") void loadSlipCode();
    return unsubscribe;
  }, [needs]);
  const now = slipCodeStatus();
  const waiting = needs && (now === "idle" || now === "loading");
  useEffect(() => {
    // A wait that ends resets the ceiling, so the next one (a retry, a settings change) gets its own.
    if (!waiting) {
      setGaveUp(false);
      return;
    }
    const id = window.setTimeout(() => setGaveUp(true), SLIP_CODE_WAIT_MAX_MS);
    return () => window.clearTimeout(id);
  }, [waiting]);
  return waiting && !gaveUp;
}
