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
  ackAnswered,
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  readPendingAcks,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINT_HOST_EOD_TIMEOUT_MESSAGE } from "@/lib/print-host-slips";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
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
  // 60 turns (was 20): the 1C gate added one await (a cycle first waits for any flush on the wire, M6).
  for (let i = 0; i < 60; i++) await Promise.resolve();
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
  // The 1C review gate (M6) changed this sequence deliberately: the next cycle re-sends the kept ack
  // before it leases again, so the 5xx answers that re-send, and the 5 s retry carries the third.
  assert.equal(w.pending.length, 1, "kept after a network error, and after the 5xx of its re-send before the next lease");
  assert.equal(w.acks.length, 2, "sent, then sent again before the next lease");
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

// Session 1C final review I2: a kick that lands while a cycle runs used to be dropped. If that cycle's
// lease read the line before the new job was inserted, the job waited for the next poll (up to 60 s on
// the host, 20 s with no host).
test("a kick that lands while a lease is on the wire is not lost: the agent leases once more when that cycle ends", async () => {
  const { w, deps } = world();
  let release: (data: PrintLeaseData) => void = () => undefined;
  let calls = 0;
  const agent = createPrintAgent({
    ...deps,
    lease: () => {
      calls += 1;
      if (calls === 1) return new Promise<PrintLeaseData>((resolve) => void (release = resolve));
      return deps.lease();
    },
  });
  w.leases.push({ jobs: [job("j2")], retryAt: null });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  agent.kick(); // a new job's print-status arrives while the first lease is still on the wire
  release({ jobs: [], retryAt: null }); // that lease read the line before the new job was inserted
  await settle();
  assert.deepEqual(w.prints, ["j2"], "the job that arrived mid-lease is printed at once, not at the next poll");
  assert.equal(calls, 3, "one more lease for the kick, then one that finds the line empty");
  agent.stop();
});

// Session 1C final review I2(b), rewritten at the 1C review gate for M6: the cycle now waits for a flush
// already on the wire before it leases, and a flush re-reads the store until every entry was tried once.
test("a printed ack still on the wire goes first: the next lease waits for its answer, then the new ack goes out at once", async () => {
  const { w, deps } = world();
  let releaseOld: () => void = () => undefined;
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      if (id !== "old") return deps.ack(id, body);
      w.acks.push({ id, body });
      return new Promise<PrintAckData>((resolve) => void (releaseOld = () => resolve({ applied: true, status: "printed", nextAttemptAt: null })));
    },
  });
  w.pending = [{ id: "old", epoch: 3, at: T0 }];
  void agent.flushAcks(); // the mount flush, still waiting for the server
  await settle();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 0, "no lease while an ack from before is unanswered: it could be our own job (M6)");
  releaseOld();
  await settle();
  assert.deepEqual(w.prints, ["j1"], "then j1 prints");
  assert.deepEqual(w.acks.map((a) => a.id), ["old", "j1"], "and its ack goes out without waiting for the retry timer");
  assert.deepEqual(w.pending, [], "both acks answered and cleared");
  assert.equal(w.leaseCalls, 2, "the next lease runs only after j1's ack was sent");
  agent.stop();
});

test("a flush re-reads the store: an ack kept while it was on the wire goes out with it", async () => {
  const { w, deps } = world();
  w.pending = [{ id: "a", epoch: 1, at: T0 }];
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      if (id === "a") w.pending = [...w.pending, { id: "b", epoch: 1, at: T0 }];
      return deps.ack(id, body);
    },
  });
  await agent.flushAcks();
  assert.deepEqual(w.acks.map((a) => a.id), ["a", "b"], "one flush, both acks");
  assert.deepEqual(w.pending, [], "both answered and cleared");
  agent.stop();
});

// ── The 1C review gate (2026-10-03): the owner's I3 decision and the agent minors F1, M4, M5, M6 ──

// I3 (owner): a refusal caused by the slip itself (it could not be drawn, or its figures never loaded)
// counts. The second one for a job while the printer is ready fails it, freeing the line; a refusal
// because the printer is off never counts.
test("I3: the second refusal of a slip that cannot be drawn fails it, and the next slip prints", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(RASTER_FAILED_MESSAGE) }, { ok: false, error: new Error(RASTER_FAILED_MESSAGE) });
  w.ackAnswers.push(
    { applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() },
    { applied: true, status: "failed", nextAttemptAt: null },
  );
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, 3_000);
  assert.deepEqual(
    w.acks.map((a) => `${a.id}:${a.body.sent}:${a.body.permanent ?? false}`),
    ["j1:no:false", "j1:no:true", "j2:undefined:false"],
    "the first refusal waits for the server's backoff (2 s, not the 30 s printer re-check); the second is permanent",
  );
  assert.deepEqual(w.prints, ["j1", "j1", "j2"], "the line is free again: j2 prints straight away");
  agent.stop();
});

test("I3: printer refusals never count, even between two slip refusals; an end-of-day timeout counts", async () => {
  const { w, deps } = world();
  for (let i = 0; i < 4; i++) {
    w.leases.push({ jobs: [job("j1", i + 1)], retryAt: null });
    w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  }
  w.results.push(
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINT_HOST_EOD_TIMEOUT_MESSAGE) },
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINT_HOST_EOD_TIMEOUT_MESSAGE) },
  );
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, 200_000);
  assert.deepEqual(w.acks.map((a) => a.body.permanent ?? false), [false, false, false, true], "only the second slip refusal is permanent");
  agent.stop();
});

