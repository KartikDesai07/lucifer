"use client";

import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";

import type { PaperWidth } from "@/lib/constants";
import { receiptPageStyle } from "@/lib/print";
import type { Order } from "@/types";

interface KotPrintBridgeReceiptArgs {
  shouldPrintReceipt: boolean;
  clearPrintReceipt: () => void;
  billPaperWidth: PaperWidth;
}

interface KotPrintBridgeArgs {
  lastOrder: Order | null;
  shouldPrintKot: boolean;
  clearPrintKot: () => void;
  kotPaperWidth: PaperWidth;
  // Omitted entirely for a KOT-only page (requests/page.tsx) — an accept
  // never collects money, so there is no receipt job to wire up; the effect
  // below simply never fires without it.
  receipt?: KotPrintBridgeReceiptArgs;
}

// The POS terminal's print bridge — both useReactToPrint jobs, the guard ref,
// and the two chaining effects — extracted out of pos/page.tsx (which was
// about to grow past the line budget) so requests/page.tsx's identical
// KOT-only half of this same discipline has one hook to call instead of a
// second hand-copied guard-ref/effect pair.
//
// react-to-print keeps ONE fixed-id iframe ("printWindow"): two print jobs in
// the same tick — or firing the receipt synchronously inside the KOT's own
// teardown — deletes whichever job's iframe was appended second (see the
// print-chain note in lib/print.ts, CR1.2). The receipt effect below is
// therefore gated on shouldPrintKot being clear, and the KOT's onAfterPrint
// only flips its own flags — it never calls the receipt's print() itself.
export function useKotPrintBridge({
  lastOrder,
  shouldPrintKot,
  clearPrintKot,
  kotPaperWidth,
  receipt,
}: KotPrintBridgeArgs) {
  const shouldPrintReceipt = receipt?.shouldPrintReceipt ?? false;
  const clearPrintReceipt = receipt?.clearPrintReceipt;

  // The receipt job's in-flight window (review C3): shouldPrintReceipt clears
  // at DISPATCH (the effect below), not at completion — without tracking the
  // gap to onAfterPrint, the auto-print queue could see "not busy", call
  // queueKotRound(dinerOrder), and swap lastOrder while the customer receipt
  // was still snapshotting/printing in the ONE shared iframe: a wrong-customer
  // receipt, or a killed job. State (not a ref) so `printBusy` below is
  // reactive — consumers re-render when the window closes.
  const [receiptInFlight, setReceiptInFlight] = useState(false);

  const receiptRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: lastOrder?.orderId ?? "receipt",
    // KOT-only callers never flip shouldPrintReceipt, so print() below is
    // never invoked for them — the kotPaperWidth filler here is inert, never
    // a second paper size actually reaching a printer.
    pageStyle: receiptPageStyle(receipt?.billPaperWidth ?? kotPaperWidth),
    onAfterPrint: () => setReceiptInFlight(false),
  });

  // kotPrinting keeps this effect from re-firing while a job is in flight, and
  // the receipt effect below waits for shouldPrintKot to clear. Both exist
  // because react-to-print reuses ONE iframe — see the print-chain note in
  // lib/print.ts for why two jobs in a single tick silently kill one of them
  // (CR1.2).
  const kotPrinting = useRef(false);
  const kotRef = useRef<HTMLDivElement>(null);
  const printKot = useReactToPrint({
    contentRef: kotRef,
    documentTitle: lastOrder ? `KOT-${lastOrder.orderId}` : "kot",
    pageStyle: receiptPageStyle(kotPaperWidth),
    onAfterPrint: () => {
      kotPrinting.current = false;
      clearPrintKot();
    },
  });

  // Kitchen ticket first, one print job at a time: the receipt effect below
  // waits for shouldPrintKot to clear before it fires.
  useEffect(() => {
    if (shouldPrintReceipt && lastOrder && !shouldPrintKot) {
      setReceiptInFlight(true);
      print();
      clearPrintReceipt?.();
    }
  }, [shouldPrintReceipt, lastOrder, shouldPrintKot, clearPrintReceipt, print]);

  useEffect(() => {
    if (shouldPrintKot && lastOrder && !kotPrinting.current) {
      kotPrinting.current = true;
      printKot();
    }
  }, [shouldPrintKot, lastOrder, printKot]);

  // TRUE whenever any print job is queued or physically in flight — the gate
  // the auto-print queue must respect before it may touch lastOrder (C3).
  // shouldPrintKot covers the KOT end to end (onAfterPrint clears it);
  // shouldPrintReceipt covers queued-not-yet-dispatched; receiptInFlight
  // covers dispatch → onAfterPrint. All three are state, so a consumer's
  // render always sees the current window.
  const printBusy = shouldPrintKot || shouldPrintReceipt || receiptInFlight;

  return { receiptRef, kotRef, printBusy };
}
