"use client";

import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";
import { PRINT_WAKE_KEYS } from "@/hooks/use-print-host-wake";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { DASHBOARD_KEYS } from "@/hooks/use-dashboard";
import { TOKEN_KEYS } from "@/hooks/use-tokens";
import { subscribeRealtime } from "@/lib/realtime-client";
import { onePageAtMost } from "@/lib/order-query";
import { createRealtimeInvalidator, type RealtimeInvalidateSpec } from "@/lib/realtime-invalidate";

// ─────────────────────────────────────────────────────────────────────────────
// Realtime nudges — the per-surface subscriptions.
//
// The CONNECTION lives in lib/realtime-client.ts (one per device, refcounted,
// health-checked). These hooks only say WHICH message kinds refresh WHICH
// queries, and how (lib/realtime-invalidate.ts). Several surfaces can
// therefore be mounted at once on the same device and still share exactly one
// socket.
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
export const KITCHEN_EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed"] as const;

/** Print customization S8 — kinds that change the token board (POS token sheet; S9's Now Serving screen). A SUBSET
 *  of CAFE_EVENT_KINDS (pinned), so no Worker redeploy: a fired round (a QR accept, or a new round sending a Ready
 *  held tab back to Preparing), a Ready / Collected mark, or any tab change (settle, cancel). */
export const NOW_SERVING_EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed"] as const;

/** Kinds that mean a print job may be waiting. */
export const PRINT_EVENT_KINDS = ["print-job"] as const;

/** Kinds the staff-attention pulse cares about. A QR self-order only: every
 *  pulse refetch makes the print host send a beat (use-print-host-beat.ts), so
 *  an order nudge must never refetch the pulse. */
export const PULSE_EVENT_KINDS = ["self-order"] as const;

/** Kinds that change the open tabs, the order lists or today's tables. A fired
 *  round changes a tab's total, and accepting a QR request can seat a tab. */
export const LIVE_STATE_EVENT_KINDS = ["kot-fired", "order-changed"] as const;

/** The live-state window: a burst of nudges inside it is ONE refetch round. */
export const REALTIME_NUDGE_COALESCE_MS = 1000;

/** GET /api/tables is served from a per-instance cache (TTL.TABLES, 5 s), so a
 *  nudge-driven tables refetch can land on a warm instance still holding the
 *  old floor. One more tables refetch this long after a visible round reads
 *  past that cache. MUST stay > TTL.TABLES * 1000 (pinned in the tests). */
export const TABLES_LATE_REFETCH_MS = 6000;

// One immediate invalidate of the surface's own key per frame — unchanged. The
// Kitchen board's is held while a tick or a Ready is in flight (KITCHEN_KEYS.all
// prefixes both of their mutationKeys): a refetch then would bounce the
// optimistic row. The held frame flushes once the write settles.
export const KITCHEN_REALTIME: RealtimeInvalidateSpec = {
  targets: [{ queryKey: KITCHEN_KEYS.all }],
  holdWhileMutating: KITCHEN_KEYS.all,
};
// The token board's own key, held while a token mark is in flight (TOKEN_KEYS.action sits under TOKEN_KEYS.all) —
// the Kitchen board's rule, for the same reason.
export const TOKEN_REALTIME: RealtimeInvalidateSpec = {
  targets: [{ queryKey: TOKEN_KEYS.all }],
  holdWhileMutating: TOKEN_KEYS.all,
};
export const PRINT_REALTIME: RealtimeInvalidateSpec = { targets: [{ queryKey: PRINT_WAKE_KEYS.all }] };
export const PULSE_REALTIME: RealtimeInvalidateSpec = { targets: [{ queryKey: POS_PULSE_KEYS.all }] };

