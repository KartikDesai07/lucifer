import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api-client";
import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS, PRINT_WAKE_SOCKET_MS } from "@pos/shared/print-job";
import { PRINT_AGENT_REFUSED_RECHECK_MS, type LeasedPrintJob, type PrintAckData, type PrintLeaseData } from "@pos/shared/print-agent-wire";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { leasedJobsOf, printAgentEnqueueHeaders, printAgentHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import { createHostSlipOutcomes } from "@/lib/print-host-outcomes";
import {
  PRINT_DIRECT_HOLD_MS,
  ackAnswered,
  createPrintAgent,
  deliverLeasedJob,
  directPrintTab,
  failedAckBody,
  onLeasedJob,
  printAgentSlipOf,
  pulsePrintDeviceQuery,
  readPendingAcks,
  setDirectPrintSource,
  setPulsePrintDevice,
  setReadyPrintersSource,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINT_DEVICE_LINE, createRefusalHolds } from "@/lib/print-agent-holds";
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

// Session 2C's final review (I-2): a writer whose counted jobs sit on a printer it does not print on (a second
// printer it writes, before 2E) kicked an empty lease on every wake, every 3 s with the socket down, all service.
test("2C: a wake whose jobs the agent cannot lease neither kicks it nor keeps the fast cadence", async () => {
  const { w } = world();
  let jobs = 0;
  let leasable = false;
  const wake = createPrintAgentWake({
    wake: async () => ({ jobsForMe: { count: 1, oldestCreatedAt: null, printerIds: ["b".repeat(24)] }, agents: 1, agentDailyCap: 7_000, serverNow: new Date(w.now).toISOString() }),
    socketHealthy: () => false,
    mayPoll: () => true,
    spendOne: () => true,
    leasable: () => leasable,
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
  assert.equal(jobs, 0, "nothing it can lease: no kick");
  assert.equal(w.timers[0]?.at, T0 + PRINT_WAKE_SLOW_MS, "and the slow cadence, not the fast one");
  leasable = true;
  await advance(w, PRINT_WAKE_SLOW_MS);
  assert.equal(jobs, 1, "its list now knows that printer: the kick comes");
  assert.equal(w.timers[0]?.at, w.now + PRINT_WAKE_FAST_MS, "a job it can lease: the fast cadence");
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

// Phase 2 Session 2E (spec §9.2, decision 15): with two printers on one device, one slip is leased to the asking tab once
// per printer line (the first slip of each line). Every one of them must reach the agent, or the second waits leased
// until its lease runs out and prints late, as a REPRINT (found by the 2D gate's browser run of the Windows app).
test("2E: every job of a slip leased to this tab reaches the agent: the one followed, and the others beside it", () => {
  const lease = (id: string): LeasedPrintJob => ({ ...job(id), printerId: `p-${id}` });
  const order = {
    printJobs: [
      { id: "all", kind: "kot", targetDeviceId: "pc", label: "KOT 1 · All stations", status: "leased", leased: lease("all") },
      { id: "bar", kind: "kot", targetDeviceId: "pc", label: "KOT 1 · Bar", status: "leased", leased: lease("bar") },
      { id: "kit", kind: "kot", targetDeviceId: "tab", label: "KOT 1 · Kitchen", status: "queued" },
      { id: "bill", kind: "bill", targetDeviceId: "pc", label: "Bill", status: "queued" },
    ],
  };
  const ref = printJobRefOf(order, "kot");
  assert.equal(ref?.id, "all", "the first leased one is followed (its readback chip)");
  assert.deepEqual(ref?.alsoLeased?.map((j) => j.id), ["bar"], "the other one leased to this tab rides beside it");
  assert.equal(printJobRefOf(order, "bill")?.alsoLeased, undefined, "a slip with one job: nothing beside it");
  assert.deepEqual(leasedJobsOf([{ leased: lease("a") }, {}, { leased: lease("a") }, { leased: lease("b") }]).map((j) => j.id), ["a", "b"], "each once, in order");
});

// Phase 2 Session 2E (spec §9.2): a printer job on the Windows app carries its printer's name and paper to the bridge.
test("2E: a slip for a Windows printer carries its target; a slip with none is unchanged", () => {
  const target = { printerName: "Kitchen TVS", paper: "58mm" as const };
  assert.deepEqual(printAgentSlipOf(job("k1"), "2026-10-03", target).target, target, "the printer's name and paper");
  assert.equal("target" in printAgentSlipOf(job("k1"), "2026-10-03"), false, "no target: the slip as before");
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

// ── Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9): direct print on the asking device ──

const done = (more: boolean): PrintAckData => ({ applied: true, status: "printed", nextAttemptAt: null, more });

test("2B: a job an answer carried leased to this tab prints at once with no lease, and its ack's more:false ends the burst", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "the gate's own look at the line");
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "printed from the answer");
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["d1", "printed"]]);
  assert.equal(w.leaseCalls, 1, "no lease for it, and none after it: the ack said the line is empty");
  assert.deepEqual(w.pending, [], "its ack was answered");
  agent.stop();
});

// Seen on the emulator at the 2A gate: the bridge freeing up from the agent's own slip, and its printer's
// status changing, kicked the agent while it printed, so a lease followed every more:false ack.
test("2B: its own print's state changes queue no lease after a more:false ack; a job's kick during the print still does", async () => {
  const { w, deps } = world();
  let during: "state" | "job" = "state";
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    print: (j: LeasedPrintJob) => {
      if (during === "state") {
        agentRef?.setGate({ enabled: true, busy: true });
        agentRef?.setGate({ enabled: true, busy: false }); // the bridge prints this very slip, then frees up
        agentRef?.nudge(); // its printer's status changes while it prints
      } else agentRef?.kick(); // a new job is announced while it prints
      return deps.print(j);
    },
  });
  agentRef = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  w.ackAnswers.push(done(false), done(false));
  agent.take(job("d1"));
  await settle();
  assert.deepEqual([w.prints, w.leaseCalls], [["d1"], 1], "printed, and no lease after it: only the gate's first look");
  during = "job";
  agent.take(job("d2"));
  await settle();
  assert.deepEqual([w.prints, w.leaseCalls], [["d1", "d2"], 2], "a job's kick during the print leases once after it");
  agent.nudge();
  await settle();
  assert.equal(w.leaseCalls, 3, "an idle agent nudged looks at the line");
  agent.stop();
});

