"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";
import { PRINT_WAKE_KEYS } from "@/hooks/use-print-host-wake";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { subscribeRealtime } from "@/lib/realtime-client";

// ─────────────────────────────────────────────────────────────────────────────
// Realtime nudges — the per-surface subscriptions.
//
// The CONNECTION lives in lib/realtime-client.ts (one per device, refcounted,
// health-checked). These hooks only say WHICH message kinds refresh WHICH
// query. Several surfaces can therefore be mounted at once on the same device
// and still share exactly one socket.
//
// A SUPPLEMENT TO THE POLL, NEVER A REPLACEMENT. Every surface keeps its own
// refetchInterval. The Kitchen board's stays 10s unconditionally. The print
// host's relaxes 3s → 60s ONLY while the socket is PROVEN healthy, and snaps
// back the instant it is not (see use-print-host-wake.ts). Flag off, Worker
// down, or socket half-open ⇒ exactly today's shipped behaviour.
// ─────────────────────────────────────────────────────────────────────────────

/** Kinds that change the Kitchen board. MIRRORS CAFE_EVENT_KINDS in
 *  lib/realtime-publish.ts and EVENT_KINDS in workers/realtime/src/index.ts;
 *  realtime-paths.test.ts parity-pins all three. */
const KITCHEN_EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed"] as const;

/** Kinds that mean a print job may be waiting. */
const PRINT_EVENT_KINDS = ["print-job"] as const;

/** Kinds the staff-attention pulse cares about. */
const PULSE_EVENT_KINDS = ["self-order", "order-changed"] as const;

function useRealtimeInvalidate(
  kinds: readonly string[],
  queryKey: readonly unknown[],
): void {
  const qc = useQueryClient();
  useEffect(() => {
    // subscribeRealtime is a no-op when NEXT_PUBLIC_REALTIME_URL is unset —
    // no socket is opened and this hook costs nothing.
    return subscribeRealtime((kind) => {
      if (!kinds.includes(kind)) return;
      // The nudge itself: refetch EARLY. This is the same invalidation the
      // surface's own poll would have done on its own moments later.
      void qc.invalidateQueries({ queryKey });
    });
    // `kinds` and `queryKey` are module-level constants; qc is stable for the
    // life of the provider. One subscription per mount.
  }, [qc, kinds, queryKey]);
}

/** Kitchen board — a fired round, a tick, or any tab change refreshes it. */
export function useKitchenRealtime(): void {
  useRealtimeInvalidate(KITCHEN_EVENT_KINDS, KITCHEN_KEYS.all);
}

/**
 * Print host — a queued job refreshes the wake query immediately, which is
 * what earns the relaxed 60s poll in use-print-host-wake.ts. Mount this on the
 * draining host only; it is inert on every other tab.
 */
export function usePrintRealtime(): void {
  useRealtimeInvalidate(PRINT_EVENT_KINDS, PRINT_WAKE_KEYS.all);
}

/** Staff-attention pulse — a QR self-order or a tab change refreshes it. */
export function usePosPulseRealtime(): void {
  useRealtimeInvalidate(PULSE_EVENT_KINDS, POS_PULSE_KEYS.all);
}
