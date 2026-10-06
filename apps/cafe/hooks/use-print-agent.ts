"use client";

import { useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData, PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setPulsePrintDevice,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import { bumpPrintWakeBudget, mergePrintWakeBudget, readPrintWakeBudget, writePrintWakeBudget, type PrintWakeBudget } from "@/lib/print-wake-budget";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { devicePrinter } from "@/lib/printer/device-printer";
import { nativeBridge, nativeOn } from "@/lib/printer/native-bridge";
import { canPrintNow, currentLane, defaultDeviceLabel, printCapabilities } from "@/lib/printer/print-lane";
import { isRealtimeHealthy, subscribeRealtime } from "@/lib/realtime-client";
import { cafeDateString } from "@/lib/utils";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent, wired to this page. The
// rules live in lib/print-agent.ts (unit-tested); this hook only connects them to the host bridge, the
// device printer and the signals that tell the agent a job is waiting for it:
//   · an order answer that named a job for this device (kickPrintAgent, no request);
//   · a "print-status" frame aimed at this device (R7), or — the host only — the "print-job" nudge;
//   · the existing 20 s pulse: every agent names itself there (?device=) and leases when its own line is
//     not empty (the host too, since the Phase 1 final gate: a spent wake share must not stop it);
//   · the host only: the wake POST at the spec §9.1 cadence (R6);
//   · its printer coming back, the bridge freeing up, the app returning to the screen;
//   · its one local timer (retryAt / nextAttemptAt from the server).
// No ordering device gains a recurring request: only the host polls, and only the wake it always had.

const LEASE_URL = "/api/print-jobs/lease";
const WAKE_URL = "/api/print-jobs/wake";

interface UsePrintAgentOptions {
  /** This tab drains this device's line: it is an agent (the host; with no host, every device), its
   *  print surfaces exist, and it holds the drain lock. */
  enabled: boolean;
  /** This device is the print host: it polls the wake and also leases on the broadcast nudge. */
  isHost: boolean;
  deviceId: string;
  tabId: string;
  /** The host bridge is printing something (a test slip, another slip). */
  busy: boolean;
  queueSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
}

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
    shell: caps.native ? "android" : desktop ? "windows" : "browser",
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

function timers() {
  return {
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
    clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
  };
}

export function usePrintAgent({ enabled, isHost, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const printer = useDevicePrinter();
  const canPrint = useCanPrintNow();
  const queueRef = useRef(queueSlip);
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  const [agent, setAgent] = useState<PrintAgent | null>(null);

  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
  useEffect(() => {
    if (deviceId === "") return;
    const print = (job: LeasedPrintJob): Promise<PrintAgentResult> =>
      new Promise((resolve) => {
        // The bridge settles every slip; one its watchdog gave up on settles late, so this wait is bounded.
        const deadline = window.setTimeout(
          () => resolve({ ok: false, error: new Error(PRINT_HOST_PRINT_FAILED_MESSAGE) }),
          PRINT_AGENT_SLIP_DEADLINE_MS,
        );
        const done = (result: PrintAgentResult): void => {
          window.clearTimeout(deadline);
          resolve(result);
        };
        try {
          queueRef.current(printAgentSlipOf(job, cafeDateString()), done);
        } catch {
          // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
        }
      });
    const created = createPrintAgent({
      deviceId,
      // tokenSlips: this page prints "token" jobs (S7); a page from before S7 leases none (print-lease.ts).
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, tokenSlips: true }),
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", body),
      print,
      printerReady: canPrintNow,
      printerState: () => devicePrinter().getSnapshot(),
      readPending: readPendingAcks,
      writePending: writePendingAcks,
      ...timers(),
    });
    setAgent(created);
    void created.flushAcks();
    return () => {
      created.stop();
      setAgent(null);
    };
  }, [deviceId, tabId]);

  useEffect(() => {
    agent?.setGate({ enabled, busy });
  }, [agent, enabled, busy]);

  // The printer reconnected or changed: look at the line (the gate decides).
  useEffect(() => {
    agent?.kick();
  }, [agent, printer, canPrint]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  useEffect(() => {
    if (agent === null || !enabled) return;
    return subscribeRealtime((kind, message) => {
      if (kind === "print-status") {
        const job = message.job as { status?: unknown; target?: unknown } | undefined;
        if (job?.status === "queued" && job.target === deviceId) agent.kick();
      } else if (kind === "print-job" && isHost) {
        agent.kick();
      }
    });
  }, [agent, enabled, isHost, deviceId]);

  // Name this device on the pulse, and lease when its own line holds a job. The host too (the Phase 1 final
  // gate, I-2): with its daily wake share spent and the socket down, the pulse is how it still hears of the
  // slips other devices send it (spec §7.10). One bounded read on a request that already runs.
  useEffect(() => {
    if (agent === null || !enabled) return;
    setPulsePrintDevice(deviceId);
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    const off = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      const data = event.query.state.data as PosPulseData | undefined;
      if ((data?.printJobsForMe?.count ?? 0) > 0) agent.kick();
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, deviceId, qc]);

  // The host: the wake poll (spec §9.1), under the device's one daily cap.
  useEffect(() => {
    if (agent === null || !enabled || !isHost) return;
    let memory: PrintWakeBudget | null = null;
    const wake = createPrintAgentWake({
      wake: () => apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId)),
      socketHealthy: isRealtimeHealthy,
      mayPoll: () => isDesktopShell() || document.visibilityState === "visible",
      spendOne: () => {
        const dayKey = cafeDateString();
        const { record, allowed } = bumpPrintWakeBudget(mergePrintWakeBudget(readPrintWakeBudget(), memory, dayKey), dayKey, PRINT_WAKE_DAILY_CAP);
        memory = record;
        writePrintWakeBudget(record);
        return allowed;
      },
      onJobs: () => agent.kick(),
      ...timers(),
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, isHost, deviceId]);

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
    if (agent === null || !enabled || nativeBridge() === null) return;
    return nativeOn("app.wake", () => agent.kick());
  }, [agent, enabled]);
}