test("2B: Pay Now: the KOT made leased prints first, its ack's more:true leases the bill, and the bill's more:false stops", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [{ ...job("bill"), kind: "bill" }], retryAt: null });
  w.ackAnswers.push(done(true), done(false));
  const agent = createPrintAgent(deps);
  agent.take(job("kot"));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["kot", "bill"], "KOT before bill (§7.6)");
  assert.equal(w.leaseCalls, 1, "one lease, for the bill: order + ack + lease + ack, no empty lease after");
  agent.stop();
});

test("2B: an answer delivered twice prints once; a job printed and waiting for its ack's answer is never printed again", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  agent.take(job("d1"));
  agent.take(job("d1"));
  await settle();
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "at-least-once delivery, an idempotent consumer");
  w.pending = [{ id: "d2", epoch: 1, at: T0 }];
  agent.take(job("d2"));
  await settle();
  assert.deepEqual(w.prints, ["d1"], "a job whose printed ack is still pending is already on paper");
  agent.take(job("d1", 2));
  await settle();
  assert.deepEqual(w.prints, ["d1", "d1"], "a new epoch of a job is a new lease (a REPRINT) and prints");
  agent.stop();
});

// Session 2B's final review (C-1): the enqueue hands a running lease back to its tab, even one this tab took
// through the lease call. A Send again that landed while that job printed made it print twice, unlabelled.
test("2B: a job leased through the lease call prints once when the enqueue hands it back, while it prints or before", async () => {
  const during = world();
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  during.w.leases.push({ jobs: [job("b1")], retryAt: null });
  during.w.ackAnswers.push(done(false));
  const agent = createPrintAgent({
    ...during.deps,
    print: (j: LeasedPrintJob) => {
      agentRef?.take(job("b1")); // the re-sent slip's answer arrives while it prints
      return during.deps.print(j);
    },
  });
  agentRef = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(during.w.prints, ["b1"], "the lease's job and the enqueue's are one (id, epoch): one print");
  assert.deepEqual(during.w.acks.map((a) => [a.id, a.body.outcome]), [["b1", "printed"]], "and one ack");
  agent.stop();

  const before = world();
  let beforeRef: ReturnType<typeof createPrintAgent> | null = null;
  before.w.leases.push({ jobs: [job("b2")], retryAt: null });
  before.w.ackAnswers.push(done(false));
  const early = createPrintAgent({
    ...before.deps,
    lease: () => {
      if (before.w.leases.length > 0) beforeRef?.take(job("b2")); // the enqueue's answer arrives before the lease's
      return before.deps.lease();
    },
  });
  beforeRef = early;
  early.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(before.w.prints, ["b2"], "held first, then leased: still one print");
  early.stop();
});

