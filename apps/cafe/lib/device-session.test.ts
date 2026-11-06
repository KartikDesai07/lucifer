import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_ATTEMPT_TIMEOUT_MS,
  SESSION_ENDPOINT,
  SESSION_RETRY_MS,
  askSession,
  classifySessionAnswer,
  retryDelay,
  startSessionReader,
  type SessionAnswer,
} from "@/lib/device-session";

// P2 N2: the staff frame is static, so the session is read on the device. next-auth's own client fetch turns a failed
// request into "signed out" (SessionKeepalive.tsx), which would bounce an admin off /settings or flash the staff rows;
// so the gate asks /api/auth/session itself and tells three answers apart: a session, a real sign-out, no answer.
// The gate's wiring (where SessionProvider lives, what it renders) is pinned in lib/device-session-paths.test.ts.
const SESSION_BODY = { user: { id: "a", role: "admin" }, expires: "x" };
const NO_ANSWER: SessionAnswer = { kind: "no-answer" };

// ── classifySessionAnswer ────────────────────────────────────────────────────

test("classifySessionAnswer: a 200 with a user id is a session (the same object, typed)", () => {
  const answer = classifySessionAnswer(200, SESSION_BODY);
  assert.equal(answer.kind, "session", "a 200 with user.id is a session");
  assert.equal(answer.kind === "session" ? answer.session : null, SESSION_BODY, "the body itself is the session");
});

test("classifySessionAnswer: a 200 with null or {} is a real sign-out", () => {
  assert.equal(classifySessionAnswer(200, null).kind, "signed-out", "Auth.js answers null when nobody is signed in");
  assert.equal(classifySessionAnswer(200, {}).kind, "signed-out", "an empty object is signed out too");
});

test("classifySessionAnswer: everything else is no answer, never a sign-out", () => {
  const cases: [number | null, unknown, string][] = [
    [null, undefined, "a network error"],
    [500, {}, "a server error, even with an empty object"],
    [503, null, "a server error, even with null"],
    [504, undefined, "a gateway timeout"],
    [401, null, "a refusal from something in front of the server"],
    [204, null, "any status other than 200"],
    [200, "<html>", "a 200 that is not JSON (a captive portal page)"],
    [200, undefined, "a 200 whose body could not be read"],
    [200, [], "an array"],
    [200, { user: null }, "a user that is not an object"],
    [200, { user: {} }, "a user without an id"],
    [200, { user: { id: "" } }, "an empty id"],
    [200, { user: { id: 7 } }, "an id that is not a string"],
    [200, { expires: "x" }, "an object with no user"],
  ];
  for (const [status, body, label] of cases) {
    assert.equal(classifySessionAnswer(status, body).kind, "no-answer", `${label} is no answer`);
  }
});

// ── retryDelay / constants ───────────────────────────────────────────────────

test("SESSION_RETRY_MS is the backoff [1000, 2000, 4000, 8000]; one attempt waits at most its ceiling", () => {
  assert.deepEqual([...SESSION_RETRY_MS], [1000, 2000, 4000, 8000], "the backoff");
  assert.equal(SESSION_ATTEMPT_TIMEOUT_MS, 8000, "an attempt is abandoned after 8 s");
  assert.equal(SESSION_ATTEMPT_TIMEOUT_MS, Math.max(...SESSION_RETRY_MS), "the timeout is the backoff's ceiling");
  assert.equal(SESSION_ENDPOINT, "/api/auth/session", "the endpoint");
});

test("retryDelay: 1000, 2000, 4000, 8000, then every 8000", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(retryDelay), [1000, 2000, 4000, 8000, 8000, 8000], "attempts 0..5");
  assert.equal(retryDelay(100), 8000, "a long outage stays at 8 s");
  assert.equal(retryDelay(-1), 1000, "a negative attempt reads as the first");
  assert.equal(retryDelay(Number.NaN), 1000, "a bad attempt reads as the first");
});