// Every order list, the Orders page's infinite list only while one page is
// loaded (never re-fetch every loaded page on a nudge), and the tables — plus
// one late tables refetch past the per-instance cache. Never the day summary:
// it is server-cached, so a nudge cannot make it fresher.
export const LIVE_STATE_REALTIME: RealtimeInvalidateSpec = {
  targets: [
    { queryKey: ORDER_KEYS.lists },
    { queryKey: TABLE_KEYS.all },
    {
      queryKey: ORDER_KEYS.infinite,
      predicate: (query) => onePageAtMost(query.state.data as InfiniteData<unknown> | undefined),
    },
  ],
  coalesceMs: REALTIME_NUDGE_COALESCE_MS,
  holdWhileMutating: ORDER_KEYS.mutation,
  staleOnlyWhenHidden: true,
  lateRefetch: { queryKey: TABLE_KEYS.all, afterMs: TABLES_LATE_REFETCH_MS },
};

function useRealtimeInvalidate(kinds: readonly string[], spec: RealtimeInvalidateSpec): void {
  const qc = useQueryClient();
  useEffect(() => {
    // subscribeRealtime is a no-op when NEXT_PUBLIC_REALTIME_URL is unset —
    // no socket is opened and this hook costs nothing.
    const invalidator = createRealtimeInvalidator(qc, kinds, spec);
    const unsubscribe = subscribeRealtime(invalidator.onKind);
    return () => {
      unsubscribe();
      invalidator.dispose();
    };
    // `kinds` and `spec` are module-level constants; qc is stable for the
    // life of the provider. One subscription per mount.
  }, [qc, kinds, spec]);
}

/** Kitchen board — a fired round, a tick, or any tab change refreshes it. */
export function useKitchenRealtime(): void {
  useRealtimeInvalidate(KITCHEN_EVENT_KINDS, KITCHEN_REALTIME);
}

/** Token board (S8) — mounted only while a board is on screen (the POS token sheet's open body). */
export function useTokenRealtime(): void {
  useRealtimeInvalidate(NOW_SERVING_EVENT_KINDS, TOKEN_REALTIME);
}

/**
 * Print host — a queued job refreshes the wake query immediately, which is
 * what earns the relaxed 60s poll in use-print-host-wake.ts. Mount this on the
 * draining host only; it is inert on every other tab.
 */
export function usePrintRealtime(): void {
  useRealtimeInvalidate(PRINT_EVENT_KINDS, PRINT_REALTIME);
}

/** Staff-attention pulse — a QR self-order refreshes it. Mounted once, in
 *  PosPulseProvider. */
export function usePosPulseRealtime(): void {
  useRealtimeInvalidate(PULSE_EVENT_KINDS, PULSE_REALTIME);
}

/** Open tabs, order lists and tables on every device. Mounted once, in
 *  PosPulseProvider (every staff screen, never /m or /login). */
export function useLiveStateRealtime(): void {
  useRealtimeInvalidate(LIVE_STATE_EVENT_KINDS, LIVE_STATE_REALTIME);
}

/** Kinds that change the Dashboard's "Needs attention" strip: a fired round or
 *  any tab change (open tabs), and a QR self-order (orders waiting). */
export const DASHBOARD_EVENT_KINDS = [...LIVE_STATE_EVENT_KINDS, ...PULSE_EVENT_KINDS] as const;

// The Dashboard's live strip ONLY — its own spec, so the shared live-state and
// pulse specs keep their pinned targets (a pulse refetch makes the print host
// send a beat; it must never ride an order nudge). Coalesced like the live
// lists: a burst of nudges is one refetch of one small uncached count.
export const DASHBOARD_REALTIME: RealtimeInvalidateSpec = {
  targets: [{ queryKey: DASHBOARD_KEYS.live }],
  coalesceMs: REALTIME_NUDGE_COALESCE_MS,
  holdWhileMutating: ORDER_KEYS.mutation,
  staleOnlyWhenHidden: true,
};

/** Dashboard page only — refreshes the "Needs attention" strip on a nudge. */
export function useDashboardRealtime(): void {
  useRealtimeInvalidate(DASHBOARD_EVENT_KINDS, DASHBOARD_REALTIME);
}