// Session 2B's fresh review (I-1): a job held while the tab could not print (its drain lock lost to a printer
// that went off) printed when the gate reopened, even after its lease had run out and another writer had
// printed it as REPRINT: two KOTs.
test("2B: a held job prints only well inside its lease; one held longer is dropped unprinted, and leases nothing past the gate", async () => {
  const late = world();
  late.w.ready = false;
  const lateAgent = createPrintAgent(late.deps);
  lateAgent.take(job("late"));
  await advance(late.w, PRINT_DIRECT_HOLD_MS);
  lateAgent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(
    [late.w.prints, late.w.acks.map((a) => [a.id, a.body.outcome, a.body.sent, a.body.epoch])],
    [[], [["late", "failed", "no", 1]]],
    "dropped unprinted (its lease may be near its end), and handed back as a refusal at its epoch (the final review, I-1)",
  );
  assert.equal(late.w.leaseCalls, 0, "with nothing left to print, the lease gate decides: the printer is off, so no lease");
  late.w.ready = true;
  lateAgent.kick();
  await settle();
  assert.equal(late.w.leaseCalls, 1, "the line is leased as usual once the printer is back");
  lateAgent.stop();

  const inTime = world();
  inTime.w.ackAnswers.push(done(false));
  const agent = createPrintAgent(inTime.deps);
  agent.take(job("in-time"));
  await advance(inTime.w, PRINT_DIRECT_HOLD_MS - 1);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(inTime.w.prints, ["in-time"], "a printer back within the hold window prints it, unlabelled");
  agent.stop();
});

// Session 2B's final review (I-1): a held job dropped unprinted was never acked, so a slip this tab knew it never
// sent expired into a REPRINT KOT (a bill: the cashier's "did it print?"). It is handed back as a refusal
// (sent:"no", never counted), which the server takes only while the job is still leased at that epoch.
test("2B: a held job dropped by the hold bound or by stop() is handed back as a refusal (sent:'no') before any lease", async () => {
  const late = world();
  const order: string[] = [];
  const agent = createPrintAgent({
    ...late.deps,
    lease: () => {
      order.push("lease");
      return late.deps.lease();
    },
    ack: (id: string, body: PrintAgentAckBody) => {
      order.push(`ack ${id} ${body.outcome} ${body.sent ?? ""}`.trim());
      return late.deps.ack(id, body);
    },
  });
  agent.take(job("late"));
  await advance(late.w, PRINT_DIRECT_HOLD_MS);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(late.w.prints, [], "dropped unprinted");
  assert.deepEqual(order, ["ack late failed no", "lease"], "its lease handed back first, so the line's lease can reach it, unlabelled");
  assert.deepEqual(late.w.pending, [], "the refusal was answered and cleared");
  agent.stop();

  const stopping = world();
  const stopped = createPrintAgent(stopping.deps);
  stopped.take(job("held"));
  stopped.stop();
  await settle();
  assert.deepEqual(stopping.w.prints, [], "a stopped agent prints nothing it held");
  assert.deepEqual(stopping.w.acks.map((a) => [a.id, a.body.outcome, a.body.sent]), [["held", "failed", "no"]], "and hands it back at once");
});

