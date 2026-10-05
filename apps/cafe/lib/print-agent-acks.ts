import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import type { PrintAckData } from "@pos/shared/print-agent-wire";
import { ackAnswered } from "@/lib/print-ack-store";
import type { PendingPrintAck, PrintAgentDeps } from "@/lib/print-agent-types";

// Printing redesign, Phase 1 Session 1C (spec §7.9): the agent's acks. A "printed" ack is kept in localStorage BEFORE
// it is sent, so a reload mid-ack still reports the paper; one with no answer is re-sent every 5 s for 10 min and
// cleared on ANY answer from the server (1A review M3). Split out of print-agent.ts at the 2E review gate (M-5: that
// file had passed its ~300-line budget); the agent's rules did not change.

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

/** A bounded insert: the oldest key goes once the store holds as many as the pending-ack store. */
export function rememberBounded<T>(store: Set<string> | Map<string, T>, key: string, value?: T): void {
  if (store instanceof Map) store.set(key, value as T);
  else store.add(key);
  if (store.size > PRINT_ACK_PENDING_LIMIT) store.delete(store.keys().next().value as string);
}

export interface AckFlusher {
  /** Kept before it is sent (a reload mid-ack still reports it); the newest entry per job wins. */
  keep(entry: PendingPrintAck): void;
  /** Sends every kept ack, one flush at a time; the next waits for the one on the wire. */
  flush(): Promise<void>;
  /** A kept ack with no answer is sent again in PRINT_ACK_RETRY_MS. */
  retryLater(): void;
  stop(): void;
}

type AckDeps = Pick<PrintAgentDeps, "deviceId" | "ack" | "readPending" | "writePending" | "now" | "setTimer" | "clearTimer">;

export function createAckFlusher(
  deps: AckDeps,
  hooks: {
    stopped(): boolean;
    /** Each ack's answer, by `${id}:${epoch}` (the agent reads its `more`). */
    answered(key: string, answer: PrintAckData): void;
    /** A refusal sent again and applied put its job back in line: lease it when its backoff ends (the 2B gate, M-B). */
    requeued(atMs: number): void;
  },
): AckFlusher {
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;

  function keep(entry: PendingPrintAck): void {
    deps.writePending([...deps.readPending().filter((e) => e.id !== entry.id), entry].slice(-PRINT_ACK_PENDING_LIMIT));
  }

  function forget(entry: PendingPrintAck): void {
    deps.writePending(deps.readPending().filter((e) => !(e.id === entry.id && e.epoch === entry.epoch)));
  }

  function retryLater(): void {
    if (hooks.stopped() || ackTimer !== null || deps.readPending().length === 0) return;
    ackTimer = deps.setTimer(() => {
      ackTimer = null;
      void flush();
    }, PRINT_ACK_RETRY_MS);
  }

  async function sendPending(): Promise<void> {
    // Re-read after each send, so an ack kept while this flush was on the wire goes out with it too.
    const tried = new Set<string>();
    for (;;) {
      const entry = deps.readPending().find((e) => !tried.has(`${e.id}:${e.epoch}`));
      if (entry === undefined) return;
      tried.add(`${entry.id}:${entry.epoch}`);
      if (deps.now() - entry.at > PRINT_ACK_PENDING_MAX_MS) {
        forget(entry);
        continue;
      }
      try {
        const answer = await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        hooks.answered(`${entry.id}:${entry.epoch}`, answer);
        forget(entry);
        if (entry.fail !== undefined && answer.nextAttemptAt !== null) hooks.requeued(Date.parse(answer.nextAttemptAt));
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
    }
  }

  function flush(): Promise<void> {
    // One flush at a time. The reset is chained AFTER the assignment: with nothing pending, an async
    // body would finish before `flushing` was even set, and every later flush would return that stale,
    // resolved promise without sending its ack.
    if (flushing === null) {
      flushing = sendPending().finally(() => {
        flushing = null;
        retryLater();
      });
    }
    return flushing;
  }

  return {
    keep,
    flush,
    retryLater,
    stop() {
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      ackTimer = null;
    },
  };
}
