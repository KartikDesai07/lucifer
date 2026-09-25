"use client";

// The pulse-facing half of the PH-4 routing seam: the lane verdict, the
// `printHostSeen` device-prefs sync, the serialized routed chain, and
// queueMovedSlip. Split out of use-print-routing.ts in CB-1d.3b for the
// ~300-line invariant; use-print-routing.ts keeps the usePosPrint wrappers
// and re-exports useHostRouting so import paths are unchanged.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { printJobEnqueueAllowsLocalPrint, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import { usePrintHostRouting, usePrintReadbackRecorder } from "@/components/layout/PosPulseProvider";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useEnqueuePrintJob } from "@/hooks/use-print-host";
import { printReadbackRecordOf } from "@/lib/print-readback";
import {
  movedPrintJob,
  shouldRoutePrint,
  PRINT_JOB_BUILD_FAILED_MESSAGE,
  PRINT_JOB_TOO_LARGE_MESSAGE,
  type PrintHostRouting,
  type PrintJobRequest,
} from "@/lib/print-routing";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import type { Order } from "@/types";

export interface PrintRoutingHost {
  routing: PrintHostRouting;
  /** `routing === "host"` — a resolved, configured host owns printing now. */
  hostConfigured: boolean;
  /** Enqueues and returns the server's answer, or `null` when the request THREW
   *  (already toasted by the mutation's hook-level onError). `null` must NEVER
   *  be treated as permission to print locally. */
  enqueue: (job: PrintJobRequest) => Promise<PrintJobEnqueueResult | null>;
  /** True from the moment THIS instance's routePrint takes the routed lane
   *  until that enqueue has answered (PH-8 MUST, from the PH-6 review): the
   *  routed lane is silent on "queued" and PH-6's payloads are jobKey-less, so
   *  an un-disabled button double-taps into TWO slips at the counter. Armed
   *  SYNCHRONOUSLY in the tap's own render — the mutation's `isPending` alone
   *  lands a microtask plus a setTimeout(0) later (TanStack's notifyManager),
   *  a window a laggy tablet's second tap can fall inside. Per-instance on
   *  purpose — the Orders sheet's two buttons share one instance, so either
   *  tap disables both. Never true on the no-host lane (nothing is posted), so
   *  today's local path is unchanged. */
  enqueuePending: boolean;
  /** True when a print of `job` must be enqueued instead of printed here. */
  shouldRoute: boolean;
  /** THE routed-print primitive every print site shares: enqueues `buildJob()`
   *  when a host owns printing and runs `runLocal` only if this device must
   *  print after all — never both, so no caller can hand the counter a
   *  duplicate slip (§B7) or re-read the enqueue outcome itself (D-11).
   *  **`runLocal` may run AFTER an await** on the routed lane (the enqueue round
   *  trip, up to api-client's 15s timeout), so it must NOT assume the screen
   *  still shows what the tap referred to — PH-6's sites guard for exactly that. */
  routePrint: (buildJob: () => PrintJobRequest, runLocal: () => void) => void;
  /** The moved slip's routed path — MoveTableDialog (PH-6) is the caller, and it
   *  keeps its own local `useReactToPrint` for the no-host case (§B5 carve-out).
   *  Resolves TRUE when the host owns the slip (caller must NOT print locally)
   *  and FALSE when the caller must print it itself. A one-shot: unlike
   *  routePrint it does NOT join the serialization chain, because its only call
   *  site is a once-per-move effect that already cannot share a tick. */
  queueMovedSlip: (
    order: Order,
    meta: { from?: string; movedBy: string; movedAt: string },
  ) => Promise<boolean>;
}

