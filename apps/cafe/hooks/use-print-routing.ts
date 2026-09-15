"use client";

// The usePosPrint-facing half of the PH-4 routing seam. The lane verdict and
// the routed-print primitives moved to hooks/use-host-routing.ts in
// CB-1d.3b for the ~300-line invariant; this file keeps the LOCAL-queue
// wrappers and re-exports useHostRouting so the PH-6 sites (MoveTableDialog,
// OrderDetailSheet, EndOfDayButton) and any test keep importing from here.

import { useCallback } from "react";

import { billPrintJob, kotPrintJob, voidPrintJob, type PrintHostRouting } from "@/lib/print-routing";
import type { Order, OrderVoid } from "@/types";
import { useHostRouting, type PrintRoutingHost } from "@/hooks/use-host-routing";

export { useHostRouting, type PrintRoutingHost };

export interface PrintRoutingLocal {
  queueKotRound: (order: Order, round?: number) => void;
  queueVoidSlip: (order: Order, entry: OrderVoid) => void;
  reprintKot: () => void;
  queueReceipt: (order: Order) => void;
  /** Records "this is the tab a reprint would act on" WITHOUT queueing a print.
   *  Separate from the four above because the routed lane never runs them, and
   *  `lastOrder` is not a print signal: `PosHeader.tsx:57` gates the KOT
   *  reprint button on it, and `reprintKot` needs it to build a payload at all. */
  setLastOrder: (order: Order) => void;
}

// `setLastOrder` is deliberately NOT re-exported: it is an INPUT to the seam
// (the recorder the wrappers call on both lanes), not part of the routed print
// surface — `usePosPrint` already exposes its own.
export interface PrintRouting extends Omit<PrintRoutingLocal, "setLastOrder"> {
  routing: PrintHostRouting;
  hostConfigured: boolean;
  queueMovedSlip: PrintRoutingHost["queueMovedSlip"];
}

/** Wraps `usePosPrint`'s LOCAL setState queue functions so every one of them
 *  routes to the host when a host owns printing, and falls back to the local
 *  path ONLY on the one enqueue outcome that permits it, as judged by
 *  `printJobEnqueueAllowsLocalPrint` (D-11) — this file deliberately never
 *  names that outcome, so the banned-string pin over it stays meaningful
 *  (`.claude/rules/testing.md`: a raw scan reads comments too). The wrappers
 *  keep the callers' signatures, so `pos/page.tsx` and `requests/page.tsx`
 *  route with no call-site edits. */
export function usePrintRouting(args: {
  local: PrintRoutingLocal;
  lastOrder: Order | null;
}): PrintRouting {
  const { local, lastOrder } = args;
  const { routing, hostConfigured, routePrint, queueMovedSlip } = useHostRouting();
  // Pulled apart so every wrapper below depends on the individual functions and
  // never on `local` itself: that object literal is rebuilt each render while
  // its members are all useCallback-stable, and an unstable queueKotRound would
  // re-run use-self-order-auto-print's registration effect every render,
  // looping the provider's setState (memory
  // usemutation-object-identity-loops-registries).
  const {
    queueKotRound: localKot,
    queueVoidSlip: localVoid,
    reprintKot: localReprint,
    queueReceipt: localBill,
    setLastOrder: noteOrder,
  } = local;

  const queueKotRound = useCallback((order: Order, round?: number) => {
    // The MERGED-04 round discriminator is resolved HERE, outside
    // use-pos-print's pinned function body, and the SAME number goes to both
    // lanes so the enqueued job and a local fallback print identical slips.
    const resolved = round ?? order.kotRounds;
    noteOrder(order);
    routePrint(() => kotPrintJob(order, resolved), () => localKot(order, resolved));
  }, [routePrint, localKot, noteOrder]);

  const queueVoidSlip = useCallback((order: Order, entry: OrderVoid) => {
    noteOrder(order);
    routePrint(() => voidPrintJob(order, entry, { reprint: false }), () => localVoid(order, entry));
  }, [routePrint, localVoid, noteOrder]);

  const reprintKot = useCallback(() => {
    // With no lastOrder there is nothing to enqueue, so take the local path —
    // itself a no-op print — rather than inventing a payload. A fixed
    // `round: null` is the whole-tab reprint discriminator.
    if (!lastOrder) {
      localReprint();
      return;
    }
    const target = lastOrder;
    // This is the one local path carrying NO order: it just raises the print
    // flag, and the page's print source renders whatever `lastOrder` is at
    // print time. On the routed lane that verdict lands after a round trip, by
    // which time another tab may have been fired or settled (both note their
    // own order synchronously) — printing then would hand the kitchen a full
    // ticket for the WRONG tab. So re-point the recorder at the tab this
    // reprint was asked for BEFORE raising the flag: both setStates land in one
    // batch, so the bridge sees the pair at once and prints `target`.
    routePrint(() => kotPrintJob(target, null), () => {
      noteOrder(target);
      localReprint();
    });
  }, [routePrint, localReprint, noteOrder, lastOrder]);

  const queueReceipt = useCallback((order: Order) => {
    // A settle / pay-now bill is a FIRST print, never a reprint: its
    // `bill:<id>` jobKey is what makes a retry idempotent. PH-6's
    // OrderDetailSheet reprint is the `{ reprint: true }` caller.
    noteOrder(order);
    routePrint(() => billPrintJob(order, { reprint: false }), () => localBill(order));
  }, [routePrint, localBill, noteOrder]);

  return {
    routing,
    hostConfigured,
    queueMovedSlip,
    queueKotRound,
    queueVoidSlip,
    reprintKot,
    queueReceipt,
  };
}
