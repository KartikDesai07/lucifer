"use client";

import { useEffect, useRef } from "react";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import { printAgentPollsWake, type PrintJobsForMe, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import type { PrintAgent } from "@/lib/print-agent";
import { jobsForMeLeasable, type AgentPrinters } from "@/lib/print-agent-printers";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { printerHealthReports, setTakenOverPrinters } from "@/lib/print-agent-seams";
import { olderWakeBody, printAgentSkew } from "@/lib/print-agent-skew";
import { nativeBridge } from "@/lib/printer/native-bridge";
import { NATIVE_BRIDGE_V2, nativeV2Bridge } from "@/lib/printer/native-bridge-v2";
import { desktopLanApi } from "@/lib/printer/desktop-lan";
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
 *  printers), so the setup knows which tablet prints one printer. Session 3B: whether it can take a network printer
 *  over, that it prints token slips, and the health of the printers it prints here. */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  // Phase 3 Session 3E (spec §9.6): the Windows app 1.12.0 writes network printers itself (raw TCP).
  const desktopLan = desktop && desktopLanApi() !== null;
  const health = printerHealthReports();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
    shell: caps.native ? "android" : desktop ? "windows" : "browser",
    ...(caps.native ? { nativeProtocol: nativeV2Bridge() !== null ? NATIVE_BRIDGE_V2 : 1 } : {}),
    capabilities: {
      lan: caps.native || desktopLan,
      bluetooth: caps.native || caps.bluetooth,
      usb: caps.native,
      windowsPrinters: desktop,
      webSerial: caps.serial,
      webBluetooth: caps.bluetooth,
      // Session 3B (spec §9.3): it can write any network printer the setup names: the POS app on bridge v2, and the Windows
      // app from 1.12.0 (Session 3E). A page that cannot never takes a printer over.
      lanFailover: (caps.native && nativeV2Bridge() !== null) || desktopLan,
    },
    // Session 3B (the token fix's M-2): this page prints token slips, so the wake's count includes them.
    tokenSlips: true,
    // Session 3B (spec §10): kept by the server only from the device that writes each printer now, and only on a change.
    ...(health.length > 0 ? { printers: health } : {}),
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
        // Session 3C (the 3B review gate's I-1): a server from before Phase 3 (a rollback) refuses the beat's new fields: the
        // wake goes once more without them (lib/print-agent-skew.ts), so the device keeps its heartbeat there.
        const data = await printAgentSkew.send(wakeBody(deviceId), olderWakeBody, (body) => apiSend<PrintWakeBeatData>(WAKE_URL, "POST", body));
        capRef.current = Math.min(PRINT_WAKE_DAILY_CAP, data.agentDailyCap);
        noteJobsForMe(data.jobsForMe, data.writesPrinters);
        setTakenOverPrinters(data.takenOver ?? []);
        return data;
      },
      socketHealthy: isRealtimeHealthy,
      // Phase 3 Session 3D (the gold's review, I-3): in the POS app a hidden page polls too: it is the device's
      // heartbeat and health beat while it prints with the screen off (the app's service runs it), at the cadence a
      // visible writer has; a hidden browser tab still never polls.
      mayPoll: () => isDesktopShell() || nativeBridge() !== null || document.visibilityState === "visible",
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
    return () => {
      wake.stop();
      setTakenOverPrinters([]);
    };
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);
}
