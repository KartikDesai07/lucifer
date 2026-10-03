import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api-client";
import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS, PRINT_WAKE_SOCKET_MS } from "@pos/shared/print-job";
import { PRINT_AGENT_REFUSED_RECHECK_MS, type LeasedPrintJob, type PrintAckData, type PrintLeaseData } from "@pos/shared/print-agent-wire";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { printAgentEnqueueHeaders, printAgentHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import { createHostSlipOutcomes } from "@/lib/print-host-outcomes";
import {
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_TOO_LARGE_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §9.1, the owner's rules after Session 1B): the agent core, driven
// with fakes and a hand-cranked clock. Every network call it makes is recorded.

const T0 = 1_800_000_000_000;

function job(id: string, epoch = 1): LeasedPrintJob {
  return {
    id,
    epoch,
    kind: "kot",
    label: `KOT ${id}`,
    createdAt: new Date(T0).toISOString(),
    payload: { kind: "eod", dateKey: "2026-10-03", dateLabel: "3 Oct" } as unknown as LeasedPrintJob["payload"],
    labels: [],
    copyIndex: 0,
    attempt: epoch,
  };
}

function world() {
  const w = {
    now: T0,
    timers: [] as { at: number; fn: () => void; id: number }[],
    nextId: 1,
    leases: [] as PrintLeaseData[],
    leaseCalls: 0,
    leaseFails: false,
    acks: [] as { id: string; body: PrintAgentAckBody }[],
    ackAnswers: [] as Array<PrintAckData | Error>,
    prints: [] as string[],
    results: [] as PrintAgentResult[],
    ready: true,
    printer: {} as object,
    pending: [] as PendingPrintAck[],
  };
  const deps = {
    deviceId: "dev-a",
    lease: async (): Promise<PrintLeaseData> => {
      w.leaseCalls += 1;
      if (w.leaseFails) throw new ApiError("offline", "network", null);
      return w.leases.shift() ?? { jobs: [], retryAt: null };
    },
    ack: async (id: string, body: PrintAgentAckBody): Promise<PrintAckData> => {
      w.acks.push({ id, body });
      const answer = w.ackAnswers.shift() ?? { applied: true, status: body.outcome === "printed" ? "printed" : "queued", nextAttemptAt: null };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    print: async (j: LeasedPrintJob): Promise<PrintAgentResult> => {
      w.prints.push(j.id);
      return w.results.shift() ?? { ok: true };
    },
    printerReady: () => w.ready,
    printerState: () => w.printer,
    readPending: () => [...w.pending],
    writePending: (entries: PendingPrintAck[]) => void (w.pending = [...entries]),
    now: () => w.now,
    setTimer: (fn: () => void, ms: number) => {
      const id = w.nextId++;
      w.timers.push({ at: w.now + ms, fn, id });
      return id;
    },
    clearTimer: (handle: unknown) => void (w.timers = w.timers.filter((t) => t.id !== handle)),
  };
  return { w, deps };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(w: ReturnType<typeof world>["w"], ms: number): Promise<void> {
  const end = w.now + ms;
  for (;;) {
    w.timers.sort((a, b) => a.at - b.at);
    const next = w.timers[0];
    if (next === undefined || next.at > end) break;
    w.timers.shift();
    w.now = next.at;
    next.fn();
    await settle();
  }
  w.now = end;
}

test("a leased job is printed, its ack is kept until the server answers, and the next job is leased at once", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["j1", "j2"], "both jobs printed, one after the other");
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["j1", "printed"], ["j2", "printed"]], "each printed job is acked");
  assert.equal(w.leaseCalls, 3, "the third lease finds the line empty and the agent stops");
  assert.deepEqual(w.pending, [], "every answered ack is cleared");
  assert.equal(w.timers.length, 0, "an empty line sets no timer: nothing polls");
  agent.stop();
});

// Found by the 1B review gate's E2E run: the page flushes at mount with nothing pending, and an async
// body with no await then finished before its promise was stored, so every later printed ack was dropped.
test("a flush with nothing pending never blocks a later printed ack", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  await agent.flushAcks();
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["j1", "printed"]], "the printed ack is sent after an empty flush");
  assert.deepEqual(w.pending, [], "and cleared on the answer");
  agent.stop();
});

