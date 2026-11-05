// The replay runner's rules (Printing Phase 5, spec 5.8; plan Task 13). Pure over its ports: the hook
// (hooks/use-offline-replay.ts) holds the one-tab replay lock, posts, follows the answer's jobs and says the end.
// Oldest first, one at a time, each entry under its own key with the `offline` note, so a first send that landed is
// answered as a replay (never a second order or round) and the lines printed offline are saved as printed.

import { ApiError } from "@pos/shared/api-client";
import { addNote, nextSendable, patchEntry, removeEntry, resumeSending, settleCreate } from "@/lib/offline-outbox";
import type { OutboxEntry, OutboxRecord } from "@/lib/offline-outbox-schema";
import type { OutboxStore } from "@/lib/offline-outbox-store";
import { reachOf } from "@/lib/offline-state";
import { classifyFailure, signedOut } from "@/lib/pending-writes";
import { inr } from "@/lib/utils";
import type { Order } from "@/types";

export const REPLAY_NO_ECHO_MESSAGE = "This POS's server did not take the offline note. Nothing more is sent until it is updated.";
/** Spec §6: the pulse answer does not say `offlineReplay` (an older server): the entries wait. */
export const REPLAY_WAITING_MESSAGE = "Waiting: this POS's server must be updated before these orders can be sent.";
export const replaySentMessage = (sent: number): string => `Offline orders sent: ${sent}`;

/** A server answer to a request with the field echoes it (5A); one without came from a server that dropped it. */
export type ReplayAnswer = Order & { offline?: { ref: string; takenAtKept: boolean } };

/** The request an entry is sent as: its stored body, its key, and the offline note (a sale: the total it took). */
export function offlineReplayBody(entry: OutboxEntry): Record<string, unknown> {
  return {
    ...(entry.body as Record<string, unknown>),
    idemKey: entry.key,
    offline: { ref: entry.ref, takenAt: entry.at, ...(entry.sale ? { total: entry.shownTotal } : {}), lines: entry.lines },
  };
}

/** Something the runner can send now: an entry a dead page left "sending" counts (the runner resumes it under the
 *  replay lock before it picks), so such an entry never strands the outbox (the review's C1). */
export function replaySendable(record: OutboxRecord | null): boolean {
  return record !== null && nextSendable(resumeSending(record)) !== null;
}

/** Spec 5.8: the runner sends only while online, once the last pulse says the server takes offline replays, with
 *  something to send, after a miss's pulse tick (never a tight loop), and never after an answer without the echo. */
export function replayReady(input: { offline: boolean; offlineReplay: boolean; sendable: boolean; nowMs: number; retryAfter: number; blocked: boolean }): boolean {
  return !input.offline && input.offlineReplay && input.sendable && !input.blocked && input.nowMs >= input.retryAfter;
}

export interface ReplayPorts {
  update: OutboxStore["update"];
  /** Its paper is still printing on this page (lib/offline-keep.ts): it waits. */
  printing: (key: string) => boolean;
  send: (entry: OutboxEntry) => Promise<ReplayAnswer>;
  /** The saved order (its echo stripped): follow its jobs as an online send does. */
  follow: (order: Order, entry: OutboxEntry) => void;
  now?: () => number;
}

export type ReplayStop = "done" | "miss" | "signed-out" | "no-echo" | "storage";

function notesOf(entry: OutboxEntry, order: Order, takenAtKept: boolean): { key: string; text: string }[] {
  const notes: { key: string; text: string }[] = [];
  // In paise, as the sale's own guard compares (a float residue is not a difference).
  if (Math.round(order.total * 100) !== Math.round(entry.shownTotal * 100)) notes.push({ key: entry.key, text: `${entry.ref} saved at ${inr(order.total)}; this device showed ${inr(entry.shownTotal)}` });
  // A held send's first try may have landed at its own time: no taken-time note for it (the 5A review's m2).
  if (!takenAtKept && !entry.uncertain) notes.push({ key: `${entry.key}.time`, text: `${entry.ref} was saved at the time it was sent, not the time it was taken.` });
  return notes;
}

/** A run that sent or refused anything reads the POS's lists again: a refusal is proof the server's tabs differ from
 *  this page's (a tab closed on another device meanwhile), so Fix and send then opens such a round as a new order. */
export function replayRefreshesLists(result: { sent: number; refused: number }): boolean {
  return result.sent > 0 || result.refused > 0;
}

export async function runOfflineReplay(ports: ReplayPorts): Promise<{ sent: number; refused: number; stop: ReplayStop }> {
  const now = ports.now ?? Date.now;
  // The replay lock is held: an entry still "sending" is one whose page died before its answer (5A's I2).
  await ports.update((record) => {
    const resumed = resumeSending(record);
    return resumed === record ? null : resumed;
  });
  let sent = 0;
  let refused = 0;
  for (;;) {
    let picked: OutboxEntry | null = null;
    const taken = await ports.update((record) => {
      const candidate = nextSendable(record);
      if (candidate === null || ports.printing(candidate.key)) return null;
      picked = candidate;
      return patchEntry(record, candidate.key, { state: "sending" });
    });
    const entry = picked as OutboxEntry | null;
    if (entry === null) return { sent, refused, stop: "done" };
    if (taken !== "written") return { sent, refused, stop: "storage" };
    let answer: ReplayAnswer;
    try {
      answer = await ports.send(entry);
    } catch (error) {
      // Our own refusal (a closed tab, an item no longer sold, a changed total): staff decide; the rest go on. The
      // sign-in is checked before the replay, so a 401/403 proves nothing about the entry: it waits, like a miss.
      const definite = reachOf(error) === "reached" && !signedOut(error) && classifyFailure(error) !== "uncertain";
      const message = error instanceof ApiError ? error.message : String(error);
      // No answer or a 5xx (the slips' 503 is a saved order): it may be on the server now, so it waits as uncertain and
      // its Discard never says nothing is saved (the pre-deploy review). A 401/403 and a refusal (definite) wrote nothing.
      const mayHaveLanded = classifyFailure(error) === "uncertain";
      await ports.update((record) => patchEntry(record, entry.key, definite ? { state: "needs-staff", message } : { state: "waiting", ...(mayHaveLanded ? { uncertain: true } : {}) }));
      if (definite) {
        refused += 1;
        continue;
      }
      return { sent, refused, stop: signedOut(error) ? "signed-out" : "miss" };
    }
    const { offline: echo, ...order } = answer;
    if (echo === undefined) {
      // A 200 without the echo is a saved order (a server that dropped the field): uncertain, as above.
      await ports.update((record) => patchEntry(record, entry.key, { state: "waiting", uncertain: true }));
      return { sent, refused, stop: "no-echo" };
    }
    await ports.update((record): OutboxRecord => {
      let next = removeEntry(record, entry.key);
      if (entry.kind === "create") next = settleCreate(next, entry.local, order._id);
      for (const note of notesOf(entry, order, echo.takenAtKept)) next = addNote(next, { ...note, ref: entry.ref, at: now() });
      return next;
    });
    ports.follow(order, entry);
    sent += 1;
  }
}
