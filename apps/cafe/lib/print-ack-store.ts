import { PRINT_ACK_PENDING_MAX_MS } from "@pos/shared/print-lifecycle";
import { ApiError } from "@/lib/api-client";
import type { PendingPrintAck } from "@/lib/print-agent";

// Printing redesign, Phase 1 (spec §7.9): the agent's pending-ack store, split out of print-agent.ts at
// the 1C review gate to keep that file near its ~300-line budget. An ack the server has not answered
// (a "printed" one, or since the gate a failed one, M4) is kept here and re-sent every 5 s for 10
// minutes, also after a reload. Client-only; never throws.

const PENDING_ACK_KEY = "pos.print-ack-pending.v1";

function isPendingAck(v: unknown): v is PendingPrintAck {
  const o = v as Partial<PendingPrintAck> | null;
  return typeof o === "object" && o !== null && typeof o.id === "string" && Number.isInteger(o.epoch) && Number.isFinite(o.at);
}

// A storage that refuses a write (full, blocked): this page keeps the list itself until a write lands,
// so the ack is still sent and retried; only its retry after a reload is lost (M5).
let unstored: PendingPrintAck[] | null = null;

export function readPendingAcks(): PendingPrintAck[] {
  if (unstored !== null) return [...unstored];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_ACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingAck) : [];
  } catch {
    return [];
  }
}

export function writePendingAcks(entries: PendingPrintAck[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_ACK_KEY);
    else window.localStorage.setItem(PENDING_ACK_KEY, JSON.stringify(entries));
    unstored = null;
  } catch {
    unstored = [...entries];
  }
}

/** A server answer clears a pending ack; no answer (network, timeout), a 5xx, or a refusal that says
 *  nothing about the job (signed out, forbidden, timed out, too many requests: the 1D gate N-8) retries. Printing
 *  Phase 5 (spec 5.10): so does a 402 (the host over its allowance, not our server). */
export function ackAnswered(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.kind !== "http" || error.status === null) return false;
  return error.status < 500 && ![401, 402, 403, 408, 429].includes(error.status);
}

/** Printing Phase 5 (spec 5.10): a kept ack waits at most this long since it was first kept, online or not (the
 *  waiting slips' retention: its job is gone after that anyway). */
export const ACK_KEPT_MAX_MS = 3 * 60 * 60 * 1000;

/** Past its 10 minutes of online time (`at` moves on by the time spent offline), or past 3 h since it was kept. */
export function ackExpired(entry: PendingPrintAck, now: number): boolean {
  return now - entry.at > PRINT_ACK_PENDING_MAX_MS || now - (entry.first ?? entry.at) > ACK_KEPT_MAX_MS;
}

/** The time spent offline is not counted: each kept ack's window moves on by it (its first time kept stays). */
export function shiftPendingAcks(entries: readonly PendingPrintAck[], offlineMs: number): PendingPrintAck[] {
  return entries.map((entry) => ({ ...entry, first: entry.first ?? entry.at, at: entry.at + offlineMs }));
}