test("the owner's rule: no lease at all while this device's printer can not print", async () => {
  const { w, deps } = world();
  w.ready = false;
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  agent.kick();
  agent.kick();
  await advance(w, 10 * 60_000);
  assert.equal(w.leaseCalls, 0, "a printer that is off is never leased for, so no attempt is burned");
  w.ready = true;
  agent.kick();
  await settle();
  assert.deepEqual(w.prints, ["j1"], "it prints once the printer is back");
  agent.stop();
});

test("a refusal (nothing sent) acks sent:'no' and holds the agent until the printer's state changes", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.acks[0]?.body, { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: PRINTER_NOT_CONNECTED_MESSAGE });
  await advance(w, 10_000);
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 1, "no new lease while the printer is the one that refused");
  w.printer = {};
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 3, "a changed printer state (it reconnected) leases again, prints, then finds the line empty");
  assert.deepEqual(w.prints, ["j1", "j1"], "the same slip prints, unlabelled: nothing reached paper the first time");
  agent.stop();
});

test("a refusal with no printer change is retried after the recheck window, never sooner", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.equal(w.leaseCalls, 1, "nothing inside the window");
  await advance(w, 2);
  assert.equal(w.leaseCalls, 2, "one lease once the window has passed");
  agent.stop();
});

test("a maybe-printed failure acks sent:'maybe', and the retry waits for the server's nextAttemptAt", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 5_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.sent, "maybe");
  assert.equal(w.leaseCalls, 1, "no lease before nextAttemptAt (no wasted request on a job in backoff)");
  await advance(w, 5_000);
  assert.equal(w.leaseCalls, 3, "the local timer leases the retry, which prints; then the line is empty");
  assert.deepEqual(w.prints, ["j1", "j1"], "the retry is the same slip (the server labels it REPRINT)");
  agent.stop();
});

test("a permanent failure says so; a parked or failed answer frees the line for the next job", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_TOO_LARGE_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "failed", nextAttemptAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.permanent, true, "too large never prints");
  assert.deepEqual(w.prints, ["j1", "j2"], "the next job prints straight after");
  assert.equal(failedAckBody("d", 1, { sent: "maybe", permanent: false, message: "x".repeat(300) }).error?.length, 200, "the error fits the ack schema");
  agent.stop();
});

test("a printed ack with no answer is retried every 5 s; any server answer clears it; 10 minutes drops it", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.ackAnswers.push(new ApiError("offline", "network", null), new ApiError("server", "http", 503), new ApiError("gone", "http", 409));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.pending.length, 1, "kept after a network error");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 1, "kept after a 5xx");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 0, "a 409 is an answer: cleared");
  assert.equal(w.acks.length, 3, "three sends, then no more");
  w.pending = [{ id: "old", epoch: 1, at: w.now - PRINT_ACK_PENDING_MAX_MS - 1 }];
  await agent.flushAcks();
  assert.deepEqual(w.pending, [], "an entry older than 10 minutes is dropped unsent");
  assert.equal(w.acks.length, 3, "the expired entry was not sent");
  agent.stop();
});

test("timers from the server's clock are clamped to 2–30 s, and an unreachable lease waits 30 s (no tight loop)", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [], retryAt: new Date(T0 - 60_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.timers[0]?.at, T0 + 2_000, "a retryAt in the past waits the shortest step");
  await advance(w, 2_000);
  assert.equal(w.leaseCalls, 2);
  w.leaseFails = true;
  agent.kick();
  await settle();
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.equal(w.leaseCalls, 3, "offline: one failed lease, then quiet");
  await advance(w, 1);
  assert.equal(w.leaseCalls, 4, "one more after 30 s");
  agent.stop();
});

test("a closed gate or a busy bridge leases nothing; opening it kicks once; stop clears every timer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.kick();
  agent.setGate({ enabled: true, busy: true });
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 0, "not enabled, then busy: nothing");
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["j1"], "the bridge freeing up kicks the agent");
  agent.stop();
  agent.kick();
  await settle();
  assert.equal(w.timers.length, 0, "a stopped agent holds no timer");
});

