"use client";

// The printing device's setup, moved out of PrinterSetupCard.tsx as it was (PX-3 Task 10, spec §6.6): which device prints
// every slip, read from the pulse (its label only lives there), and the two writes: designate this device, clear the
// printing device. Designating is NOT optional cosmetics: it is the only way a device becomes the printer. The settings
// cards draw these ("Print for other devices", More's "Remove the printing device"); every message and toast stays here.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { printersModeOn } from "@pos/shared/print-printers";
import type { PrintHostState } from "@pos/shared/print-job";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useDeviceOnline, usePrintLane } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useClearPrintHost, useDesignatePrintHost } from "@/hooks/use-print-host";
import { readDeviceId } from "@/lib/pos-device-id";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { DEVICE_LABEL_PC, defaultDeviceLabel } from "@/lib/printer/print-lane";

const HOST_LABEL_FALLBACK = "Another device";
/** Also the test print's (use-test-print.ts): one sentence for both. */
export const NO_DEVICE_ID_MESSAGE = "Device identity not found — check the browser's storage settings.";
const NO_HOST_TO_CLEAR_MESSAGE = "No printing device was set.";
const DESIGNATED_MESSAGE = "This device now prints all slips.";

const clearedMessage = (dismissed: number): string =>
  `Printing device removed — ${dismissed} waiting ${dismissed === 1 ? "slip" : "slips"} cancelled.`;

/** Read-modify-write over a FRESH read (never clobbering a concurrent alert toggle), then syncHostPref() so every lane
 *  disarms without a reload. The clear below and the test print's demoted beat (use-test-print.ts) both drop it. */
export function useDropHostPref(): () => void {
  const { syncHostPref } = usePrintHostContext();
  return () => {
    const prefs = readDevicePrefs();
    if (prefs.printHost) writeDevicePrefs({ ...prefs, printHost: false });
    syncHostPref();
  };
}

export interface PrinterSetupActions {
  /** `null` = unresolved pulse OR a degraded tick — never "no printing device". */
  host: PrintHostState | null;
  /** The configured printing device's name; null when none is set. */
  hostLabel: string | null;
  isHostDevice: boolean;
  /** THIS device has a network connection (PR3: offline reads as a status line, never "loading"). */
  online: boolean;
  /** Phase 2 Session 2D: printers are set up (spec §6.6), so no printing device plays a part. */
  printersMode: boolean;
  label: string;
  setLabel(next: string): void;
  designate(): Promise<void>;
  designating: boolean;
  clear(): Promise<void>;
  clearing: boolean;
}

export function usePrinterSetupActions(): PrinterSetupActions {
  const { pulse } = usePosPulseContext();
  const { syncHostPref, isHostDevice, deviceId } = usePrintHostContext();
  // Session 2D: printers mode (the agent's printers read, one cache entry) changes what "Print for other devices" says.
  const printersMode = printersModeOn(usePrintersRead(deviceId !== "").printers);
  const qc = useQueryClient();
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const [label, setLabel] = useState<string | null>(null);
  // Typed text wins; until then the name fits this kind of device (the server
  // render and first paint always use the PC name, so they agree).
  const shownLabel = label ?? (lane === "pending" ? DEVICE_LABEL_PC : defaultDeviceLabel(lane));
  const dropHostPref = useDropHostPref();
  const designate = useDesignatePrintHost();
  const clear = useClearPrintHost();

  const host = pulse?.printHost ?? null;
  const hostLabel = host !== null && host.configured ? (host.label ?? HOST_LABEL_FALLBACK) : null;

  const handleDesignate = async () => {
    const deviceId = readDeviceId();
    if (deviceId === "") {
      toast.error(NO_DEVICE_ID_MESSAGE);
      return;
    }
    try {
      await designate.mutateAsync({ deviceId, label: shownLabel.trim() || DEVICE_LABEL_PC });
      const prefs = readDevicePrefs();
      writeDevicePrefs({ ...prefs, printHost: true });
      syncHostPref();
      toast.success(DESIGNATED_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      // useDesignatePrintHost's hook-level onError already toasted.
    }
  };

  const handleClear = async () => {
    try {
      const { cleared, dismissed } = await clear.mutateAsync();
      dropHostPref();
      toast.success(cleared ? clearedMessage(dismissed) : NO_HOST_TO_CLEAR_MESSAGE);
      void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
    } catch {
      // The clear mutation's hook-level onError already toasted.
    }
  };

  return {
    host,
    hostLabel,
    isHostDevice,
    online,
    printersMode,
    label: shownLabel,
    setLabel,
    designate: handleDesignate,
    designating: designate.isPending,
    clear: handleClear,
    clearing: clear.isPending,
  };
}
