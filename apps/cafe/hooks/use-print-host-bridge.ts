"use client";

// Print-host plan §B5 (PH-5) — the host's ONE print bridge: three provider-owned react-to-print
// surfaces (KOT/void/moved · bill · end-of-day), the "what is on the paper right now" state, and the
// dispatch effect that fires exactly one surface per job. react-to-print keeps ONE fixed-id iframe
// (`lib/print.ts` print-chain note), so the surface — the whole window from claim to onAfterPrint — draws one slip
// at a time (§B5, MERGED-13: the EOD and test slips ride the same window). Session 1C: each slip's caller (the print
// agent) hears its result once; Phase 6 (spec §9 rulings 8–13): by its ticket (print-host-tickets.ts), and a slip for one
// of the POS app's printers or a Windows app network printer frees the surface once its bytes are on that printer's lane.

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";

import { useSettings } from "@/hooks/use-settings";
import { useSlipCodePending } from "@/hooks/use-slip-code-pending";
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
import { createWindowLateCompletionGuard } from "@/lib/print-host-late-completion";
import { hostPrintFailureMessage } from "@/lib/print-write-outcome";
import { createHostSlipTickets, dispatchSlip, laneWriteEnd, settleOrRelease, withdrawSlip, type HostPrintDone, type HostSlipTicket, type HostTestSlipWaiter } from "@/lib/print-host-tickets";
import { slipToastOf } from "@/lib/print-job-toast";
import { textKotEnv, textKotWriteFor } from "@/lib/printer/kot-text/text-kot-print";
import type { Order } from "@/types";

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation test slip
 *  (`PrintHostTestSlip`); it and a printer's Test print (Session 2D) use the KOT surface. Printing Phase 4 (spec §5.1):
 *  a printer's text test rides the test slip's window, its bytes written by `write` instead of the KOT surface. Phase 6
 *  Task 4 fix round 1: with its ticket, so a dispatch run acts only for the ticket on the surface. */
export type HostPrintCurrent = { kind: "slip"; slip: HostPrintSlip; ticket: HostSlipTicket } | { kind: "test"; write?: () => Promise<void>; ticket: HostSlipTicket };