// The 2B review gate (M-A): the cycle took a fresh held job out of the queue, then waited for the ack of a stale
// one it had just handed back; a stop() landing in that wait dropped the fresh job with no ack at all.
test("2B gate: a stop() while a hand-back is on the wire hands back the job the cycle already took", async () => {
  const { w, deps } = world();
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      if (id === "stale") agentRef?.stop(); // the page goes away while the stale job's refusal is on the wire
      return deps.ack(id, body);
    },
  });
  agentRef = agent;
  agent.take(job("stale"));
  await advance(w, PRINT_DIRECT_HOLD_MS);
  agent.take(job("fresh"));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, [], "nothing prints on a stopped page");
  assert.deepEqual(
    w.acks.map((a) => [a.id, a.body.sent]),
    [["stale", "no"], ["fresh", "no"]],
    "both handed back, so neither waits 90 s to expire into a REPRINT",
  );
});

// The 2B review gate (M-B): a refusal whose first send got no answer was applied later by the 5 s retry, but
// nothing then leased the job it put back in line: it waited for the pulse.
test("2B gate: a refusal applied by the retry sets the agent's timer from its answer", async () => {
  const { w, deps } = world();
  const agent = createPrintAgent(deps);
  agent.take(job("late"));
  await advance(w, PRINT_DIRECT_HOLD_MS);
  w.ackAnswers.push(new ApiError("offline", "network", null));
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "the cycle's lease after the hand-back (its ack got no answer)");
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(w.now + PRINT_ACK_RETRY_MS + 2_000).toISOString() });
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.deepEqual(w.acks.map((a) => a.body.sent), ["no", "no"], "re-sent at 5 s, and applied");
  await advance(w, 2_000);
  assert.equal(w.leaseCalls, 2, "the job back in line is leased when its backoff ends, not at the next pulse");
  agent.stop();
});

test("2B: taken jobs wait their turn (first in, first out) and for an open gate; stop drops them unprinted", async () => {
  const { w, deps } = world();
  w.ackAnswers.push(done(false), done(false));
  const agent = createPrintAgent(deps);
  agent.take(job("a"));
  agent.take(job("b"));
  await settle();
  assert.deepEqual(w.prints, [], "a tab that does not drain (yet) prints nothing");
  agent.setGate({ enabled: true, busy: true });
  await settle();
  assert.deepEqual(w.prints, [], "nor while the bridge prints something else");
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["a", "b"], "in the order they came");
  assert.equal(w.leaseCalls, 0, "no lease at all");
  const second = world();
  const stopped = createPrintAgent(second.deps);
  stopped.take(job("c"));
  stopped.stop();
  stopped.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(second.w.prints, [], "a stopped agent prints nothing it held");
  agent.stop();
});

test("2B: a taken job prints even if the printer went off since: the bridge refuses it (sent:'no', never counted)", async () => {
  const { w, deps } = world();
  w.ready = false;
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  agent.take(job("d1"));
  await settle();
  assert.deepEqual(w.acks[0]?.body, { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: PRINTER_NOT_CONNECTED_MESSAGE }, "refused at once, never left to expire into a REPRINT");
  assert.equal(w.leaseCalls, 0, "and the line is not leased while the printer is off");
  agent.stop();
});

test("2B: a failed ack's more:false ends the burst too; with no more field (an older server) the agent leases as in Phase 1", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [{ ...job("b1"), kind: "bill" }], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "needs-confirm", nextAttemptAt: null, more: false });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "a bill that may have printed waits for the cashier; nothing else waits, so no lease");
  agent.kick();
  await settle();
  assert.deepEqual(w.prints, ["b1", "j2"]);
  assert.equal(w.leaseCalls, 3, "the default answer has no more field: lease again, then find the line empty");
  agent.stop();
});

