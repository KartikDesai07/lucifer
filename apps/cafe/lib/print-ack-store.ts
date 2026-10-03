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
 *  nothing about the job (signed out, forbidden, timed out, too many requests: the 1D gate N-8) retries. */
export function ackAnswered(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.kind !== "http" || error.status === null) return false;
  return error.status < 500 && ![401, 403, 408, 429].includes(error.status);
}