test("I3: a slip refusal after the printer stopped being ready is a printer refusal, never counted", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(RASTER_FAILED_MESSAGE) }, { ok: false, error: new Error(RASTER_FAILED_MESSAGE) });
  const agent = createPrintAgent({
    ...deps,
    print: async (j: LeasedPrintJob): Promise<PrintAgentResult> => {
      w.prints.push(j.id);
      w.ready = false;
      return w.results.shift() ?? { ok: true };
    },
  });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.permanent, undefined, "not counted");
  assert.equal(isSlipRefusal(printWriteOutcomeOf(new Error(RASTER_FAILED_MESSAGE))), true, "it is a slip refusal by its sentence");
  assert.equal(isSlipRefusal(printWriteOutcomeOf(new Error(PRINTER_NOT_CONNECTED_MESSAGE))), false, "a printer refusal is not");
  assert.equal(PRINT_SLIP_REFUSALS_MAX, 2, "two refusals of the slip itself, then failed: at most 4 requests (2 leases, 2 acks)");
  agent.stop();
});

// F1 (the gate's fresh review): the bridge freeing up from this very slip lands while its failed ack is
// on the wire. A job back in line holds the line until its nextAttemptAt, so that kick must not cost an
// empty lease.
test("F1: a maybe whose answer names a retry time costs no extra lease, whatever re-renders meanwhile", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 5_000).toISOString() });
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      agentRef?.setGate({ enabled: true, busy: true });
      agentRef?.setGate({ enabled: true, busy: false }); // the bridge re-renders while the ack is on the wire
      return deps.ack(id, body);
    },
  });
  agentRef = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "one lease: the retry waits for its own timer");
  assert.equal(w.timers.length, 1, "one timer, at the job's nextAttemptAt");
  agent.stop();
});

// M4: a failed ack that got no answer is kept and re-sent like a printed one, so the lease never expires
// into a counted "maybe" (a false REPRINT, or a false cashier prompt).
test("M4: a failed ack with no answer is kept and re-sent at 5 s, even with the printer off; a 4xx is an answer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push(new ApiError("offline", "network", null), { applied: true, status: "queued", nextAttemptAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  w.ready = false;
  await advance(w, PRINT_ACK_RETRY_MS + 1_000);
  assert.deepEqual(w.acks.map((a) => `${a.id}:${a.body.outcome}:${a.body.sent}`), ["j1:failed:no", "j1:failed:no"], "re-sent once, as the same failed ack");
  assert.deepEqual(w.pending, [], "answered: cleared");
  agent.stop();

  const second = world();
  second.w.leases.push({ jobs: [job("j2")], retryAt: null });
  second.w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  second.w.ackAnswers.push(new ApiError("gone", "http", 409));
  const other = createPrintAgent(second.deps);
  other.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(second.w.pending, [], "a server answer of any kind is never kept");
  other.stop();
});

// The 1D review gate (N-8): a refusal that says nothing about the job is not an answer, so the ack is
// kept; forgetting it let the lease expire into a counted "maybe" (a false REPRINT or cashier prompt).
test("N-8: signed out, forbidden, timed out or rate-limited is no answer: the ack is kept and re-sent", async () => {
  for (const status of [401, 403, 408, 429]) assert.equal(ackAnswered(new ApiError("x", "http", status)), false, `${status} is no answer`);
  for (const status of [400, 404, 409, 422]) assert.equal(ackAnswered(new ApiError("x", "http", status)), true, `${status} is an answer`);
  assert.equal(ackAnswered(new ApiError("x", "http", 503)), false, "a 5xx is no answer");
  assert.equal(ackAnswered(new ApiError("x", "network", null)), false, "the network is no answer");
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.ackAnswers.push(new ApiError("signed out", "http", 401), new ApiError("signed out", "http", 401));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks.length, 2, "sent, and sent again before the next lease (M6)");
  assert.equal(w.pending.length, 1, "a 401 on a printed ack keeps it for the 5 s retry");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.deepEqual(w.pending, [], "re-sent and answered");
  agent.stop();
});

test("M-4 (1D gate): a stop() while the cycle waits for a flush leases nothing", async () => {
  const { w, deps } = world();
  w.pending = [{ id: "old", epoch: 1, at: T0 }];
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  agent.stop();
  await settle();
  assert.equal(w.leaseCalls, 0, "stopped mid-flush: no lease, so nothing is printed by a page that is going away");
  assert.deepEqual(w.prints, [], "nothing printed");
});

test("M-3 (1D gate): a slip refused once for itself, then printed, is forgotten; a failed one keeps its count (one tap, one try)", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null }, { jobs: [job("j1", 3)], retryAt: null });
  w.results.push({ ok: false, error: new Error(RASTER_FAILED_MESSAGE) }, { ok: true }, { ok: false, error: new Error(RASTER_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, 3_000);
  // A staff reprint of the same job id (epoch 3) after it printed: its first refusal counts from one again.
  agent.kick();
  await settle();
  assert.deepEqual(
    w.acks.filter((a) => a.body.outcome === "failed").map((a) => `${a.body.epoch}:${a.body.permanent ?? false}`),
    ["1:false", "3:false"],
    "printed in between: the count started again, so the new refusal is not the second one",
  );
  agent.stop();
});

// M5: a storage that refuses the write (full, blocked) used to drop the printed ack before it was sent.
test("M5: the pending-ack store keeps the list in memory when storage refuses it (node has no window)", () => {
  writePendingAcks([{ id: "a", epoch: 1, at: 1 }]);
  assert.deepEqual(readPendingAcks(), [{ id: "a", epoch: 1, at: 1 }], "kept in memory, so it is still sent");
  writePendingAcks([]);
  assert.deepEqual(readPendingAcks(), [], "cleared");
});
