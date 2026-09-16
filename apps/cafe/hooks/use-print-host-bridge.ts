"use client";

// Print-host plan §B5 (PH-5) — the host's ONE print bridge: three provider-
// owned react-to-print surfaces (KOT/void/moved · bill · end-of-day), the
// "what is on the paper right now" state, and the dispatch effect that fires
// exactly one surface per claimed job. Split out of PrintHostProvider.tsx for
// the file budget (fresh-eyes F12). react-to-print keeps ONE fixed-id iframe
// (`lib/print.ts` print-chain note), so `busy` here — the whole window from
// claim to onAfterPrint — is the gate every claiming lane respects (§B5,
// design review MERGED-13: the EOD and test slips are inside the same window,
// never a component-owned trigger outside it).

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";

import { useSettings } from "@/hooks/use-settings";
import { slipPrintOptions } from "@/lib/desktop-shell";
import { RECEIPT_PAGE_STYLE, printConfigOf, receiptPageStyle } from "@/lib/print";
import {
  PRINT_HOST_BUSY_MESSAGE,
  PRINT_HOST_DISPATCH_TIMEOUT_MS,
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
  PRINT_HOST_EOD_READY_TIMEOUT_MS,
  PRINT_HOST_EOD_TIMEOUT_MESSAGE,
  PRINT_HOST_PRINT_FAILED_MESSAGE,
  PRINT_HOST_TEST_TITLE,
  kotRoundSlip,
  type HostPrintSlip,
  type HostPrintSurface,
} from "@/lib/print-host-slips";
import type { Order } from "@/types";

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation
 *  test slip (`PrintHostTestSlip`, rendered through the KOT surface). */
export type HostPrintCurrent = { kind: "slip"; slip: HostPrintSlip } | { kind: "test" };

interface TestSlipWaiter {
  resolve: (dtMs: number) => void;
  reject: (err: Error) => void;
  startedAt: number;
}

function surfaceOf(current: HostPrintCurrent): HostPrintSurface {
  return current.kind === "test" ? "kot" : current.slip.surface;
}

interface UsePrintHostBridgeOptions {
  /** `PrintHostPrintSources` — the component that renders the DOM behind
   *  kotRef/receiptRef/eodRef — is mounted. Reported through the provider's
   *  context; nothing is dispatched while it is false. */
  surfacesMounted: boolean;
}

