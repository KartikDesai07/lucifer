"use client";

import { useEffect, useRef } from "react";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import { printAgentPollsWake, type PrintJobsForMe, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import type { PrintAgent } from "@/lib/print-agent";
import { jobsForMeLeasable, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { NATIVE_BRIDGE_V2, nativeV2Bridge } from "@/lib/printer/native-bridge-v2";
import { bumpPrintWakeBudget, mergePrintWakeBudget, readPrintWakeBudget, writePrintWakeBudget, type PrintWakeBudget } from "@/lib/print-wake-budget";
import { currentLane, defaultDeviceLabel, printCapabilities } from "@/lib/printer/print-lane";
import { isRealtimeHealthy } from "@/lib/realtime-client";
import { cafeDateString } from "@/lib/utils";

// Printing redesign (spec §9.1, §10): the agent's wake poll, the heartbeat it carries and the daily allowance it spends.
// Split out of hooks/use-print-agent.ts at the 2E review gate (M-5: that file had passed its ~300-line budget); the
// rules did not change. The host in simple mode (R6); in printers mode each writer, host or not (Session 2C, the 2A
// gate's Important 1). Each spends against its share: the smaller of the constant and the wake's answer.

const WAKE_URL = "/api/print-jobs/wake";

/** The heartbeat the host's wake carries (spec §10). Session 2F1: the POS app's bridge version (2: it prints several
 *  printers), so the setup knows which tablet prints one printer. */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
    shell: caps.native ? "android" : desktop ? "windows" : "browser",
    ...(caps.native ? { nativeProtocol: nativeV2Bridge() !== null ? NATIVE_BRIDGE_V2 : 1 } : {}),
    capabilities: {
      lan: caps.native,
      bluetooth: caps.native || caps.bluetooth,
      usb: caps.native,
      windowsPrinters: desktop,
      webSerial: caps.serial,
      webBluetooth: caps.bluetooth,
    },
  };
}

interface UsePrintAgentWakeOptions {
  agent: PrintAgent | null;
  enabled: boolean;
  isHost: boolean;
  printers: AgentPrinters;
  deviceId: string;
  /** The answer's jobs for this device, and whether the setup still names it a writer (a stale list is read again). */
  noteJobsForMe: (jobs: PrintJobsForMe | undefined, writesPrinters?: boolean) => void;
}

export function usePrintAgentWake({ agent, enabled, isHost, printers, deviceId, noteJobsForMe }: UsePrintAgentWakeOptions): void {
  const pollsWake = printAgentPollsWake({ hostConfigured: isHost, isHost, printersMode: printers.printersMode, isWriter: printers.isWriter });
  const capRef = useRef(PRINT_WAKE_DAILY_CAP);
  useEffect(() => {
    if (agent === null || !enabled || !pollsWake) return;
    let memory: PrintWakeBudget | null = null;
    const wake = createPrintAgentWake({
      wake: async () => {
        const data = await apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId));
        capRef.current = Math.min(PRINT_WAKE_DAILY_CAP, data.agentDailyCap);
        noteJobsForMe(data.jobsForMe, data.writesPrinters);
        return data;
      },
      socketHealthy: isRealtimeHealthy,
      mayPoll: () => isDesktopShell() || document.visibilityState === "visible",
      spendOne: () => {
        const dayKey = cafeDateString();
        const { record, allowed } = bumpPrintWakeBudget(mergePrintWakeBudget(readPrintWakeBudget(), memory, dayKey), dayKey, capRef.current);
        memory = record;
        writePrintWakeBudget(record);
        return allowed;
      },
      leasable: (jobs) => jobsForMeLeasable(jobs, agent.openPrinters()),
      onJobs: () => agent.kick(),
      now: () => Date.now(),
      setTimer: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
      clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);
}
