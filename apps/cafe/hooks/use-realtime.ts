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
import { subscribeRealtime, subscribeRealtimeDown } from "@/lib/realtime-client";
import { onePageAtMost } from "@/lib/order-query";
import { createRealtimeInvalidator, type RealtimeInvalidateSpec } from "@/lib/realtime-invalidate";
import { markTablesFreshRead } from "@/lib/tables-fresh-read";

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
// refetchInterval. The safety-net polls (the live lists, tables, dashboard,
// day summary, Kitchen and token boards) step back to 120 s ONLY while the
// room is PROVEN up — isRealtimeHealthy(), re-read on every tick
// (lib/live-poll.ts; the owner's D3) — and are today's 30 s / 10 s the moment
// it is not, with ONE catch-up round on the drop (useRealtimeCatchUp). The
// print host's relaxes 3s → 60s on the same proof (use-print-host-wake.ts);
// the pulse never changes. Flag off or Worker down ⇒ exactly today's shipped
// behaviour; a half-open socket reads healthy until its next missed pong
// (≤ REALTIME_HEALTH_TTL_MS), the print host's known bound too.
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
// loaded (never re-fetch every loaded page on a nudge), and the tables — whose
// refetch after a visible round reads /api/tables?fresh=1, past the 5 s
// per-instance cache (F7: onRound; it replaced a second "late" tables refetch
// 6 s later). Never the day summary: it is server-cached, so a nudge cannot
// make it fresher.
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
  onRound: markTablesFreshRead,
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

/** Perf P1 F6 — the synthetic kind the room's down event feeds the catch-up
 *  invalidator. Never a room kind: no frame can reach that invalidator. */
export const REALTIME_DOWN_KIND = "lane-down";

// The catch-up (the owner's D3): while the room was up the safety-net polls
// stepped back to 120 s, so a drop may have hidden writes for up to that long.
// ONE round over everything those polls cover (the live lists, the floor, the
// one-page Orders list, the Kitchen board, the dashboard, the token board,
// today's day summary), coalesced, held and hidden-tab-gentle like a live-state
// nudge; its floor read skips the instance cache. Its refetch also re-arms each
// poll, which now reads isRealtimeHealthy() false: today's 30 s / 10 s at once
// (the summary is server-cached, so its refetch may bring the cached figure,
// but its poll is back on 30 s now, not one more 120 s tick later). Never a past
// day's summary (it never polls) or the pulse (its own 20 s, never nudged).
export const CATCH_UP_REALTIME: RealtimeInvalidateSpec = {
  targets: [
    ...LIVE_STATE_REALTIME.targets,
    { queryKey: KITCHEN_KEYS.all },
    { queryKey: DASHBOARD_KEYS.all },
    { queryKey: TOKEN_KEYS.all },
    { queryKey: ORDER_KEYS.summary() },
  ],
  coalesceMs: REALTIME_NUDGE_COALESCE_MS,
  holdWhileMutating: ORDER_KEYS.mutation,
  staleOnlyWhenHidden: true,
  onRound: markTablesFreshRead,
};

/** One catch-up round per drop of the room (lib/realtime-client.ts
 *  subscribeRealtimeDown). Mounted once, in PosPulseProvider, next to
 *  useLiveStateRealtime; inert with realtime off (the room never goes up). */
export function useRealtimeCatchUp(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const invalidator = createRealtimeInvalidator(qc, [REALTIME_DOWN_KIND], CATCH_UP_REALTIME);
    const unsubscribe = subscribeRealtimeDown(() => invalidator.onKind(REALTIME_DOWN_KIND));
    return () => {
      unsubscribe();
      invalidator.dispose();
    };
  }, [qc]);
}