test("2B: directReady is true only while this tab drains, its printer can print, and no refusal holds it", async () => {
  const { w, deps } = world();
  const agent = createPrintAgent(deps);
  assert.equal(agent.directReady(), false, "not draining yet");
  agent.setGate({ enabled: true, busy: true });
  assert.equal(agent.directReady(), true, "a busy bridge only delays the print: the job waits its turn");
  w.ready = false;
  assert.equal(agent.directReady(), false, "a printer that can not print now");
  w.ready = true;
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(agent.directReady(), false, "a refusal holds it, like a lease");
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(agent.directReady(), true, "until the recheck window has passed");
  agent.stop();
  assert.equal(agent.directReady(), false, "a stopped agent");
});

// Phase 2 Session 2E (spec §9.1, §9.2): a Windows PC prints several printers. A refusal (nothing sent) holds that
// printer's own line: the next lease names the others only, and the held one again once its state changes or the
// re-check window passes. A refusal on the device's own printer (every other lane: one printer) holds everything.
function printersWorld(ready: string[], lineOf: (j: LeasedPrintJob) => string) {
  const made = world();
  const asked: string[][] = [];
  const deps = {
    ...made.deps,
    readyPrinters: () => ready,
    lineOf,
    lease: async (printerIds: readonly string[] = []): Promise<PrintLeaseData> => {
      asked.push([...printerIds]);
      return made.deps.lease();
    },
  };
  return { ...made, deps, asked };
}

test("2E: a refusal holds its own Windows printer only: the next lease names the others, and the held one comes back when its state changes", async () => {
  const { w, deps, asked } = printersWorld(["p-bar", "p-kitchen"], (j) => j.printerId ?? "");
  w.leases.push({ jobs: [{ ...job("b1"), printerId: "p-bar" }], retryAt: null }, { jobs: [{ ...job("k1"), printerId: "p-kitchen" }], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() }, { applied: true, status: "printed", nextAttemptAt: null, more: false });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.sent, "no", "the bar printer refused: nothing sent");
  assert.deepEqual(agent.openPrinters(), ["p-kitchen"], "the bar printer is held, the kitchen printer open");
  assert.equal(agent.directReady(), true, "this PC still prints its kitchen slips at once");
  agent.kick();
  await settle();
  assert.deepEqual(asked, [["p-bar", "p-kitchen"], ["p-kitchen"]], "the next lease names the kitchen printer only");
  assert.deepEqual(w.prints, ["b1", "k1"], "the kitchen slip printed while the bar printer was held");
  w.printer = {};
  assert.deepEqual(agent.openPrinters(), ["p-bar", "p-kitchen"], "its state changed (the printer list was read again): both open");
  agent.stop();
});

// Found by the 2D gate's browser run: with another printer open, the refused job's 2 s backoff woke the agent into a
// lease that could only find the open printers' lines, and nothing looked at the held printer when its hold ended.
test("2E: a held printer is looked at again when its hold ends, never at its backoff while another printer is open", async () => {
  const { w, deps, asked } = printersWorld(["p-bar", "p-kitchen"], (j) => j.printerId ?? "");
  w.leases.push({ jobs: [{ ...job("b1"), printerId: "p-bar" }], retryAt: null }, { jobs: [{ ...job("b1", 2), printerId: "p-bar" }], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() }, { applied: true, status: "printed", nextAttemptAt: null, more: false });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.deepEqual(asked, [["p-bar", "p-kitchen"]], "no lease at the 2 s backoff: it could only find the kitchen's line");
  await advance(w, 1);
  assert.deepEqual(asked, [["p-bar", "p-kitchen"], ["p-bar", "p-kitchen"]], "the hold ended: one lease names the bar printer again");
  assert.deepEqual(w.prints, ["b1", "b1"], "and its slip prints, unlabelled: nothing reached paper the first time");
  agent.stop();
});

