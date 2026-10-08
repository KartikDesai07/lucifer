"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_SETUP_REFRESH_MIN_MS } from "@pos/shared/print-budget";
import type { LeasedPrintJob, PrintAckData, PrintJobsForMe, PrintLeaseData } from "@pos/shared/print-agent-wire";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useNativePool } from "@/hooks/use-device-printer";
import { usePrintAgentWake } from "@/hooks/use-print-agent-wake";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import { printerHealthClock } from "@/lib/print-agent-health";
import { olderAckBody, printAgentSkew } from "@/lib/print-agent-skew";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onLeasedJob,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setDirectPrintSource,
  markPrinterWriting,
  setPrinterHealthSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { jobsForMeLeasable, printJobCopies, printerListLooksStale, readyPrinterIdsOf, type AgentPrinters } from "@/lib/print-agent-printers";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import { desktopPrinterSnapshot, refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { devicePrinter } from "@/lib/printer/device-printer";
import { nativeBridge, nativeOn } from "@/lib/printer/native-bridge";
import { connectedPoolKey, nativePool, poolDefaultCannotPrint } from "@/lib/printer/native-pool";
import { printerCannotPrintOf, printerStatusOf, printersState } from "@/lib/printer/printer-registry";
import { canPrintNow } from "@/lib/printer/print-lane";
import { subscribeRealtime } from "@/lib/realtime-client";
import { cafeDateString } from "@/lib/utils";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent, wired to this page. The
// rules live in lib/print-agent.ts (unit-tested); this hook only connects them to the host bridge, the
// device printer and the signals that tell the agent a job is waiting for it:
//   · an order answer that named a job for this device (kickPrintAgent, no request);
//   · a "print-status" frame aimed at this device (R7), or — the host only — the "print-job" nudge;
//   · the existing 20 s pulse: every agent names itself there (?device=) and leases when its own line is
//     not empty (the host too, since the Phase 1 final gate: a spent wake share must not stop it);
//   · the host only: the wake POST at the spec §9.1 cadence (R6; hooks/use-print-agent-wake.ts since the 2E gate);
//   · its printer coming back, the bridge freeing up, the app returning to the screen;
//   · its one local timer (retryAt / nextAttemptAt from the server).
// No ordering device gains a recurring request: only the host polls, and only the wake it always had.

const LEASE_URL = "/api/print-jobs/lease";

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

function timers() {
  return {
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
    clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
  };
}

export function usePrintAgent({ enabled, isHost, printers, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const canPrint = useCanPrintNow();
  // The 2F1 review gate (N-1): which of the POS app's printers can print now (bridge v2).
  const poolReady = connectedPoolKey(useNativePool());
  const queueRef = useRef(queueSlip);
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  // Session 2C: the printers this tab prints on, read at call time. Session 2E: the agent leases, offers for direct
  // print and is kicked only for those of them no refusal holds (agent.openPrinters()).
  const readyRef = useRef<readonly string[]>(printers.localIds);
  const readyKey = printers.localIds.join(",");
  useEffect(() => {
    readyRef.current = readyKey === "" ? [] : readyKey.split(",");
  }, [readyKey]);
  // Session 3B (spec §9.3): the network printers among them (a refusal before any byte is acked "unreachable").
  const lanRef = useRef<readonly string[]>(printers.lanIds);
  const lanKey = printers.lanIds.join(",");
  useEffect(() => {
    lanRef.current = lanKey === "" ? [] : lanKey.split(",");
  }, [lanKey]);
  // Session 3C (the 3B review's m-1): the network printers it may take over that its app does not list (its beat says so).
  const missingRef = useRef<readonly string[]>(printers.takeoverMissingIds);
  const missingKey = printers.takeoverMissingIds.join(",");
  // The 3C review gate (its review's m-2): the beat's health clock (below) samples a new list at once, so its 20 s start now.
  const clockRef = useRef<{ reports: () => unknown } | null>(null);
  useEffect(() => {
    missingRef.current = missingKey === "" ? [] : missingKey.split(",");
    clockRef.current?.reports();
  }, [missingKey]);
  const writerRef = useRef(printers.isWriter);
  useEffect(() => {
    writerRef.current = printers.isWriter;
  }, [printers.isWriter]);
  // Session 2E (spec §9.2): the Windows printer each printer job of this PC prints on, by printer id.
  const targetsRef = useRef(printers.targets);
  useEffect(() => {
    targetsRef.current = printers.targets;
  }, [printers.targets]);
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
          queueRef.current(printAgentSlipOf(job, cafeDateString(), job.printerId === undefined ? undefined : targetsRef.current[job.printerId]), done);
        } catch {
          // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
        }
      });
    // Session 2C: a printer job only on this device's own printer, every copy inside its one lease. Session 2E: a Windows
    // printer that failed is looked up again in the Windows app, so one renamed or removed there stops being this PC's.
    // Session 3B (the final Phase 2 gate, (a) item 4): the POS app printer it writes to is marked meanwhile, so the page's
    // removal of a network printer it added waits for the print (hooks/use-agent-printers.ts).
    const print = async (job: LeasedPrintJob): Promise<PrintAgentResult> => {
      const nativeId = job.printerId === undefined ? undefined : targetsRef.current[job.printerId]?.nativeId;
      if (nativeId !== undefined) markPrinterWriting(nativeId, true);
      try {
        const result = await printJobCopies(job, readyRef.current, () => printOnce(job));
        if (!result.ok && job.printerId !== undefined && targetsRef.current[job.printerId]?.printerName !== undefined) void refreshDesktopPrinterChosen();
        return result;
      } finally {
        if (nativeId !== undefined) markPrinterWriting(nativeId, false);
      }
    };
    // Session 2F1 (spec §9.2): of the printers it prints here, those that can print now: one of the POS app's printers
    // (bridge v2) by its own state, any other while this device's own printer can print (as before).
    const readyNow = (): string[] => readyPrinterIdsOf(readyRef.current, targetsRef.current, canPrintNow(), printerStatusOf, printerCannotPrintOf);
    const created = createPrintAgent({
      deviceId,
      // tokenSlips: this page prints "token" jobs (S7); a page from before S7 leases none, on any line (print-lease.ts).
      lease: (printerIds) => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId, tokenSlips: true, ...printerIdsBody(printerIds) }),
      // Session 3B (the token fix's M-2): every ack says this page prints token slips, so its `more` counts them.
      // Session 3C (the 3B review gate's I-1): a server from before Phase 3 (a rollback) refuses tokenSlips and reason: the
      // ack goes once more without them (lib/print-agent-skew.ts), never read as answered and lost.
      ack: (id, body) => printAgentSkew.send({ ...body, tokenSlips: true }, olderAckBody, (sent) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", sent)),
      print,
      // Session 3C (the gate's review, m-2): a device that prints printers is ready only by their own states (its app's
      // default printer out of paper must not let a kick lease an empty line).
      // The 3C review gate (m-4): in simple mode the app's default printer (this device's) by its own state too.
      printerReady: () => (readyRef.current.length === 0 ? canPrintNow() && !poolDefaultCannotPrint(nativePool().getSnapshot()) : readyNow().length > 0),
      // Session 2E: the Windows app's printer list read again (a printer added or removed) releases a refusal's hold;
      // Session 2F1: so does any change of this device's printers (its own, or another of the app's).
      printerState: () => (isDesktopShell() ? desktopPrinterSnapshot() : printersState()),
      readyPrinters: readyNow,
      // The 2F1 review gate (M-1, with the 2E gate's M-9): a printer job's refusal holds its own printer's line, whether
      // or not this device still prints it (one that left the app's list between the request and the print), never the
      // device line, which would pause every other printer. A job with no printer (simple mode) holds the device line.
      lineOf: (job) => job.printerId ?? PRINT_DEVICE_LINE,
      networkPrinter: (job) => job.printerId !== undefined && lanRef.current.includes(job.printerId),
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

  // The printer reconnected or went away: look at the line (the gate decides). Session 2B: a nudge, so the
  // printer's own status changes during the agent's print never queue an empty lease after it. Session 2F1: one of
  // the POS app's printers too. The 2F1 review gate (N-1): only a change of what can print now (this device's own
  // printer, or which of the app's printers are connected): a down printer's own reconnect probes (connecting <->
  // disconnected, every 30 s) lease nothing while another printer prints.
  useEffect(() => {
    agent?.nudge();
  }, [agent, canPrint, poolReady]);

  // Session 2C: the printers it prints on changed (a setup save, its printer reconnected as another): look again.
  useEffect(() => {
    agent?.nudge();
  }, [agent, readyKey]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick((printerId) => agent.kick(printerId))), [agent]);

  // Session 3B (spec §10): the health of the printers it prints here rides the wake's beat (hooks/use-print-agent-wake.ts):
  // each of the POS app's printers by its own settled state, any other by this device's printer. Session 3C's review
  // (I-1): its 20 s clock runs on every status change, so a printer down 20 s reads down at the very next wake.
  useEffect(() => {
    if (agent === null) return;
    const clock = printerHealthClock(
      () => {
        const pool = nativePool().getSnapshot();
        return {
          localIds: readyRef.current,
          targets: targetsRef.current,
          pool: pool.active ? pool.printers : null,
          device: devicePrinter().getSnapshot().status,
          windows: isDesktopShell(),
          missing: missingRef.current,
          nowMs: Date.now(),
        };
      },
      [(listener) => nativePool().subscribe(listener), (listener) => devicePrinter().subscribe(listener)],
    );
    const offSource = setPrinterHealthSource(clock.reports);
    clockRef.current = clock;
    return () => {
      clockRef.current = null;
      offSource();
      clock.stop();
    };
  }, [agent]);

  // Phase 2 Session 2B (spec §7.11): while this tab drains this device's slips and can print now, the requests
  // that make slips name it (directPrintTab → x-pos-print-lease), and a job an answer carries already leased
  // to it is printed here at once: no lease request, no realtime message.
  useEffect(() => {
    if (agent === null) return;
    const offSource = setDirectPrintSource(() => (agent.directReady() ? tabId : null));
    const offReady = setReadyPrintersSource(() => agent.openPrinters());
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
        // The 2E review gate (M-1): a printer job's frame names its printer.
        const job = message.job as { status?: unknown; target?: unknown; printerId?: unknown } | undefined;
        if (job?.status === "queued" && job.target === deviceId) agent.kick(typeof job.printerId === "string" ? job.printerId : undefined);
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
        if (jobsForMeLeasable(data?.printJobsForMe, agent.openPrinters())) agent.kick();
      }
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, deviceId, qc, noteJobsForMe]);

  // The wake poll (spec §9.1) and its heartbeat (spec §10): hooks/use-print-agent-wake.ts.
  usePrintAgentWake({ agent, enabled, isHost, printers, deviceId, noteJobsForMe });

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
    if (agent === null || !enabled || nativeBridge() === null) return;
    return nativeOn("app.wake", () => agent.kick());
  }, [agent, enabled]);
}