export function usePrintHostBridge({ surfacesMounted }: UsePrintHostBridgeOptions) {
  const settings = useSettings();
  const printCfg = printConfigOf(settings.data);

  const [current, setCurrent] = useState<HostPrintCurrent | null>(null);
  // `PrintHostEodSource` reports when the claimed day's figures have loaded;
  // the eod surface fires only then (§B5 — readiness is CLIENT query state).
  const [eodReady, setEodReady] = useState(false);
  // Fires each surface at most once per job — the dispatch effect re-runs on
  // eodReady/print-fn identity changes while the same job is still current.
  const dispatchedRef = useRef(false);
  // SYNCHRONOUS occupancy — set the moment a slip is accepted, cleared only
  // when nothing is left to print. Handlers read this, never `current` (state
  // lags a render). The two automatic lanes gate on `busy` and never queue
  // while a slip is in flight, but the band's manual "Print round N" tap does
  // not (its claim resolves whenever the server answers), so a second slip can
  // arrive mid-print: it WAITS here instead of replacing `current` — a second
  // react-to-print call tears down the fixed-id `#printWindow` iframe the first
  // job is still printing from (lib/print.ts print-chain note; review PH-5 L1).
  const occupiedRef = useRef(false);
  const pendingRef = useRef<HostPrintSlip[]>([]);
  const testRef = useRef<TestSlipWaiter | null>(null);
  // Armed at dispatch, cleared by settle: the ceiling on one job's in-flight
  // window (PRINT_HOST_DISPATCH_TIMEOUT_MS). Without it a surface that never
  // reports back — react-to-print's silent null-ref return, a torn-down
  // iframe — left `busy` true for the rest of the tab's life and every later
  // slip queued behind a job that would never print.
  const watchdogRef = useRef<number | null>(null);

  const settle = useCallback((failure: string | null) => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    dispatchedRef.current = false;
    setEodReady(false);
    const waiter = testRef.current;
    testRef.current = null;
    if (failure !== null) {
      toast.error(failure);
      waiter?.reject(new Error(failure));
    } else if (waiter) {
      waiter.resolve(performance.now() - waiter.startedAt);
    }
    // Promote the next waiting slip through the SAME busy window — `current`
    // never touches null between two queued jobs, so no lane sees a gap.
    const next = pendingRef.current.shift();
    if (next) {
      setCurrent({ kind: "slip", slip: next });
      return;
    }
    occupiedRef.current = false;
    setCurrent(null);
  }, []);
  const finish = useCallback(() => settle(null), [settle]);
  // A surface whose content node vanished mid-print (a re-render dropped the
  // slip) must release the drain, not wedge it behind a job that never prints.
  const onPrintError = useCallback(() => settle(PRINT_HOST_PRINT_FAILED_MESSAGE), [settle]);

  const kotRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const eodRef = useRef<HTMLDivElement>(null);
  const documentTitle = current?.kind === "slip" ? current.slip.documentTitle : PRINT_HOST_TEST_TITLE;

  const printKot = useReactToPrint(slipPrintOptions({
    contentRef: kotRef,
    documentTitle,
    pageStyle: receiptPageStyle(printCfg.kot.paperWidth),
    onAfterPrint: finish,
    onPrintError,
  }));
  const printReceipt = useReactToPrint(slipPrintOptions({
    contentRef: receiptRef,
    documentTitle,
    pageStyle: receiptPageStyle(printCfg.bill.paperWidth),
    onAfterPrint: finish,
    onPrintError,
  }));
  // Fixed 80mm like EndOfDayButton (EndOfDaySummary is hardcoded w-[300px]).
  const printEod = useReactToPrint(slipPrintOptions({
    contentRef: eodRef,
    documentTitle,
    pageStyle: RECEIPT_PAGE_STYLE,
    onAfterPrint: finish,
    onPrintError,
  }));

  // Dispatch: runs AFTER the commit that rendered the slip into its surface
  // (PrintHostPrintSources is a context consumer below this provider, so its
  // effects — and DOM — land before this parent effect), exactly the page
  // bridge's shouldPrintKot-then-print ordering. Three guards stand between a
  // claimed job and the printer (2026-09-11): the sources must be MOUNTED (a
  // job claimed while they were not — behind MasterDataProvider's first-load
  // placeholder — used to fire react-to-print at a null ref, which returns
  // silently with neither onAfterPrint nor onPrintError and wedged this bridge
  // until reload; `surfacesMounted` re-runs this effect the moment they mount),
  // the surface's node must EXIST (a null one is failed loud, never waited on
  // blindly), and a kot/receipt node must carry TEXT — an empty node is a blank
  // slip, refused with a message instead of printed. The watchdog then bounds
  // the in-flight window itself.
  useEffect(() => {
    if (!current || dispatchedRef.current || !surfacesMounted) return;
    const surface = surfaceOf(current);
    if (surface === "eod" && !eodReady) return;
    const node = surface === "receipt" ? receiptRef.current : surface === "eod" ? eodRef.current : kotRef.current;
    if (!node) {
      settle(PRINT_HOST_PRINT_FAILED_MESSAGE);
      return;
    }
    if (surface !== "eod" && (node.textContent ?? "").trim() === "") {
      settle(PRINT_HOST_EMPTY_SLIP_MESSAGE);
      return;
    }
    dispatchedRef.current = true;
    watchdogRef.current = window.setTimeout(() => settle(PRINT_HOST_PRINT_FAILED_MESSAGE), PRINT_HOST_DISPATCH_TIMEOUT_MS);
    if (surface === "receipt") printReceipt();
    else if (surface === "eod") printEod();
    else printKot();
  }, [current, eodReady, surfacesMounted, printKot, printReceipt, printEod, settle]);

  // The eod wait is bounded: an aggregate that never loads (host offline from
  // the API, a deploy in flight) must not hold every KOT behind it. The claim
  // is already burned — recovery is tapping End of day again, and the toast
  // says so. A no-op once dispatched (a long-open print dialog is not a stall).
  useEffect(() => {
    if (current?.kind !== "slip" || current.slip.surface !== "eod") return;
    const id = window.setTimeout(() => {
      if (!dispatchedRef.current) settle(PRINT_HOST_EOD_TIMEOUT_MESSAGE);
    }, PRINT_HOST_EOD_READY_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [current, settle]);

  const queueSlip = useCallback((slip: HostPrintSlip) => {
    if (occupiedRef.current) {
      pendingRef.current.push(slip);
      return;
    }
    occupiedRef.current = true;
    setCurrent({ kind: "slip", slip });
  }, []);

  // The self-order lane's `queueKotRound` on the host: the same slip the local
  // lane would synthesize, printed through THIS bridge instead of a page's.
  const queueKotRound = useCallback(
    (order: Order, round: number = order.kotRounds) => queueSlip(kotRoundSlip(order, round)),
    [queueSlip],
  );

  // PH-7's attestation handshake (§B7): resolves with trigger→onAfterPrint
  // milliseconds. Refused while anything is in flight or waiting — the test
  // rides the same busy window as every job, so it can never race a claimed
  // KOT's iframe, and it is never queued behind real slips (a timing probe
  // that waited on a KOT would measure the wrong thing).
  const queueTestSlip = useCallback(
    () =>
      new Promise<number>((resolve, reject) => {
        if (occupiedRef.current) {
          reject(new Error(PRINT_HOST_BUSY_MESSAGE));
          return;
        }
        occupiedRef.current = true;
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test" });
      }),
    [],
  );

  return {
    current,
    busy: current !== null,
    kotRef,
    receiptRef,
    eodRef,
    setEodReady,
    queueSlip,
    queueKotRound,
    queueTestSlip,
  };
}