test("2E: a refusal on this device's own printer (its one printer on every other lane) still holds every line, as before", async () => {
  const { w, deps } = printersWorld(["p-counter"], () => PRINT_DEVICE_LINE);
  w.leases.push({ jobs: [{ ...job("c1"), printerId: "p-counter" }], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(agent.openPrinters(), [], "its one printer refused: nothing is open");
  assert.equal(agent.directReady(), false, "and nothing is asked for at once");
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 1, "no lease until its state changes or the window passes");
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(w.leaseCalls, 2, "the window passed: one lease");
  agent.stop();
});

test("2E: every Windows printer held: no lease at all, and the agent looks again when the first hold ends", async () => {
  const { w, deps } = printersWorld(["p-bar"], (j) => j.printerId ?? "");
  w.leases.push({ jobs: [{ ...job("b1"), printerId: "p-bar" }], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 1, "its only printer is held: a lease would find nothing it may print");
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(w.leaseCalls, 2, "the hold ended: one lease");
  agent.stop();
});

// Session 2E's final review (I-1): Pay Now on a PC that prints two printers. The answer carries the counter's KOT and
// the bar's KOT leased to this tab (alsoLeased) and the bill queued behind the KOT on the counter's line. The KOT's
// ack says more:true, but the bar KOT's held cycle started next and dropped that wish, so the bill waited for the pulse.
test("2E: two KOTs leased to this tab and a bill queued behind the first: the bill is leased right after them, once", async () => {
  const { w, deps, asked } = printersWorld(["p-counter", "p-bar"], (j) => j.printerId ?? "");
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "the gate's own look at the lines");
  w.leases.push({ jobs: [{ ...job("bill"), kind: "bill", printerId: "p-counter" }], retryAt: null });
  w.ackAnswers.push(done(true), done(false), done(false));
  // followPrintJob: the followed KOT, then the one beside it (alsoLeased); then the bill's ref (queued) kicks.
  agent.take({ ...job("kotC"), printerId: "p-counter" });
  agent.take({ ...job("kotB"), printerId: "p-bar" });
  agent.kick();
  await settle();
  assert.deepEqual(w.prints, ["kotC", "kotB", "bill"], "both KOTs at once, then the bill without waiting for the pulse");
  assert.deepEqual(asked.slice(1), [["p-counter", "p-bar"]], "one lease, for the bill, after the held jobs");
  await advance(w, 60_000);
  assert.equal(w.leaseCalls, 2, "and none after the bill's more:false");
  agent.stop();
});

test("2E: the holds: per line, released by a state change or the window, the device line holding every printer", () => {
  let state: object = {};
  let now = T0;
  const holds = createRefusalHolds({ printerState: () => state, now: () => now });
  assert.deepEqual([holds.open(["a", "b"]), holds.mayLease(["a", "b"]), holds.nextEnd()], [["a", "b"], true, null], "nothing held");
  holds.hold("a");
  assert.deepEqual([holds.open(["a", "b"]), holds.mayLease(["a", "b"]), holds.mayLease(["a"])], [["b"], true, false], "a held, b open; with only a: nothing to lease");
  assert.equal(holds.nextEnd(), T0 + PRINT_AGENT_REFUSED_RECHECK_MS, "the soonest end");
  now += PRINT_AGENT_REFUSED_RECHECK_MS;
  assert.deepEqual(holds.open(["a", "b"]), ["a", "b"], "the window passed");
  holds.hold(PRINT_DEVICE_LINE);
  assert.deepEqual([holds.open(["a", "b"]), holds.mayLease([]), holds.holding(PRINT_DEVICE_LINE)], [[], false, true], "the device line holds everything");
  state = {};
  assert.deepEqual([holds.open(["a"]), holds.mayLease([])], [["a"], true], "a state change releases it");
});

test("2B: the seams: the lease header names the draining tab only while its agent says so; a leased job reaches the agent that listens", () => {
  assert.deepEqual(printAgentHeaders("dev-a", false, "tab-1"), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-lease": "tab-1" });
  assert.deepEqual(printAgentHeaders("dev-a", true, null), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-bill": "1" });
  assert.equal(directPrintTab(), null, "no agent registered: no header");
  let ready = true;
  const off = setDirectPrintSource(() => (ready ? "tab-1" : null));
  assert.equal(printAgentHeaders("dev-a")["x-pos-print-lease"], "tab-1", "the default reads the seam");
  ready = false;
  assert.equal(printAgentHeaders("dev-a")["x-pos-print-lease"], undefined, "not ready: no header");
  const offNewer = setDirectPrintSource(() => "tab-2");
  off();
  assert.equal(directPrintTab(), "tab-2", "an old agent's unregister leaves the newer agent's source in place");
  offNewer();
  assert.equal(directPrintTab(), null, "unregistered");
  const offThrowing = setDirectPrintSource(() => {
    throw new Error("boom");
  });
  assert.equal(directPrintTab(), null, "a throwing source is no tab, never a thrown order request");
  offThrowing();
  const got: string[] = [];
  const offLeased = onLeasedJob((j) => got.push(j.id));
  deliverLeasedJob(job("d9"));
  offLeased();
  deliverLeasedJob(job("d10"));
  assert.deepEqual(got, ["d9"], "delivered to the agent that listens, never after it stopped listening");
});

// Phase 2 Session 2C (the 2B gate's ruling R9): one lease may answer one job per line (the device's own line and
// each printer line it writes); on its one local printer they print one by one.
test("2C: a lease that answers several lines' jobs prints them one by one, and a line in backoff sets the timer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("k1"), job("b1")], retryAt: null });
  w.ackAnswers.push(done(false), done(false));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["k1", "b1"], "both printed, in the order they came");
  assert.equal(w.leaseCalls, 1, "no lease between them, and none after: each ack said its line was empty");
  agent.stop();

  const timed = world();
  timed.w.leases.push({ jobs: [job("k2")], retryAt: new Date(T0 + 10_000).toISOString() });
  timed.w.ackAnswers.push(done(false));
  const second = createPrintAgent(timed.deps);
  second.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual([timed.w.prints, timed.w.leaseCalls], [["k2"], 1]);
  await advance(timed.w, 10_000);
  assert.equal(timed.w.leaseCalls, 2, "another line's backoff ends: it is leased then, with no poll");
  second.stop();
});

test("2C: the ready printers ride the direct-print header; the pulse names the device only; a slip routed to several printers is followed by its leased ref", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printAgentHeaders("dev-a", false, "tab-1", [a, b]), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-lease": "tab-1", "x-pos-print-ready": `${a},${b}` });
  assert.equal(printAgentHeaders("dev-a", false, null, [a])["x-pos-print-ready"], undefined, "no draining tab ready: no ready printers either");
  assert.equal(printAgentHeaders("dev-a", false, "tab-1", [])["x-pos-print-ready"], undefined, "simple mode: none");
  setPulsePrintDevice("dev-a");
  const off = setReadyPrintersSource(() => [a]);
  assert.equal(printAgentHeaders("dev-a", false, "tab-1")["x-pos-print-ready"], a, "the default reads the ready seam");
  assert.equal(pulsePrintDeviceQuery(), "?device=dev-a", "the pulse counts every job aimed at the device (the 2C gate's review, I-2): it names only the device");
  off();
  setPulsePrintDevice(null);
  assert.equal(pulsePrintDeviceQuery(), "");
  const leased = { id: "k3", epoch: 1 } as never;
  const order = {
    printJobs: [
      { id: "k1", kind: "kot", targetDeviceId: "dev-k", label: "KOT · Kitchen", status: "queued", printerId: "p-kitchen" },
      { id: "k3", kind: "kot", targetDeviceId: "dev-a", label: "KOT · All stations", status: "leased", printerId: "p-counter", leased },
    ],
  };
  assert.equal(printJobRefOf(order, "kot")?.id, "k3", "the one leased to this tab must reach its agent");
});
