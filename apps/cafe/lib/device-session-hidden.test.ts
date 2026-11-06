import { test } from "node:test";
import assert from "node:assert/strict";

import { SESSION_ATTEMPT_TIMEOUT_MS, SESSION_HIDDEN_RETRY_MS, type SessionAnswer } from "@/lib/device-session";
import { flush, harness } from "@/lib/device-session.fixtures";
import { REFETCH_INTERVALS } from "@/lib/query";

// The session gate's reader while the page is hidden (lib/device-session.test.ts covers the visible page). During a
// server outage a hidden tab must not call the session function every 8 s for hours (a free-tier cost), yet it must
// never stop either: a browser print-host tab loaded hidden has to come up by itself once the server is back, or its
// print sources (inside the gate) never mount. So hidden retries slow to the calm pulse's 60 s and keep going.
const SESSION_BODY = { user: { id: "a", role: "admin" }, expires: "x" };
const NO_ANSWER: SessionAnswer = { kind: "no-answer" };

test("SESSION_HIDDEN_RETRY_MS is the calm pulse's 60 s, imported, not re-typed", () => {
  assert.equal(SESSION_HIDDEN_RETRY_MS, REFETCH_INTERVALS.POS_PULSE_CALM, "the calm cadence");
  assert.equal(SESSION_HIDDEN_RETRY_MS, 60_000, "60 s");
});

test("reader: a hidden page still makes the page load's one first attempt, and its answer counts", async () => {
  const { asked, seen } = harness({ hidden: true });
  assert.equal(asked.calls.length, 1, "the first attempt runs even hidden (a hidden print-host tab must still come up)");
  asked.calls[0]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [SESSION_BODY], "an attempt in flight finishes while hidden");
});

test("reader: hidden, the next attempt waits 60 s (not the backoff), and still comes; showing the page asks at once", async () => {
  const { clock, asked, page } = harness();
  page.hide();
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [SESSION_HIDDEN_RETRY_MS], "hidden: 60 s, not 1 s");
  clock.fire(SESSION_HIDDEN_RETRY_MS);
  assert.equal(asked.calls.length, 2, "and the attempt still comes while hidden (never stuck)");
  asked.calls[1]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [SESSION_HIDDEN_RETRY_MS], "still hidden: 60 s again");
  page.show();
  assert.equal(asked.calls.length, 3, "the page shows: an attempt at once");
  assert.deepEqual(clock.pending(), [SESSION_ATTEMPT_TIMEOUT_MS], "the 60 s wait is cancelled; only the attempt's timeout");
  asked.calls[2]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [4000], "visible again: the backoff goes on from its step (nothing reset)");
});

test("reader: a long outage while hidden makes one attempt per 60 s", async () => {
  const { clock, asked, page } = harness();
  page.hide();
  for (let minute = 1; minute <= 5; minute += 1) {
    asked.calls[minute - 1]?.answer(NO_ANSWER);
    await flush();
    assert.deepEqual(clock.pending(), [SESSION_HIDDEN_RETRY_MS], `minute ${minute}: only the 60 s wait is pending`);
    clock.fire(SESSION_HIDDEN_RETRY_MS);
  }
  assert.equal(asked.calls.length, 6, "the first attempt plus one per minute");
});

test("reader: a short wait set while visible still fires if the page hides; the next waits 60 s", async () => {
  const { clock, asked, page } = harness();
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  page.hide();
  clock.fire(1000);
  assert.equal(asked.calls.length, 2, "the due retry runs (never held)");
  asked.calls[1]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [SESSION_HIDDEN_RETRY_MS], "then the calm cadence");
});

test("reader: showing the page during a backoff wait asks at once; during an attempt in flight it starts nothing", async () => {
  const { clock, asked, page } = harness();
  page.hide();
  page.show();
  assert.equal(asked.calls.length, 1, "an attempt in flight is left to finish");
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [1000], "waiting");
  page.hide();
  page.show();
  assert.equal(asked.calls.length, 2, "the person is looking: ask now");
  assert.deepEqual(clock.pending(), [SESSION_ATTEMPT_TIMEOUT_MS], "the backoff wait is gone");
});

test("reader: the visibility listener is removed once settled and on stop()", async () => {
  const settled = harness();
  assert.equal(settled.page.listeners(), 1, "landmark: listening while there is no answer");
  settled.asked.calls[0]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.equal(settled.page.listeners(), 0, "gone after a session");
  settled.page.show();
  assert.equal(settled.asked.calls.length, 1, "and showing the page asks nothing more");
  const stopped = harness();
  stopped.reader.stop();
  assert.equal(stopped.page.listeners(), 0, "gone after stop()");
  stopped.page.show();
  assert.equal(stopped.asked.calls.length, 1, "nothing after stop()");
});