function surfaceOf(current: HostPrintCurrent): HostPrintSurface {
  return current.kind === "test" || current.slip.surface === "test" ? "kot" : current.slip.surface;
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
  // SYNCHRONOUS occupancy — set the moment a slip is accepted, cleared only when nothing is left to
  // print; handlers read this, never `current` (state lags a render). A slip that arrives mid-print
  // (the band's manual tap has no busy gate) WAITS here instead of replacing `current`: a second
  // react-to-print call tears down the fixed-id `#printWindow` iframe in use (review PH-5 L1).
  const occupiedRef = useRef(false);
  // Phase 6 (spec §9 ruling 10): each waiting slip with its ticket, and the ticket of the slip on the surface.
  const pendingRef = useRef<Array<{ slip: HostPrintSlip; ticket: HostSlipTicket }>>([]);
  const ticketRef = useRef<HostSlipTicket | null>(null);
  const testRef = useRef<HostTestSlipWaiter | null>(null);
  // Armed at dispatch, cleared by settle: the ceiling on one job's in-flight
  // window (PRINT_HOST_DISPATCH_TIMEOUT_MS). Without it a surface that never
  // reports back — react-to-print's silent null-ref return, a torn-down
  // iframe — left `busy` true for the rest of the tab's life and every later
  // slip queued behind a job that would never print.
  const watchdogRef = useRef<number | null>(null);
  // A job the watchdog gave up on is ABANDONED, not forgotten: its slot stays occupied
  // until it reports or the grace passes (one shared onAfterPrint would settle the NEXT job).
  const [lateGuard] = useState(createWindowLateCompletionGuard);
  const [tickets] = useState(createHostSlipTickets);
  const disarmRef = useRef<() => void>(() => undefined); // Phase 6 (spec §9 ruling 9): the slip being drawn's lane arm
  const [, setWritesEnded] = useState(0); // a lane write's end re-renders `busy`
  // PX-2 (spec §6.9 B7): the job of the slip on the paper now, for its toast; set before the dispatch effect runs.
  const jobIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    jobIdRef.current = current?.kind === "slip" ? current.slip.jobId : undefined;
  }, [current]);

  const settle = useCallback((requested: string | null) => {
    disarmRef.current();
    const failure = lateGuard.take() ? null : requested; // already announced at the watchdog
    // A slip the watchdog gave up on that never reported may be on paper: its caller hears "maybe", never "printed".
    // Phase 6 (spec §9 ruling 10): a slip handed off to its lane is answered by its write; the surface only frees.
    const handedOff = settleOrRelease(tickets, ticketRef.current, requested === null && !lateGuard.graceRanOut() ? { ok: true } : { ok: false, error: new Error(requested ?? PRINT_HOST_PRINT_FAILED_MESSAGE) });
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    dispatchedRef.current = false;
    setEodReady(false);
    const waiter = testRef.current;
    testRef.current = null;
    if (failure !== null) {
      if (!handedOff) toast.error(slipToastOf(failure, jobIdRef.current));
      waiter?.reject(new Error(failure));
    } else if (waiter) {
      waiter.resolve(performance.now() - waiter.startedAt);
    }
    // Promote the next waiting slip through the SAME busy window — `current`
    // never touches null between two queued jobs, so no lane sees a gap.
    const next = pendingRef.current.shift();
    ticketRef.current = next?.ticket ?? null;
    if (next) {
      setCurrent({ kind: "slip", slip: next.slip, ticket: next.ticket });
      return;
    }
    occupiedRef.current = false;
    setCurrent(null);
  }, [lateGuard, tickets]);
  const finish = useCallback(() => settle(null), [settle]);
  // The watchdog: announce now, reject a waiting test slip now, hold the slot; Phase 6 (spec §9 ruling 11): disarm first.
  const abandon = useCallback(() => {
    disarmRef.current();
    toast.error(slipToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE, jobIdRef.current));
    testRef.current?.reject(new Error(PRINT_HOST_PRINT_FAILED_MESSAGE));
    testRef.current = null;
    lateGuard.abandon(() => settle(null));
  }, [lateGuard, settle]);
  // A surface whose content node vanished mid-print (a re-render dropped the
  // slip) must release the drain, not wedge it behind a job that never prints.
  // A printer-lane failure says WHY (no printer, not connected, too long...); the Windows app's own sentence
  // comes unwrapped, so the agent tells a refusal from a slip that may be on paper (Phase 1 final gate, I-3).
  const onPrintError = useCallback(
    (_where: "onBeforePrint" | "print", error: Error) => settle(hostPrintFailureMessage(error)),
    [settle],
  );
  // Phase 6 (spec §9 ruling 10): a write on its lane ended (its ticket told its caller): a failure toasts once, in its own
  // slip's job's words (lib/print-host-tickets.ts laneWriteEnd), and `busy` is read again.
  const [onWriteEnd] = useState(() => laneWriteEnd((failure, jobId) => toast.error(slipToastOf(failure, jobId)), () => setWritesEnded((n) => n + 1)));

  const kotRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const eodRef = useRef<HTMLDivElement>(null);
  const documentTitle = current?.kind === "slip" ? current.slip.documentTitle : PRINT_HOST_TEST_TITLE;
  const slipCodePending = useSlipCodePending(); // R6: a saved design's lazy code is still on its way
  // Phase 2 Session 2E (spec §9.2): a Windows printer job prints on its printer, drawn for its paper; Session 2F1: one of
  // the POS app's printers likewise (raster); else as before.
  const target = current?.kind === "slip" ? current.slip.target : undefined;
  // Phase 3 Session 3E (spec §9.6): a network printer of the Windows app likewise (raster, through its raw TCP).
  const raster = target?.nativeId !== undefined ? { nativeId: target.nativeId, paper: target.paper } : target?.lan !== undefined ? { lan: target.lan, paper: target.paper } : undefined;

  const printKot = useReactToPrint(slipPrintOptions({
    contentRef: kotRef,
    documentTitle,
    pageStyle: receiptPageStyle(target?.paper ?? printCfg.kot.paperWidth),
    onAfterPrint: finish,
    onPrintError,
  }, target?.printerName, raster));
  const printReceipt = useReactToPrint(slipPrintOptions({
    contentRef: receiptRef,
    documentTitle,
    pageStyle: receiptPageStyle(target?.paper ?? printCfg.bill.paperWidth),
    onAfterPrint: finish,
    onPrintError,
  }, target?.printerName, raster));
  // Fixed 80mm like EndOfDayButton (EndOfDaySummary is hardcoded w-[300px]); a Windows printer's own roll (scaled).
  const printEod = useReactToPrint(slipPrintOptions({
    contentRef: eodRef,
    documentTitle,
    pageStyle: target === undefined ? RECEIPT_PAGE_STYLE : receiptPageStyle(target.paper),
    onAfterPrint: finish,
    onPrintError,
  }, target?.printerName, raster));

  // Dispatch: runs AFTER the commit that rendered the slip into its surface (PrintHostPrintSources is a context
  // consumer below this provider, so its effects — and DOM — land before this parent effect), exactly the page
  // bridge's shouldPrintKot-then-print ordering. Three guards stand between a claimed job and the printer
  // (2026-09-11): the sources must be MOUNTED (a job claimed while they were not — behind MasterDataProvider's
  // first-load placeholder — used to fire react-to-print at a null ref, which returns silently with neither
  // onAfterPrint nor onPrintError and wedged this bridge until reload; `surfacesMounted` re-runs this effect the
  // moment they mount), the surface's node must EXIST (a null one is failed loud, never waited on blindly), and a
  // kot/receipt node must carry TEXT — an empty node is a blank slip, refused with a message instead of printed.
  // R6: before them, a bill or kitchen ticket waits (at most SLIP_CODE_WAIT_MAX_MS) while a saved design's lazy
  // code is on its way, so they see the finished slip. The watchdog then bounds the in-flight window itself.
  useEffect(() => {
    if (!current || dispatchedRef.current || !surfacesMounted) return;
    // Phase 6 Task 4 fix round 1: a run held past its slip's settle (react-dom runs passive effects in a later task) is stale.
    if (current.ticket !== ticketRef.current) return;
    const surface = surfaceOf(current);
    if (surface === "eod" ? !eodReady : current.kind === "slip" && slipCodePending) return;
    const node = surface === "receipt" || surface === "token" ? receiptRef.current : surface === "eod" ? eodRef.current : kotRef.current;
    if (!node) {
      settle(PRINT_HOST_PRINT_FAILED_MESSAGE);
      return;
    }
    if (surface !== "eod" && (node.textContent ?? "").trim() === "") {
      settle(PRINT_HOST_EMPTY_SLIP_MESSAGE);
      return;
    }
    // Phase 6 (spec §9 rulings 8, 9): a slip for one of the app's printers or a Windows app network printer (never a Test
    // print) hands its bytes to that printer's lane, so the surface frees once they exist (the picture and the text step).
    disarmRef.current = dispatchSlip(tickets, current.ticket, current.kind === "slip" ? current.slip : null, onWriteEnd);
    dispatchedRef.current = true;
    watchdogRef.current = window.setTimeout(abandon, PRINT_HOST_DISPATCH_TIMEOUT_MS);
    if (surface === "receipt" || surface === "token") printReceipt();
    else if (surface === "eod") printEod();
    else {
      // Printing Phase 4 (spec §5.2, S1, S3, S4): a job's kitchen slip whose printer's text switch is on, and that text
      // can print exactly, goes as text through that printer's own writer, under the same watchdog and outcome; so does a
      // printer's text test (§5.1); else the picture, exactly as before. The write starts at once, and one that throws
      // at once settles as a failed write, like any other (the 4B gate's m-2).
      const write = current.kind === "test" ? current.write : textKotWriteFor({ slip: current.slip, settings: settings.data, target, env: textKotEnv() })?.write;
      if (write === undefined) printKot();
      else void new Promise<void>((resolve) => resolve(write())).then(finish, (error: unknown) => settle(hostPrintFailureMessage(error)));
    }
  }, [current, eodReady, slipCodePending, surfacesMounted, printKot, printReceipt, printEod, settle, abandon, settings.data, target, finish, tickets, onWriteEnd]);

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

  // Phase 6 (spec §9 ruling 12): a slip still waiting to be drawn is taken back, sent "no"; the current one whose dispatch
  // still waits is replaced by the next through settle, which then only promotes (nothing was armed or timed for it).
  const withdraw = useCallback((ticket: HostSlipTicket): boolean => {
    const was = withdrawSlip(tickets, pendingRef.current, ticketRef.current, ticket);
    if (was === "current") settle(null);
    return was !== null;
  }, [tickets, settle]);

  const queueSlip = useCallback((slip: HostPrintSlip, done?: HostPrintDone): { withdraw(): boolean } => {
    const ticket = tickets.add(done ?? null, slip.jobId);
    if (occupiedRef.current) {
      pendingRef.current.push({ slip, ticket });
    } else {
      occupiedRef.current = true;
      ticketRef.current = ticket;
      setCurrent({ kind: "slip", slip, ticket });
    }
    return { withdraw: () => withdraw(ticket) };
  }, [tickets, withdraw]);

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
  // that waited on a KOT would measure the wrong thing). Phase 6 (spec §9 ruling 13): nor while a lane still writes.
  const queueTestSlip = useCallback(
    (write?: () => Promise<void>) =>
      new Promise<number>((resolve, reject) => {
        if (occupiedRef.current || tickets.writing() > 0) {
          reject(new Error(PRINT_HOST_BUSY_MESSAGE));
          return;
        }
        occupiedRef.current = true;
        const ticket = tickets.add(null);
        ticketRef.current = ticket;
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test", write, ticket });
      }),
    [tickets],
  );

  // Phase 6 (spec §9 ruling 12): unmounted, a waiting slip hears "no" at once and the slip on the surface "maybe"; a write
  // in flight settles by itself. The watchdog and the late guard keep their course.
  useEffect(() => () => { disarmRef.current(); tickets.unmount(); }, [tickets]);

  return {
    current,
    busy: current !== null || tickets.writing() > 0, // Phase 6 (spec §9 ruling 3): the surface and every write in flight
    drawing: current !== null, // the surface, its waiting slips included
    kotRef,
    receiptRef,
    eodRef,
    setEodReady,
    queueSlip,
    queueKotRound,
    queueTestSlip,
  };
}
