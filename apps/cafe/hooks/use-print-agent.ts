"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_REFRESH_MIN_MS } from "@pos/shared/print-budget";
import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import {
  printAgentPollsWake,
  type LeasedPrintJob,
  type PrintAckData,
  type PrintJobsForMe,
  type PrintLeaseData,
  type PrintWakeBeatData,
} from "@pos/shared/print-agent-wire";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onLeasedJob,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { jobsForMeLeasable, printJobCopies, printerListLooksStale, type AgentPrinters } from "@/lib/print-agent-printers";
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
  /** Session 2C: printers mode, whether this device writes a printer, and the ones it prints here. */
  printers: AgentPrinters;
  deviceId: string;
  tabId: string;
  /** The host bridge is printing something (a test slip, another slip). */
  busy: boolean;
  queueSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
}

/** Session 2C: the printers a lease names, omitted when there are none (simple mode, an old server). */
function printerIdsBody(ids: readonly string[]): { printerIds?: string[] } {
  return ids.length > 0 ? { printerIds: [...ids] } : {};
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

export function usePrintAgent({ enabled, isHost, printers, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const printer = useDevicePrinter();
  const canPrint = useCanPrintNow();
  const queueRef = useRef(queueSlip);
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  // Session 2C: the printers this tab prints on, read at call time by the lease, the wake and the headers.
  const readyRef = useRef<readonly string[]>(printers.localIds);
  const readyKey = printers.localIds.join(",");
  useEffect(() => {
    readyRef.current = readyKey === "" ? [] : readyKey.split(",");
  }, [readyKey]);
  const writerRef = useRef(printers.isWriter);
  useEffect(() => {
    writerRef.current = printers.isWriter;
  }, [printers.isWriter]);
  // Session 2C (the 2C gate's review, I-2): a printer job aimed at this device that it does not print on means its
  // printer list is stale (a missed print-setup frame, a printer just re-saved onto it): read it again, at most once
  // a minute, and the agent leases it as soon as it knows. A device that writes a printer which is not its local
  // printer reads it once a minute while that printer's slips wait (they go stale after 30 min). The other way (the
  // gate's emulator run): a writer the wake says the setup no longer names reads it once and stops polling.
  const setupReadAtRef = useRef(0);
  const noteJobsForMe = useCallback(
    (jobs: PrintJobsForMe | undefined, writesPrinters?: boolean): void => {
      if (!printerListLooksStale({ ready: readyRef.current, isWriter: writerRef.current, jobsForMe: jobs, writesPrinters })) return;
      if (Date.now() - setupReadAtRef.current < PRINT_SETUP_REFRESH_MIN_MS) return;
      setupReadAtRef.current = Date.now();
      void qc.invalidateQueries({ queryKey: PRINTERS_KEYS.all });
    },
    [qc],
  );
  const [agent, setAgent] = useState<PrintAgent | null>(null);

  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
  useEffect(() => {
    if (deviceId === "") return;
    const printOnce = (job: LeasedPrintJob): Promise<PrintAgentResult> =>
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
    // Session 2C: a printer job only on this device's own printer, every copy inside its one lease.
    const print = (job: LeasedPrintJob): Promise<PrintAgentResult> => printJobCopies(job, readyRef.current, () => printOnce(job));
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, ...printerIdsBody(readyRef.current) }),
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

  // The printer reconnected or changed: look at the line (the gate decides). Session 2B: a nudge, so the
  // printer's own status changes during the agent's print never queue an empty lease after it.
  useEffect(() => {
    agent?.nudge();
  }, [agent, printer, canPrint]);

  // Session 2C: the printers it prints on changed (a setup save, its printer reconnected as another): look again.
  useEffect(() => {
    agent?.nudge();
  }, [agent, readyKey]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
  // that make slips name it (directPrintTab → x-pos-print-lease), and a job an answer carries already leased
  // to it is printed here at once: no lease request, no realtime message.
  useEffect(() => {
    if (agent === null) return;
    const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));
    const offReady = setReadyPrintersSource(() => readyRef.current);
    const offLeased = onLeasedJob((job) => agent.take(job));
    return () => {
      offSource();
      offReady();
      offLeased();
    };
  }, [agent, tabId]);

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
      if ((data?.printJobsForMe?.count ?? 0) > 0) {
        noteJobsForMe(data?.printJobsForMe);
        if (jobsForMeLeasable(data?.printJobsForMe, readyRef.current)) agent.kick();
      }
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, deviceId, qc, noteJobsForMe]);

  // The wake poll (spec §9.1): the host in simple mode; in printers mode each writer, host or not (Session 2C, the
  // 2A gate's Important 1). Each spends against its share: the smaller of the constant and the wake's answer.
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
      leasable: (jobs) => jobsForMeLeasable(jobs, readyRef.current),
      onJobs: () => agent.kick(),
      ...timers(),
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, pollsWake, deviceId, noteJobsForMe]);

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
    if (agent === null || !enabled || nativeBridge() === null) return;
    return nativeOn("app.wake", () => agent.kick());
  }, [agent, enabled]);
}
