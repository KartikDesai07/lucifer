// The offline state of one page (Printing Phase 5, spec 5.1). Pure: the hook feeds it events. "Offline" means the
// server cannot be reached, which is NOT the same as the browser's own flag: a Wi-Fi with no internet says online.

import type { ApiError } from "@pos/shared/api-client";

/** Did an answer reach OUR server? Only our own JSON envelope with a status below 500 counts: a host's error page
 *  (Vercel's 402) and our own 503 (the re-check's backoff, Phase 5B) are not proof the server is there. */
export type ServerReach = "reached" | "unreached";

export function reachOf(error: unknown): ServerReach {
  const e = error as Partial<ApiError> | null;
  return e?.kind === "http" && e.enveloped === true && typeof e.status === "number" && e.status < 500 ? "reached" : "unreached";
}

export interface OfflineState {
  offline: boolean;
  /** Pulses in a row with no answer. */
  pulseMisses: number;
  /** An order write got no answer and the immediate check has not come back yet. */
  writeMissed: boolean;
  /** The browser's own flag says offline. While it does, no answer ends offline: an answer to a request sent before the
   *  drop can land after it, and TanStack then pauses the pulse, so nothing would end that wrong "online" (5C Task 20). */
  browserOffline: boolean;
}

export const ONLINE_STATE: OfflineState = { offline: false, pulseMisses: 0, writeMissed: false, browserOffline: false };

/** One pulse miss can be a blip; two in a row are an outage. */
export const OFFLINE_PULSE_MISSES = 2;

export type OfflineEvent = { type: "browser"; online: boolean } | { type: "pulse" | "write" | "check"; reach: ServerReach };

export function nextOfflineState(state: OfflineState, event: OfflineEvent): OfflineState {
  if (event.type === "browser") {
    // Coming back online ends nothing: only an answer from our server does.
    if (event.online) return state.browserOffline ? { ...state, browserOffline: false } : state;
    return { ...state, offline: true, browserOffline: true };
  }
  // Any answer that reached us is proof the server is there: it ends offline and clears every miss counted so far,
  // unless the browser says offline now (that answer left before the drop).
  if (event.reach === "reached") return state.browserOffline ? { ...ONLINE_STATE, offline: true, browserOffline: true } : ONLINE_STATE;
  if (event.type === "pulse") {
    const pulseMisses = state.pulseMisses + 1;
    return { ...state, pulseMisses, offline: state.offline || pulseMisses >= OFFLINE_PULSE_MISSES };
  }
  if (event.type === "write") return { ...state, writeMissed: true };
  return state.writeMissed ? { ...state, offline: true } : state;
}