test("the host's wake polls at the spec §9.1 cadence, never while hidden or past its cap, and kicks only on jobs", async () => {
  const { w } = world();
  let wakes = 0;
  let jobs = 0;
  let healthy = false;
  let visible = true;
  let budget = 3;
  let waiting = 0;
  const wake = createPrintAgentWake({
    wake: async () => {
      wakes += 1;
      return { jobsForMe: { count: waiting, oldestCreatedAt: null }, agents: 1, agentDailyCap: 14_400, serverNow: new Date(w.now).toISOString() };
    },
    socketHealthy: () => healthy,
    mayPoll: () => visible,
    spendOne: () => (budget -= 1) >= 0,
    onJobs: () => void (jobs += 1),
    now: () => w.now,
    setTimer: (fn, ms) => {
      const id = w.nextId++;
      w.timers.push({ at: w.now + ms, fn, id });
      return id;
    },
    clearTimer: (handle) => void (w.timers = w.timers.filter((t) => t.id !== handle)),
  });
  wake.start();
  await settle();
  assert.equal(wakes, 1, "the first wake at once");
  assert.equal(w.timers[0]?.at, T0 + PRINT_WAKE_SLOW_MS, "no job seen: the slow cadence");
  waiting = 1;
  await advance(w, PRINT_WAKE_SLOW_MS);
  assert.equal(jobs, 1, "a job for me kicks the agent");
  assert.equal(w.timers[0]?.at, w.now + PRINT_WAKE_FAST_MS, "a job seen: the fast cadence");
  healthy = true;
  waiting = 0;
  await advance(w, PRINT_WAKE_FAST_MS);
  assert.equal(w.timers[0]?.at, w.now + PRINT_WAKE_SOCKET_MS, "a healthy socket: the 60 s safety net");
  assert.equal(wakes, 3);
  await advance(w, PRINT_WAKE_SOCKET_MS);
  assert.equal(wakes, 3, "the cap is spent: no request");
  visible = false;
  budget = 99;
  await advance(w, 10 * PRINT_WAKE_SLOW_MS);
  assert.equal(wakes, 3, "a hidden tab never polls");
  wake.stop();
});

test("the slip for a leased job carries its labels as the banner; an end-of-day summary and a first print carry none", () => {
  const kot = { ...job("k1"), kind: "kot" as const, labels: ["REPRINT" as const], payload: { kind: "kot", round: 1, snapshot: { _id: "o1", orderId: "ORD-1", createdAt: new Date(T0).toISOString(), items: [] } } as unknown as LeasedPrintJob["payload"] };
  const slip = printAgentSlipOf(kot, "2026-10-03");
  assert.equal(slip.surface === "eod" ? "eod" : slip.banner, "REPRINT", "a retried KOT prints REPRINT on top");
  assert.equal("banner" in printAgentSlipOf({ ...kot, labels: [] }, "2026-10-03"), false, "a first print has no banner at all");
  const eod = printAgentSlipOf({ ...job("e1"), kind: "eod", labels: ["REPRINT"] }, "2026-10-03");
  assert.equal(eod.surface, "eod");
  assert.equal("banner" in eod, false, "the end-of-day summary takes no banner");
});

test("the call sites' helpers: the opt-in headers, a ref by kind, and nothing for a device with no identity", () => {
  assert.deepEqual(printAgentHeaders(""), {}, "no identity: the server prints nothing for it, the page prints as before");
  assert.deepEqual(printAgentHeaders("dev-a", true), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-bill": "1" });
  const order = { printJobs: [{ id: "j1", kind: "kot", targetDeviceId: "dev-a", label: "KOT", status: "queued" }, { id: "j2", kind: "bill", targetDeviceId: "dev-a", label: "Bill", status: "printed" }] };
  assert.equal(printJobRefOf(order, "bill")?.id, "j2", "found by kind");
  assert.equal(printJobRefOf(order, "void"), null, "a slip the answer did not name: the call site enqueues it");
  assert.equal(printJobRefOf({ printJobs: [{ id: 1 }] }, "kot"), null, "a malformed ref is ignored");
  assert.equal(printJobRefOf(null, "kot"), null);
  assert.ok(/^[A-Za-z0-9-]{8,64}$/.test(printAgentEnqueueHeaders("dev-a")["idempotency-key"] ?? ""), "an enqueue carries a usable Idempotency-Key");
});

test("the bridge's outcome line: each slip's caller hears once, in print order; the test slip and untracked slips keep their place", () => {
  const outcomes = createHostSlipOutcomes();
  const heard: string[] = [];
  outcomes.track((r) => heard.push(`a:${r.ok}`));
  outcomes.track(null);
  outcomes.track((r) => heard.push(`c:${r.ok}`));
  outcomes.finish({ ok: true });
  outcomes.finish({ ok: true });
  outcomes.finish({ ok: false, error: new Error("x") });
  outcomes.finish({ ok: true });
  assert.deepEqual(heard, ["a:true", "c:false"], "in order, once each, the test slip in between untold");
});
