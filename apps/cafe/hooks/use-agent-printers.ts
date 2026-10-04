"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { apiGet } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { agentPrintersOf, type AgentPrinters } from "@/lib/print-agent-printers";
import { subscribeRealtime } from "@/lib/realtime-client";

// Printing redesign, Phase 2 Session 2C (spec §9.1, §9.3): this device's view of the outlet's printers. Read on
// mount, again on a "print-setup" frame (an admin saved a printer: two Worker requests per save, never per
// slip), and on focus at most every 5 min (the fallback when a frame was missed). Never a poll.

export const PRINTERS_KEYS = { all: ["printers"] as const };
const PRINTERS_STALE_MS = 5 * 60 * 1000;
const NO_PRINTERS: PrinterConfig[] = [];

export function usePrinters(enabled: boolean): PrinterConfig[] {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: PRINTERS_KEYS.all,
    queryFn: () => apiGet<PrinterConfig[]>("/api/printers"),
    enabled,
    staleTime: PRINTERS_STALE_MS,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!enabled) return;
    return subscribeRealtime((kind) => {
      if (kind === "print-setup") void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    });
  }, [enabled, qc]);
  return query.data ?? NO_PRINTERS;
}

/** The printers this device writes, and which it prints on its one local printer (lib/print-agent-printers.ts). */
export function useAgentPrinters(deviceId: string, enabled: boolean): AgentPrinters {
  const printers = usePrinters(enabled);
  const local = useDevicePrinter().printer;
  return useMemo(() => agentPrintersOf(printers, deviceId, local, isDesktopShell()), [printers, deviceId, local]);
}
