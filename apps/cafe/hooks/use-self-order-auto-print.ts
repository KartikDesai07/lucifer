"use client";

import { useCallback, useEffect, useRef } from "react";
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

interface UseSelfOrderAutoPrintOptions {
  enabled: boolean;
  busy: boolean;
  queueKotRound: (order: Order, round?: number) => void;
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
}: UseSelfOrderAutoPrintOptions): void {
  const { pulse, registerKotPrintHandler } = usePosPulseContext();
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
  useEffect(
    () => registerKotPrintHandler((requestId) => claimAndPrint(requestId, "manual")),
    [registerKotPrintHandler, claimAndPrint],
  );

  // Auto-print: at most ONE claim per pulse tick, and never the same request
  // twice from this device (attemptedRef). A burned claim (claimed:false) is
  // never retried — recovery is the existing KOT reprint from /requests/
  // Orders, not this effect looping on it.
  useEffect(() => {
    if (!enabled || busy || !pulse) return;
    if (!readDevicePrefs().autoPrintSelfOrders) return;
    if (claimingRef.current) return;

    // Prune attempts whose rows have left the payload — a printed/expired row
    // can never return (the pulse serves unprinted-only), so the set stays a
    // handful of ids even on a tab that lives all day.
    const liveIds = new Set(pulse.selfOrders.map((row) => row.requestId));
    for (const id of attemptedRef.current) {
      if (!liveIds.has(id)) attemptedRef.current.delete(id);
    }

    const candidate = autoPrintCandidate(
      pulse.selfOrders.filter((row) => !attemptedRef.current.has(row.requestId)),
      Date.now(),
    );
    if (!candidate) return;

    claimingRef.current = true;
    attemptedRef.current.add(candidate.requestId);
    claimAndPrint(candidate.requestId, "auto", () => {
      claimingRef.current = false;
    });
  }, [enabled, busy, pulse, claimAndPrint]);
}
