"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Socket slice 2 — ONE realtime connection per DEVICE, shared by every surface,
// with a HEALTH verdict any surface can gate on.
//
// Slice 1 opened a socket inside the Kitchen hook. That does not survive a
// second listener: the print host needs the same room, and a second hook would
// open a SECOND socket and double every invalidation. So the connection moves
// here — a module-level singleton with refcounted subscribers. The first
// subscriber opens it, the last one closes it.
//
// WHY A HEALTH VERDICT EXISTS: the print host drops its discovery poll from 3s
// to 60s while realtime is up. That is only safe if "up" means PROVEN up, not
// "we once called new WebSocket()". A socket can be readyState OPEN and still
// be dead — a NAT/proxy can drop the connection silently and no close event
// ever fires (the classic half-open socket). So health is proved the only way
// it can be: we PING and require a PONG. No fresh pong inside the window ⇒
// `isHealthy()` is false ⇒ every gated surface falls back to its own safe
// cadence, which is exactly today's shipped behaviour.
//
// The health signal is deliberately CONSERVATIVE — it fails closed. Anything
// unknown (never connected, mid-reconnect, a missed pong, the flag off) reads
// as NOT healthy, so a gated surface polls. Being wrong in that direction costs
// requests; being wrong the other way would cost a print.
// ─────────────────────────────────────────────────────────────────────────────

/** How often the device pings the room to prove the socket still carries
 *  traffic. The owner asked for a ~3-minute check; this is that heartbeat. */
export const REALTIME_PING_INTERVAL_MS = 3 * 60 * 1000;

/** A pong must arrive within this long after a ping or the socket is declared
 *  unhealthy and torn down. Generous on purpose: a busy counter PC on cafe
 *  wifi should not be called dead over one slow round-trip. */
export const REALTIME_PONG_TIMEOUT_MS = 20 * 1000;

/** How stale the last proof-of-life may be before `isHealthy()` turns false.
 *  Must exceed the ping interval (a healthy socket only proves itself once per
 *  interval) with room for one slow round-trip, and must stay well under the
 *  point where a gated surface's own fallback would have been the better
 *  choice. Any inbound frame counts as proof, not just a pong. */
export const REALTIME_HEALTH_TTL_MS = REALTIME_PING_INTERVAL_MS + REALTIME_PONG_TIMEOUT_MS + 10_000;

/** Reconnect backoff. Unattended wall displays and counter PCs must recover on
 *  their own without hammering a Worker that is down — the polls are covering
 *  the gap at full fidelity the whole time. */
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

export type RealtimeListener = (kind: string) => void;

const listeners = new Set<RealtimeListener>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let pongTimer: ReturnType<typeof setTimeout> | undefined;
let retry = 0;
/** Unix ms of the last inbound frame of ANY kind — the proof-of-life stamp. */
let lastSeenAt = 0;

function url(): string | undefined {
  return process.env.NEXT_PUBLIC_REALTIME_URL;
}

/**
 * Is the realtime lane PROVEN up right now? Read this to decide whether a
 * surface may relax its own poll. Fails closed in every uncertain case.
 *
 * Callers must re-read it per tick (never cache the boolean): it flips to false
 * on its own the moment proof-of-life goes stale, with no event to subscribe to.
 */
export function isRealtimeHealthy(): boolean {
  if (!url()) return false;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  return Date.now() - lastSeenAt < REALTIME_HEALTH_TTL_MS;
}

function clearTimers(): void {
  if (pingTimer) clearInterval(pingTimer);
  if (pongTimer) clearTimeout(pongTimer);
  pingTimer = undefined;
  pongTimer = undefined;
}

/** Tear the socket down and schedule a reconnect. Called both on a real close
 *  and on a MISSED PONG — the half-open case a close event never reports. */
function dropAndReconnect(): void {
  clearTimers();
  const dying = socket;
  socket = null;
  // Stale immediately: a torn-down socket must never read as healthy.
  lastSeenAt = 0;
  try {
    dying?.close();
  } catch {
    // Already closed.
  }
  if (listeners.size === 0) return; // nobody is listening any more
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** retry, RECONNECT_MAX_MS);
  retry++;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, delay);
}

function connect(): void {
  const endpoint = url();
  if (!endpoint || listeners.size === 0 || socket) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(endpoint);
  } catch {
    // A malformed URL must not throw out of a React effect. Do not retry a
    // URL that cannot even be parsed; every surface just keeps polling.
    return;
  }
  socket = ws;

  ws.addEventListener("open", () => {
    retry = 0;
    lastSeenAt = Date.now(); // a completed handshake is itself proof of life
    clearTimers();
    pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send("ping");
      } catch {
        dropAndReconnect();
        return;
      }
      // Arm the answer deadline. Any inbound frame clears it (see below), so a
      // room busy with real events never trips this.
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        // No answer: the socket is open in name only. THIS is the case a
        // close event never reports, and the reason health is proved rather
        // than assumed.
        dropAndReconnect();
      }, REALTIME_PONG_TIMEOUT_MS);
    }, REALTIME_PING_INTERVAL_MS);
  });

  ws.addEventListener("message", (event) => {
    // ANY inbound frame proves the socket carries traffic, so it refreshes
    // proof-of-life and satisfies an outstanding ping.
    lastSeenAt = Date.now();
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = undefined;
    }
    let kind: string;
    try {
      const data: unknown = JSON.parse(String(event.data));
      if (typeof data !== "object" || data === null) return; // "pong" lands here
      const raw = (data as { kind?: unknown }).kind;
      if (typeof raw !== "string") return;
      kind = raw;
    } catch {
      return; // "pong" is not JSON — already counted as proof of life above
    }
    // A throwing listener must not starve the others.
    for (const listener of [...listeners]) {
      try {
        listener(kind);
      } catch {
        // Ignore — one bad subscriber cannot break the fan-out.
      }
    }
  });

  ws.addEventListener("close", () => dropAndReconnect());
  ws.addEventListener("error", () => {
    try {
      ws.close(); // makes the close path deterministic
    } catch {
      // Already closing.
    }
  });
}

/**
 * Subscribe to this cafe's room. Returns an unsubscribe function. The FIRST
 * subscriber opens the one connection; the LAST one closes it. Safe to call
 * from several surfaces — they share one socket, so a message invalidates
 * once, not once per surface.
 */
export function subscribeRealtime(listener: RealtimeListener): () => void {
  listeners.add(listener);
  if (!socket) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    // Last one out: stop everything. React StrictMode's double-mount and any
    // remount re-open it on the next subscribe.
    clearTimers();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    retry = 0;
    lastSeenAt = 0;
    const dying = socket;
    socket = null;
    try {
      dying?.close();
    } catch {
      // Already closed.
    }
  };
}