// ── askSession ───────────────────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit | undefined };
function fakeFetch(answer: () => Promise<Response>): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer();
  }) as typeof fetch;
  return { fetch: impl, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("askSession: one same-origin, uncached GET of /api/auth/session carrying the signal", async () => {
  const { fetch, calls } = fakeFetch(async () => json(200, SESSION_BODY));
  const signal = new AbortController().signal;
  const answer = await askSession(fetch, signal);
  assert.equal(answer.kind, "session", "a session");
  assert.equal(calls.length, 1, "one request");
  assert.equal(calls[0]?.url, "/api/auth/session", "the endpoint");
  assert.equal(calls[0]?.init?.cache, "no-store", "never from the HTTP cache");
  assert.equal(calls[0]?.init?.credentials, "same-origin", "with the session cookie");
  assert.equal(calls[0]?.init?.signal, signal, "abortable");
});

test("askSession: never rejects; a failure of any kind is no answer, a 200 null is a sign-out", async () => {
  const thrown = fakeFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(await askSession(thrown.fetch, new AbortController().signal), NO_ANSWER, "a network error");
  const aborted = fakeFetch(async () => {
    throw new DOMException("aborted", "AbortError");
  });
  assert.deepEqual(await askSession(aborted.fetch, new AbortController().signal), NO_ANSWER, "an aborted attempt");
  const html = fakeFetch(async () => new Response("<html>", { status: 200 }));
  assert.deepEqual(await askSession(html.fetch, new AbortController().signal), NO_ANSWER, "a 200 that is not JSON");
  const error = fakeFetch(async () => json(500, { message: "x" }));
  assert.deepEqual(await askSession(error.fetch, new AbortController().signal), NO_ANSWER, "a 500");
  const out = fakeFetch(async () => json(200, null));
  assert.deepEqual(await askSession(out.fetch, new AbortController().signal), { kind: "signed-out" }, "a 200 null");
});

// ── startSessionReader (fake clock, scripted answers) ────────────────────────

function fakeClock() {
  let nextId = 1;
  const timers = new Map<number, { run: () => void; ms: number }>();
  return {
    setTimer: (run: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (id: number): void => {
      timers.delete(id);
    },
    pending: (): number[] => [...timers.values()].map((t) => t.ms).sort((a, b) => a - b),
    fire(ms: number): void {
      for (const [id, t] of timers) {
        if (t.ms !== ms) continue;
        timers.delete(id);
        t.run();
        return;
      }
      throw new Error(`no pending ${ms} ms timer (pending: ${[...timers.values()].map((t) => t.ms).join(", ")})`);
    },
  };
}

function scriptedAsk() {
  const calls: { signal: AbortSignal; answer: (a: SessionAnswer) => void }[] = [];
  const ask = (signal: AbortSignal) =>
    new Promise<SessionAnswer>((resolve) => {
      calls.push({ signal, answer: resolve });
    });
  return { ask, calls };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
  const clock = fakeClock();
  const asked = scriptedAsk();
  const seen = { sessions: [] as unknown[], signedOut: 0 };
  const reader = startSessionReader({
    ask: asked.ask,
    onSession: (s) => seen.sessions.push(s),
    onSignedOut: () => {
      seen.signedOut += 1;
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, asked, seen, reader };
}

test("reader: asks once at start; a session settles it with no retry left behind", async () => {
  const { clock, asked, seen } = harness();
  assert.equal(asked.calls.length, 1, "one attempt at start");
  assert.deepEqual(clock.pending(), [SESSION_ATTEMPT_TIMEOUT_MS], "only the attempt's timeout is armed");
  asked.calls[0]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [SESSION_BODY], "the session is handed on once");
  assert.equal(seen.signedOut, 0, "never signed out");
  assert.deepEqual(clock.pending(), [], "no timer left");
});

test("reader: 500, 500, then 200 → the session after two retries at 1 s and 2 s, never a sign-out", async () => {
  const { clock, asked, seen } = harness();
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [1000], "the first retry waits 1 s");
  clock.fire(1000);
  assert.equal(asked.calls.length, 2, "second attempt");
  asked.calls[1]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [2000], "the second retry waits 2 s");
  clock.fire(2000);
  asked.calls[2]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [SESSION_BODY], "the session arrives after the retries");
  assert.equal(seen.signedOut, 0, "no answer is never a sign-out");
  assert.deepEqual(clock.pending(), [], "nothing left running");
});

