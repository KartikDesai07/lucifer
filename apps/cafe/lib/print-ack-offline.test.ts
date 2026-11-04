// Kept acks while offline (Printing Phase 5, spec 5.10, the review's I6; plan Task 15): a slip printed just before an
// outage is not printed again as REPRINT when the server is back. The 10-minute window counts only time online (at
// most 3 h, the waiting slips' retention), an ack Vercel's 402 refused is kept, and while offline nothing is sent and
// no 5 s timer runs: the kept acks go with the first flush once online (the agent flushes before it leases).

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { PRINT_ACK_PENDING_MAX_MS } from "@pos/shared/print-lifecycle";
import { ACK_KEPT_MAX_MS, ackAnswered, ackExpired } from "@/lib/print-ack-store";
import { createAckFlusher } from "@/lib/print-agent-acks";
import type { PendingPrintAck } from "@/lib/print-agent-types";

test("a 402 (the host's allowance, not our server) keeps the ack; our own answers still clear it", () => {
  assert.equal(ackAnswered(new ApiError("Payment required", "http", 402)), false, "kept");
  assert.equal(ackAnswered(new ApiError("Not found", "http", 404, true)), true, "our answer clears it");
});

test("the window: 10 minutes of online time, never more than 3 hours since it printed", () => {
  const now = 10_000_000;
  assert.equal(ackExpired({ id: "a", epoch: 1, at: now - PRINT_ACK_PENDING_MAX_MS + 1 }, now), false, "inside 10 minutes");
  assert.equal(ackExpired({ id: "a", epoch: 1, at: now - PRINT_ACK_PENDING_MAX_MS - 1 }, now), true, "past 10 minutes");
  assert.equal(ackExpired({ id: "a", epoch: 1, at: now - 1000, first: now - ACK_KEPT_MAX_MS - 1 }, now), true, "past 3 hours, however long it was offline");
  assert.equal(ACK_KEPT_MAX_MS, 3 * 60 * 60 * 1000, "3 h");
});

function harness() {
  let pending: PendingPrintAck[] = [{ id: "job1", epoch: 2, at: 1_000 }];
  let clock = 1_000;
  let offline = false;
  const sent: string[] = [];
  const timers: number[] = [];
  const flusher = createAckFlusher(
    {
      deviceId: "dev",
      ack: async (id) => {
        if (offline) throw new ApiError("Could not reach the server.", "network", null);
        sent.push(id);
        return { more: false, nextAttemptAt: null } as never;
      },
      readPending: () => pending,
      writePending: (entries) => {
        pending = entries;
      },
      now: () => clock,
      setTimer: (_fn, ms) => {
        timers.push(ms);
        return timers.length;
      },
      clearTimer: () => undefined,
      offline: () => offline,
    },
    { stopped: () => false, answered: () => undefined, requeued: () => undefined },
  );
  return { flusher, sent, timers, pending: () => pending, setClock: (ms: number) => (clock = ms), setOffline: (on: boolean) => (offline = on) };
}

test("offline: nothing is sent and no 5 s timer runs; online again, the time offline is not counted and the ack goes", async () => {
  const h = harness();
  h.setOffline(true);
  await h.flusher.flush();
  assert.deepEqual(h.sent, [], "nothing sent while offline");
  assert.deepEqual(h.timers, [], "no retry timer while offline");
  h.setClock(1_000 + 2 * 60 * 60 * 1000); // two hours offline
  h.setOffline(false);
  await h.flusher.flush();
  assert.deepEqual(h.sent, ["job1"], "sent once online: the 10 minutes counted only time online");
  assert.equal(h.pending().length, 0, "answered");
});

test("online as today: a kept ack with no answer is sent again in 5 s", async () => {
  const h = harness();
  let fail = true;
  const flusher = createAckFlusher(
    {
      deviceId: "dev",
      ack: async (id) => {
        if (fail) throw new ApiError("x", "network", null);
        return { id } as never;
      },
      readPending: () => [{ id: "job1", epoch: 2, at: 1_000 }],
      writePending: () => undefined,
      now: () => 1_000,
      setTimer: (_fn, ms) => {
        h.timers.push(ms);
        return 1;
      },
      clearTimer: () => undefined,
      offline: () => false,
    },
    { stopped: () => false, answered: () => undefined, requeued: () => undefined },
  );
  await flusher.flush();
  assert.deepEqual(h.timers, [5_000], "the 5 s retry");
  fail = false;
});

test("fix wave m: an ack first kept after the page went offline does not count the outage either", async () => {
  const h = harness();
  h.setOffline(true);
  h.flusher.retryLater(); // the agent keeps an ack, its flush fails, it asks for a retry: offline
  h.setClock(1_000 + 2 * 60 * 60 * 1000);
  h.setOffline(false);
  await h.flusher.flush();
  assert.deepEqual(h.sent, ["job1"], "sent: the outage was not counted");
});
