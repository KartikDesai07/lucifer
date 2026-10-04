"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_STALE_MS } from "@pos/shared/print-budget";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { agentPrintersOf, dotPrintersOf, type AgentPrinters } from "@/lib/print-agent-printers";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
import { subscribeRealtime } from "@/lib/realtime-client";

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 30 min (the fallback when a frame was missed; print-budget.test.ts). Never
// a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = PRINT_SETUP_STALE_MS;
const NO_PRINTERS: PrinterConfig[] = [];

/** Session 2D: the printers read for a screen that only shows them (the dot, the bill printer, the setup page): the
 *  same cache entry as the agent's, without a print-setup subscription of its own, so an admin save costs one read
 *  per device, never one per screen (the 2D gate's review, M-5). `loaded` is false until the first answer. */
export function usePrintersRead(enabled: boolean): { printers: PrinterConfig[]; loaded: boolean; failed: boolean } {
  const query = useQuery({
    queryKey: PRINTERS_KEYS.all,
    queryFn: () => apiGet<PrinterConfig[]>("/api/printers"),
    enabled,
    staleTime: PRINTERS_STALE_MS,
    refetchOnWindowFocus: true,
  });
  return { printers: query.data ?? NO_PRINTERS, loaded: query.isSuccess, failed: query.isError };
}

/** The agent's read: the same query, plus the one print-setup subscription. */
export function usePrinters(enabled: boolean): PrinterConfig[] {
  const qc = useQueryClient();
  const { printers } = usePrintersRead(enabled);
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((kind) => {
      if (kind === "print-setup") void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    });
  }, [enabled, qc]);
  return printers;
}

/** Session 2D (spec §10): the top-bar dot's view of printers mode. The same printers read as the agent's (one cache
 *  entry): no request of its own. */
export function useDotPrinters(deviceId: string): PrinterDotPrinters {
  const { printers } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter().printer;
  return useMemo(() => dotPrintersOf(printers, deviceId, local, isDesktopShell()), [printers, deviceId, local]);
}

/** The printers this device writes, and which it prints on its one local printer (lib/print-agent-printers.ts). */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const local = useDevicePrinter().printer;
  return useMemo(() => agentPrintersOf(printers, deviceId, local, isDesktopShell()), [printers, deviceId, local]);
}
