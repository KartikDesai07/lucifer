"use client";

import { useMemo, useSyncExternalStore } from "react";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useDesktopPrinters, usePoolView, usePrintersRead } from "@/hooks/use-agent-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { agentPrintersOf } from "@/lib/print-agent-printers";
import { textKotEnv } from "@/lib/printer/kot-text/text-kot-print";
import { textKotPrintersOf, type TextKotPrinter } from "@/lib/printer/kot-text/text-kot-printers";
import { readTextKot, subscribeTextKot, type TextKotChoice } from "@/lib/printer/kot-text/text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1): the "Fast text KOTs" section's reads. The printers come from the same printers
// read as the agent's (one cache entry, no request of its own) and this device's printers' live state; a switch from this
// device's storage, followed across tabs.

const NO_TEXT_KOT_PRINTERS: TextKotPrinter[] = [];

/** The printers this device prints kitchen slips on, each with its text key, paper and writer. None until this device's
 *  printers read has answered (the 4B gate's m-1): before it, an empty read looks like simple mode, and a printers-mode
 *  cafe would list this device's own printer under a key none of its printer jobs uses. */
export function useTextKotPrinters(): TextKotPrinter[] {
  const { deviceId } = usePrintHostContext();
  const { printers, answered } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter();
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const settings = useSettings().data;
  return useMemo(
    () =>
      deviceId !== "" && !answered ? NO_TEXT_KOT_PRINTERS : textKotPrintersOf({ printers, agent: agentPrintersOf(printers, deviceId, local.printer, desktop, pool), settings, env: textKotEnv() }),
    [printers, answered, deviceId, local, desktop, pool, settings],
  );
}

type TextKotState = "off" | "auto" | "narrow";

function stateOf(key: string): TextKotState {
  const choice = readTextKot(key);
  return choice === null ? "off" : choice.narrow80 ? "narrow" : "auto";
}

/** That printer's switch: its choice when on, null when off. */
export function useTextKot(key: string): TextKotChoice | null {
  const state = useSyncExternalStore(subscribeTextKot, () => stateOf(key), (): TextKotState => "off");
  return useMemo(() => (state === "off" ? null : { narrow80: state === "narrow" }), [state]);
}
