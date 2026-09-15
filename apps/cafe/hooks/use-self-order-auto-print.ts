"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { autoPrintCandidate } from "@pos/shared/self-order-alert";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import type { Order } from "@/types";

// POST /api/order-requests/[id]/kot-claim's own envelope (server contract,
// CR2.3 §20) — claimed:false is a NORMAL lost race (another device/tick got
// there first, or the row aged out / was cancelled), never an error.
type KotClaimResult =
  | { claimed: false; reason: "no-order" | "raced" | "not-eligible" }
  | { claimed: true; order: Order; kotRound: number };

type ClaimSource = "auto" | "manual";

/** PH-5 (§B5/§B6) — present ONLY on the print host's layout-level lane. The
 *  host prints every accepted self-order (no per-device opt-in read), shares
 *  the provider's cross-lane claim lock with the print-job drain (MERGED-05),
 *  and drains up to `PRINT_HOST_MAX_AGE_MS` instead of the local 10 min. Page
 *  lanes (pos/requests) pass nothing and behave byte-identically to before. */
export interface SelfOrderHostLane {
  claimLock: MutableRefObject<boolean>;
  maxAgeMs: number;
}

interface UseSelfOrderAutoPrintOptions {
  enabled: boolean;
  busy: boolean;
  queueKotRound: (order: Order, round?: number) => void;
  hostLane?: SelfOrderHostLane;
}

// CR2.3 §20's D9 auto-print. Registers ONE claim→print bridge with
// PosPulseProvider — every Print button in RequestAlertBar AND this hook's
// own auto-print effect below call the exact same function, never two forked
// claim paths — and, when the device has opted in, walks the pulse's
// self-order queue for at most one claim per tick.
export function useSelfOrderAutoPrint({
  enabled,
  busy,
  queueKotRound,
  hostLane,
}: UseSelfOrderAutoPrintOptions): void {
  const { pulse, registerKotPrintHandler } = usePosPulseContext();
  // Stable across renders (a useRef object from the provider, or undefined on
  // a page lane), so the two effects below can hold it without re-running.
  const claimLock = hostLane?.claimLock;
  const maxAgeMs = hostLane?.maxAgeMs;
  const isHostLane = hostLane !== undefined;
  // Guards the auto-print effect against re-entry: a claim mutation in
  // flight must not let a LATER tick's effect fire a second claim before the
  // first one settles.
  const claimingRef = useRef(false);
  // Requests this device already attempted (review C2): the pulse payload
  // stays stale for up to one tick after a successful claim, and `busy`
  // flipping back re-runs the effect — without this set the SAME candidate
  // would be re-claimed, spamming the endpoint and toasting a false
  // "printed on another device" about a ticket THIS device printed.
  const attemptedRef = useRef<Set<string>>(new Set());

  const claim = useMutation({
    mutationFn: (requestId: string) =>
      apiSend<KotClaimResult>(`/api/order-requests/${requestId}/kot-claim`, "POST"),
  });
  // useMutation returns a NEW result object every render ({...result, mutate})
  // while `mutate` itself is useCallback-stable — depending on `claim` here
  // rebuilt claimAndPrint each render, re-ran the register effect, changed the
  // provider's context state, re-rendered this page, and looped React into
  // "maximum update depth exceeded" (review C1). Depend ONLY on the stable
  // pieces.
  const { mutate: claimMutate } = claim;

  const claimAndPrint = useCallback(
    (requestId: string, source: ClaimSource, onSettled?: () => void) => {
      claimMutate(requestId, {
        onSuccess: (result) => {
          if (result.claimed) {
            queueKotRound(result.order, result.kotRound);
            return;
          }
          if (source === "manual") {
            // Staff tapped a button — say what happened, never an error tone:
            // both outcomes mean the ticket needs nothing from them.
            toast.info(
              result.reason === "raced"
                ? "Already printed."
                : "Nothing left to print for this order.",
            );
          }
          // Auto path stays silent on claimed:false — a lost race or a
          // since-cancelled order is routine, not something to announce
          // every 20s tick (review C2).
        },
        onError: () => {
          if (source === "manual") {
            toast.error("Could not reach the print queue — try again.");
          } else {
            // A network failure means the server may never have seen the
            // claim — clear the attempt so the next tick retries instead of
            // stranding the ticket unprinted forever.
            attemptedRef.current.delete(requestId);
          }
        },
        onSettled,
      });
    },
    [claimMutate, queueKotRound],
  );

  // The registered handler never carries the auto path's bookkeeping —
  // RequestAlertBar's Print buttons only ever need (requestId) => void.
  // Gated on `enabled` (PH-5, §B6): the layout-level host lane and a page's
  // lane now coexist, and only an ENABLED lane may hold a registration.
  // The cross-lane lock (fresh-eyes F14) wraps the manual path too — acquired
  // before the mutate, released in its onSettled — so a band tap can never
  // land in the same tick as the print-job drain's claim. It lives at the two
  // call sites rather than inside claimAndPrint so that callback's deps stay
  // the pinned stable pair.
  useEffect(() => {
    if (!enabled) return;
    return registerKotPrintHandler((requestId) => {
      if (claimLock) claimLock.current = true;
      claimAndPrint(requestId, "manual", () => {
        if (claimLock) claimLock.current = false;
      });
    });
  }, [enabled, registerKotPrintHandler, claimAndPrint, claimLock]);

  // Auto-print: at most ONE claim per pulse tick, and never the same request
  // twice from this device (attemptedRef). A burned claim (claimed:false) is
  // never retried — recovery is the existing KOT reprint from /requests/
  // Orders, not this effect looping on it.
  useEffect(() => {
    if (!enabled || busy || !pulse) return;
    // A page lane prints only where staff opted this device in AND this device
    // is not the print host: on the host the layout-level host lane already
    // prints every accepted self-order (that is what a host is for, §B6), so a
    // pre-designation `autoPrintSelfOrders:true` must not let the host's own
    // /pos or /requests page lane race it on /kot-claim every tick (A-13's
    // disabled toggle could never clear an already-stored ON; closed at the
    // PH-11 gate). The host lane reads no pref at all.
    if (!isHostLane) {
      const prefs = readDevicePrefs();
      if (!prefs.autoPrintSelfOrders || prefs.printHost) return;
    }
    if (claimingRef.current) return;
    if (claimLock?.current) return;

    // Prune attempts whose rows have left the payload — a printed/expired row
    // can never return (the pulse serves unprinted-only), so the set stays a
    // handful of ids even on a tab that lives all day.
    const liveIds = new Set(pulse.selfOrders.map((row) => row.requestId));
    for (const id of attemptedRef.current) {
      if (!liveIds.has(id)) attemptedRef.current.delete(id);
    }

    // `undefined` maxAgeMs takes autoPrintCandidate's own 10 min default — the
    // page lanes' unchanged window; the host passes PRINT_HOST_MAX_AGE_MS.
    const candidate = autoPrintCandidate(
      pulse.selfOrders.filter((row) => !attemptedRef.current.has(row.requestId)),
      Date.now(),
      maxAgeMs,
    );
    if (!candidate) return;

    claimingRef.current = true;
    if (claimLock) claimLock.current = true;
    attemptedRef.current.add(candidate.requestId);
    claimAndPrint(candidate.requestId, "auto", () => {
      claimingRef.current = false;
      if (claimLock) claimLock.current = false;
    });
  }, [enabled, busy, pulse, claimAndPrint, isHostLane, claimLock, maxAgeMs]);
}