// Turns the print lane into the one routing verdict every print path shares.
// The lane is read from PosPulseProvider's derived print-lane context
// (`usePrintHostRouting`), a plain string, so this hook re-renders only when
// the lane itself moves — never on every payload-changing tick as the old
// `pulse` read did (CB-1d.3b C1: that read was ~187 renders per changed tick
// on the POS screen). MUST be used inside <PosPulseProvider> —
// usePrintHostRouting throws otherwise; consumers: usePosPrint (POS tab +
// requests page) and the three PH-6 components.
export function useHostRouting(): PrintRoutingHost {
  const routing = usePrintHostRouting();
  const hostConfigured = routing === "host";

  // `readDevicePrefs()` is a localStorage read, so it can never run during
  // render (the server has no window, and a first paint that disagrees with the
  // hydrated one is a mismatch). Held in state and seeded post-mount: the
  // `false` a first render sees is the hydration-safe default, and only matters
  // for a print fired in the very tick this mounts.
  const [printHostSeen, setPrintHostSeen] = useState(false);

  useEffect(() => {
    setPrintHostSeen(readDevicePrefs().printHostSeen);
  }, []);

  // The `printHostSeen` writer (PH-4 owns it — the flag had none). Only a
  // RESOLVED verdict may move it: on `"unknown"` we do nothing at all, since an
  // unresolved or degraded tick is precisely the case the flag exists to carry
  // this device through (plan §F / MERGED-19). Read-modify-write through
  // readDevicePrefs() so a concurrent alertSound toggle is not clobbered.
  useEffect(() => {
    if (routing === "unknown") return;
    const seen = routing === "host";
    // Synced even when storage already agrees: another writer on this page
    // (DeviceAlertSettings persists the whole prefs blob) can move the stored
    // value under this instance, and an unconditional set is how the two
    // converge without a second read path.
    setPrintHostSeen(seen);
    const prefs = readDevicePrefs();
    if (prefs.printHostSeen === seen) return;
    writeDevicePrefs({ ...prefs, printHostSeen: seen });
  }, [routing]);

  const shouldRoute = shouldRoutePrint(routing, printHostSeen);

  // mutateAsync (not mutate) because the CALLER needs the server's answer to
  // decide whether the local path still has to run. The hook-level onError owns
  // the toast, so this catch only stops the rejection escaping a
  // fire-and-forget wrapper as an unhandled promise.
  const { mutateAsync: enqueueAsync, isPending } = useEnqueuePrintJob();
  // Routed prints this instance has accepted but not yet answered — counted
  // (not a boolean) because the Pay-Now pair queues two in one tick.
  const [routedInFlight, setRoutedInFlight] = useState(0);
  const enqueuePending = isPending || routedInFlight > 0;
  const qc = useQueryClient();
  const recordReadback = usePrintReadbackRecorder();
  const enqueue = useCallback(async (job: PrintJobRequest) => {
    try {
      const result = await enqueueAsync(job);
      // PH-8 (A-17, §B7): the id the SERVER answered with joins this device's
      // readback set — for "queued" the new row; for "already-resolved" the
      // EXISTING row the tap referred to, so the chip still resolves it to
      // "Sent ✓" rather than leaving the tap with no readback at all.
      if (result.outcome === "queued" || result.outcome === "already-resolved") {
        recordReadback(printReadbackRecordOf(result.id, job.payload));
      }
      // PH-5 (OPS-7): a job the HOST itself queued should drain on the next
      // microtask, not the next 20s tick — refetch the pulse so the drain's
      // feed sees it now. A handler-time pref read (never during render); a
      // non-host device gains nothing from an early tick and skips it.
      if (result.outcome === "queued" && readDevicePrefs().printHost) {
        void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
      }
      return result;
    } catch {
      return null;
    }
  }, [enqueueAsync, qc, recordReadback]);

  // Routed prints SERIALIZE through this chain — `confirmPayment`'s pay-now
  // branch fires the KOT and the bill in the SAME tick, and two concurrent
  // POSTs would race on both lanes:
  //  (a) enqueued, the drain replays rows in `createdAt` order (§B4 D1), so the
  //      bill's row can land first and print before the kitchen ticket — the
  //      exact inversion MERGED-16 exists to prevent;
  //  (b) answered no-host, the two local fallbacks would commit in
  //      HTTP-completion order, and react-to-print keeps ONE fixed-id iframe
  //      (`lib/print.ts:200-216`), so the second trigger force-removes the
  //      first's in-flight job and one of the two slips silently never prints.
  // Lives on `useHostRouting` because PH-6's three independent sites need the
  // same serialization: the Orders sheet's two buttons share one instance.
  const routedChainRef = useRef<Promise<void>>(Promise.resolve());

  // `runLocal` is invoked when — and only when — this device must print.
  // `buildJob` is a THUNK, not a built job: on the no-host path (§F's dark
  // rollout, the only path until a host is designated) nothing may run that
  // today's local print does not already run. Building the payload eagerly
  // would snapshot the whole order on every KOT/bill/void just to throw it
  // away — and a throw inside `printOrderSnapshot` would surface inside
  // `confirmPayment`'s catch, losing a receipt for an order the server had
  // already created.
  const routePrint = useCallback(
    (buildJob: () => PrintJobRequest, runLocal: () => void) => {
      // The no-host lane never touches the chain: it must stay SYNCHRONOUS so
      // both print flags land in ONE React batch, exactly as they did pre-PH-4
      // (§F byte-identical parity — that same-tick batching is the only reason
      // the bridge can sequence KOT before bill).
      if (!shouldRoute) {
        runLocal();
        return;
      }
      // Armed here, in the tap's own event, so the disable is on screen before
      // any second tap can land (see `enqueuePending`); released in the chain
      // step's finally so a throw anywhere below cannot leave a button dead.
      setRoutedInFlight((count) => count + 1);
      routedChainRef.current = routedChainRef.current
        .then(async () => {
          try {
            // A builder throw (a deploy-skew order the snapshot cannot read)
            // would otherwise reject a floating promise: no enqueue, no local
            // print and no signal at all. Nothing printed, so say so.
            let job: PrintJobRequest;
            try {
              job = buildJob();
            } catch {
              toast.error(PRINT_JOB_BUILD_FAILED_MESSAGE);
              return;
            }
            const result = await enqueue(job);
            if (result === null) return; // threw → the onError toast is the only signal
            if (printJobEnqueueAllowsLocalPrint(result.outcome)) runLocal();
            // Belt-and-braces: the enqueue route rejects an over-cap payload at
            // its own edge (a 400, i.e. a throw handled above), so this branch
            // is reachable only if that edge check ever goes away.
            else if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
          } finally {
            setRoutedInFlight((count) => count - 1);
          }
        })
        .catch(() => {
          // One slip's unexpected rejection must not poison the chain for every
          // slip queued after it.
        });
    },
    [shouldRoute, enqueue],
  );

  const queueMovedSlip = useCallback(
    async (order: Order, meta: { from?: string; movedBy: string; movedAt: string }) => {
      if (!shouldRoute) return false;
      // Built INSIDE the try for the same reason routePrint does it: a deploy-
      // skew order whose snapshot this builder cannot read would otherwise
      // reject the promise the caller awaits — no enqueue, no local print, no
      // signal at all, and an unhandled rejection. Answering TRUE is the
      // deliberate half: a payload that could not even be built must not turn
      // into a print dialog on a printerless device either (§B7).
      let job: PrintJobRequest;
      try {
        job = movedPrintJob(order, meta, { reprint: false });
      } catch {
        toast.error(PRINT_JOB_BUILD_FAILED_MESSAGE);
        return true;
      }
      const result = await enqueue(job);
      // A throw is not proof the write failed, and a local dialog on a
      // printerless non-host device is the §B7 hazard — claim the slip.
      if (result === null) return true;
      if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
      return !printJobEnqueueAllowsLocalPrint(result.outcome);
    },
    [shouldRoute, enqueue],
  );

  return { routing, hostConfigured, enqueue, enqueuePending, shouldRoute, routePrint, queueMovedSlip };
}
