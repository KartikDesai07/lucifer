"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";

// ─────────────────────────────────────────────────────────────────────────────
// Realtime nudges (socket slice 1) — ONE connection per device.
//
// A SUPPLEMENT TO THE POLL, NEVER A REPLACEMENT. Every surface that calls this
// keeps its own `refetchInterval` exactly as shipped (the Kitchen board's stays
// REFETCH_INTERVALS.KITCHEN = 10s). All this hook ever does is invalidate a
// query EARLY when the server says something changed. Consequently:
//   * NEXT_PUBLIC_REALTIME_URL unset  => this hook is inert. The DEFAULT.
//   * the Worker down / unreachable   => the socket never opens, poll unchanged.
//   * the connection drops mid-shift  => reconnect below; poll covers the gap.
// In every one of those cases the screen behaves exactly as it does today.
//
// The URL is NEXT_PUBLIC_ on purpose and carries NO secret: /join is a public
// read-only subscribe, and the publish side (which IS HMAC-authenticated) is
// server-only in lib/realtime-publish.ts. A message carries a KIND and nothing
// else — the device refetches its own authenticated query, so nothing sensitive
// ever crosses the socket.
//
// ONE CONNECTION PER DEVICE: this hook must be called from exactly ONE mounted
// place per surface (the Kitchen page for slice 1), the same discipline
// usePosPulse documents — a second caller would open a SECOND socket to the
// same room and double every invalidation.
// ─────────────────────────────────────────────────────────────────────────────

/** Message kinds → the query keys each one refreshes. MIRRORS
 *  CAFE_EVENT_KINDS in lib/realtime-publish.ts and EVENT_KINDS in
 *  workers/realtime/src/index.ts; realtime-publish.test.ts pins all three. */
const KITCHEN_EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed"] as const;

/** Reconnect backoff. A wall display runs unattended all shift, so it must
 *  recover on its own — but it must never hammer a Worker that is down, since
 *  the poll is already covering the gap at full fidelity. */
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

/**
 * Subscribe the Kitchen board to its cafe's room. Returns nothing: the only
 * effect is an EARLY `invalidateQueries(KITCHEN_KEYS.all)` when a relevant
 * write lands. Safe to leave mounted for a whole shift.
 */
export function useKitchenRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_REALTIME_URL;
    // Unset => the flag is off for this cafe. The board polls, as shipped.
    if (!base) return;

    let socket: WebSocket | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // Set by the cleanup below so a close that WE caused never schedules a
    // reconnect against an unmounted component.
    let closed = false;

    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(base);
      } catch {
        // A malformed URL must not throw out of an effect and break the page.
        // The board keeps polling; do not retry a URL that cannot parse.
        return;
      }
      socket = ws;

      ws.addEventListener("open", () => {
        retry = 0; // a real connection resets the backoff
      });

      ws.addEventListener("message", (event) => {
        // Defensive on every field: this is network input. Anything
        // unrecognised is ignored rather than thrown — a bad frame must never
        // break a wall display that a cook is working off.
        try {
          const data: unknown = JSON.parse(String(event.data));
          if (typeof data !== "object" || data === null) return;
          const kind = (data as { kind?: unknown }).kind;
          if (typeof kind !== "string") return;
          if (!(KITCHEN_EVENT_KINDS as readonly string[]).includes(kind)) return;
          // The nudge itself: refetch EARLY. This is the same invalidation the
          // 10s poll would have done on its own a few seconds later.
          void qc.invalidateQueries({ queryKey: KITCHEN_KEYS.all });
        } catch {
          // Unparseable frame — ignore it.
        }
      });

      const scheduleReconnect = () => {
        if (closed) return;
        // Exponential backoff, capped. The poll covers the whole gap, so a
        // slow reconnect costs nothing but a few seconds of extra latency.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** retry, RECONNECT_MAX_MS);
        retry++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.addEventListener("close", scheduleReconnect);
      ws.addEventListener("error", () => {
        // An errored socket also fires "close" in every browser that matters;
        // closing here makes that deterministic rather than relying on it.
        try {
          ws.close();
        } catch {
          // Already closing.
        }
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
    };
    // qc is stable for the life of the provider — this effect runs once per
    // mount and holds ONE socket for as long as the surface is open.
  }, [qc]);
}