test("reader: the backoff runs 1, 2, 4, 8, 8 s while nothing answers", async () => {
  const { clock, asked } = harness();
  const waits: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    asked.calls[i]?.answer(NO_ANSWER);
    await flush();
    const pending = clock.pending();
    assert.equal(pending.length, 1, `one retry timer after failure ${i + 1}`);
    waits.push(pending[0] ?? -1);
    clock.fire(pending[0] ?? -1);
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 8000], "the backoff");
});

test("reader: a sign-out settles it once and asks no more", async () => {
  const { clock, asked, seen, reader } = harness();
  asked.calls[0]?.answer({ kind: "signed-out" });
  await flush();
  assert.equal(seen.signedOut, 1, "signed out once");
  assert.deepEqual(clock.pending(), [], "no retry after a sign-out");
  reader.retryNow();
  assert.equal(asked.calls.length, 1, "Retry does nothing once settled");
});

test("reader: an attempt with no answer in 8 s is aborted and counts as no answer", async () => {
  const { clock, asked, seen } = harness();
  clock.fire(SESSION_ATTEMPT_TIMEOUT_MS);
  assert.equal(asked.calls[0]?.signal.aborted, true, "the stalled request is aborted");
  assert.deepEqual(clock.pending(), [1000], "and a retry is scheduled");
  asked.calls[0]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [], "an abandoned attempt's late answer is ignored");
  clock.fire(1000);
  assert.equal(asked.calls.length, 2, "the retry asks again");
});

test("reader: Retry aborts the attempt in flight and asks at once; the superseded answer is ignored", async () => {
  const { clock, asked, seen, reader } = harness();
  reader.retryNow();
  assert.equal(asked.calls[0]?.signal.aborted, true, "the attempt in flight is aborted");
  assert.equal(asked.calls.length, 2, "a new attempt at once");
  assert.deepEqual(clock.pending(), [SESSION_ATTEMPT_TIMEOUT_MS], "one timeout: the new attempt's");
  asked.calls[0]?.answer({ kind: "signed-out" });
  await flush();
  assert.equal(seen.signedOut, 0, "the superseded attempt's answer is ignored");
  asked.calls[1]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [SESSION_BODY], "the new attempt's answer counts");
});

test("reader: Retry during the backoff wait cancels the wait and asks at once", async () => {
  const { clock, asked, reader } = harness();
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [1000], "waiting for the retry");
  reader.retryNow();
  assert.equal(asked.calls.length, 2, "asked at once");
  assert.deepEqual(clock.pending(), [SESSION_ATTEMPT_TIMEOUT_MS], "the backoff wait is gone");
});

test("reader: stop() aborts the attempt in flight, clears every timer, and ignores late answers", async () => {
  const { clock, asked, seen, reader } = harness();
  reader.stop();
  assert.equal(asked.calls[0]?.signal.aborted, true, "aborted on stop");
  assert.deepEqual(clock.pending(), [], "no timer left");
  asked.calls[0]?.answer({ kind: "session", session: SESSION_BODY as never });
  await flush();
  assert.deepEqual(seen.sessions, [], "nothing handed on after stop");
  reader.retryNow();
  assert.equal(asked.calls.length, 1, "Retry after stop does nothing");
});

test("reader: stop() during the backoff wait clears it", async () => {
  const { clock, asked, reader } = harness();
  asked.calls[0]?.answer(NO_ANSWER);
  await flush();
  assert.deepEqual(clock.pending(), [1000], "waiting");
  reader.stop();
  assert.deepEqual(clock.pending(), [], "the wait is cleared");
});
