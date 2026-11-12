import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_AGENT_REFUSED_RECHECK_MS, type PrintAckData } from "@pos/shared/print-agent-wire";
import { PRINT_DIRECT_HOLD_MS } from "@/lib/print-agent";
import { PRINT_AGENT_HOLD_END_MARGIN_MS, createRefusalHolds } from "@/lib/print-agent-holds";
import { PRINT_HOST_NOT_DRAWN_MESSAGE } from "@/lib/print-host-tickets";
import { ApiError } from "@/lib/api-client";
import { createAckFlusher } from "@/lib/print-agent-acks";
import type { PendingPrintAck, PrintAgentDeps } from "@/lib/print-agent-types";
import { runLineOnce, type LineJobEnd } from "@/lib/print-line-job";
import { RIG_T0, job, printed, queuedAt, rig, settle } from "@/lib/print-lines-rig";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 6 Task 5 (spec §9 rulings 14-21, 25): the agent's rules per printer line, one by one, on the rig
// (lib/print-lines-rig.ts: three printer lines K, B, D; each print hangs until finished; the test plays the surface).
// The rest: lib/print-lines-rules-2.test.ts; whole scenarios: lib/print-lines.test.ts.

test("a slip withdrawn undrawn holds no line: acked failed sent no, never a slip refusal, its line leased again at its backoff", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await settle();
  for (const epoch of [1, 2]) {
    t.r.answers.set("K1", queuedAt(t.r.now + 2_000));
    await t.finish("K1", { ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") });
    assert.deepEqual(t.r.bodies.at(-1), { deviceId: "dev-r", epoch, outcome: "failed", sent: "no", error: PRINT_HOST_NOT_DRAWN_MESSAGE }, `epoch ${epoch}: acked failed, sent no, never permanent`);
    assert.deepEqual(t.agent.openPrinters(), ["K", "B", "D"], `epoch ${epoch}: no hold on K's line`);
    t.r.leases.push([job("K1", "K", epoch + 1)]);
    await t.advance(2_000);
    assert.deepEqual(t.r.asked.at(-1), ["K", "B", "D"], `epoch ${epoch}: its backoff's end leases K's line again (asked ${JSON.stringify(t.r.asked)})`);
  }
});

test("a line's ack with more leases at once, naming every free open line", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  t.agent.take(job("B1"));
  await t.drawn(); // K1 drawn: B1 starts at this opening
  await t.drawn(); // B1 drawn: it writes
  assert.deepEqual(t.r.prints, ["K1", "B1"], "one slip per line in flight");
  t.r.answers.set("K1", printed(true));
  t.r.leases.push([job("K2")]);
  await t.finish("K1");
  assert.deepEqual(t.r.asked, [["K", "D"]], "K's more leases at once, naming K and the idle D, never B (still writing)");
  assert.deepEqual(t.r.prints, ["K1", "B1", "K2"], "and K2 starts");
});

test("a kick while no open line is free leases once, when a line frees", async () => {
  const t = rig();
  await t.start();
  for (const id of ["K1", "B1", "D1"]) {
    t.agent.take(job(id));
    await t.drawn();
  }
  t.agent.kick();
  t.agent.kick();
  await settle();
  assert.deepEqual(t.r.asked, [], "every open line is busy: no lease");
  await t.finish("K1");
  assert.deepEqual(t.r.asked, [["K"]], "one lease as K frees, naming the lines free then");
  await t.finish("B1");
  await t.finish("D1");
  assert.deepEqual(t.r.asked, [["K"]], "and no other");
});

test("a lease decided waits for nothing new: a line's end and a hand-back during its kept-acks flush make one lease; two hand-backs in one scan make one", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.take(job("B1"));
  await t.drawn();
  t.gate(true); // the surface draws something else: D1 and B2 are held
  t.agent.take(job("D1"));
  t.r.now += 10;
  t.agent.take(job("B2"));
  let release: () => void = () => undefined;
  t.r.pending = [{ id: "old", epoch: 1, at: t.r.now }];
  t.r.answers.set("old", new Promise<PrintAckData>((resolve) => (release = () => resolve(printed(false)))));
  t.r.now += PRINT_DIRECT_HOLD_MS - 10;
  t.gate(false); // the opening: D1 is handed back, a wish; the lease is decided, its flush waits for "old"
  await settle();
  t.r.answers.set("K1", { applied: true, status: "failed", nextAttemptAt: null, more: true });
  await t.finish("K1", { ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) }); // K's line ends, wanting more
  t.r.now += 10;
  t.agent.nudge(); // B2 is handed back (B1 still writes: B wants)
  await settle();
  assert.deepEqual(t.r.asked, [], "the lease waits for the kept acks");
  release();
  await settle();
  assert.deepEqual(t.r.asked, [["K", "D"]], "one lease, naming the lines free by then (K freed during the flush; B still writes)");
  assert.ok(t.r.acks.includes("D1:failed:no") && t.r.acks.includes("B2:failed:no"), `both hand-backs went first: ${t.r.acks.join(", ")}`);

  const u = rig();
  await u.start();
  u.gate(true);
  u.agent.take(job("B1"));
  u.agent.take(job("D1"));
  u.r.now += PRINT_DIRECT_HOLD_MS;
  u.gate(false);
  await settle();
  assert.deepEqual(u.r.acks, ["B1:failed:no", "D1:failed:no"], "both handed back, before the lease");
  assert.deepEqual(u.r.asked, [["K", "B", "D"]], "two hand-backs in one scan: one lease");
});

test("the timer kicks the lines whose backoff set it by name: K leased at its time while B still writes", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.take(job("B1"));
  await t.drawn();
  t.r.answers.set("K1", queuedAt(t.r.now + 5_000));
  await t.finish("K1", { ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  t.r.leases.push([job("K1", "K", 2)]);
  await t.advance(4_999);
  assert.deepEqual(t.r.asked, [], "nothing before K's backoff ends");
  await t.advance(1);
  assert.deepEqual(t.r.asked, [["K", "D"]], "K's backoff ends: its line is leased then, not after B");
  assert.ok(t.r.open.has("B1"), "B1 still writes");
  assert.deepEqual(t.r.prints, ["K1", "B1", "K1"], "the retry prints at once");
});

test("a line with a held job is never leased", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  t.agent.take(job("K2"));
  await t.drawn();
  assert.deepEqual(t.r.prints, ["K1"], "K2 waits behind K1 on its line");
  t.agent.kick("B");
  await settle();
  assert.deepEqual(t.r.asked, [["B", "D"]], "B's kick leases the free lines; K, holding a job, is not named");
  await t.finish("K1");
  assert.deepEqual([t.r.prints, t.r.asked], [["K1", "K2"], [["B", "D"]]], "K2 starts when K1 ends; still no lease names K");
});

test("a failure's backoff holds only its line; another line's kick is kept: B leased at once while K's refusal is acked", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  let answer: (data: PrintAckData) => void = () => undefined;
  t.r.answers.set("K1", new Promise<PrintAckData>((resolve) => (answer = resolve)));
  await t.finish("K1", { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  t.agent.kick("B");
  await settle();
  assert.deepEqual(t.r.asked, [["B", "D"]], "B's kick leases at once (K's refusal holds K only)");
  answer(queuedAt(t.r.now + 2_000));
  await settle();
  await t.advance(PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.deepEqual(t.r.asked, [["B", "D"]], "K waits for its own hold, not its 2 s backoff");
  await t.advance(PRINT_AGENT_HOLD_END_MARGIN_MS + 1);
  assert.deepEqual(t.r.asked.at(-1), ["K", "B", "D"], "its hold ends: K is leased again");
});

// The final review (I-1(a)): a line ends the moment its printed ack is answered, inside the flush, so a lease that waits
// on that same flush names it, whichever of the two waited on the flush first.
test("a line whose ack a lease's kept-acks flush answers is free and named in that one lease, whichever waited first", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.take(job("B1"));
  await t.drawn();
  let release: () => void = () => undefined;
  t.r.pending = [{ id: "old", epoch: 1, at: t.r.now }];
  t.r.answers.set("old", new Promise<PrintAckData>((resolve) => (release = () => resolve(printed(false)))));
  t.agent.kick("D"); // a lease is decided: its flush waits on "old"
  await settle();
  t.r.answers.set("K1", printed(true));
  await t.finish("K1"); // K1's ack joins that flush after the lease waited on it
  assert.deepEqual(t.r.asked, [], "the lease waits for its flush");
  release();
  await settle();
  assert.deepEqual(t.r.asked, [["K", "D"]], "one lease names K (its ack answered with more) and D; B still writes");
});

// Phase 6 Session 6B: the 6A final review's three minors.
test("a requeued wake set while a lease is in flight survives that lease's answer (6B amendment n-1)", async () => {
  const t = rig();
  await t.start();
  const answered = t.deps.lease;
  let answerLease: () => void = () => undefined;
  t.deps.lease = (ids) =>
    new Promise((resolve) => {
      t.r.asked.push([...ids]);
      answerLease = () => resolve({ jobs: [], retryAt: null });
    });
  t.agent.kick();
  await settle();
  assert.deepEqual(t.r.asked, [["K", "B", "D"]], "the lease is sent and hangs");
  t.r.pending = [{ id: "K9", epoch: 1, at: t.r.now, fail: { deviceId: "dev-r", epoch: 1, outcome: "failed", sent: "no", error: "a refusal kept with no answer" } }];
  t.r.answers.set("K9", queuedAt(t.r.now + 2_000));
  await t.agent.flushAcks();
  t.deps.lease = answered;
  answerLease();
  await settle();
  await t.advance(1_999);
  assert.equal(t.r.asked.length, 1, "nothing before the backoff ends");
  await t.advance(1);
  assert.deepEqual(t.r.asked, [["K", "B", "D"], ["K", "B", "D"]], "the backoff's end leases again: the wake set while the lease was in flight survived its answer");
});

test("a lease that gets no answer keeps the unnamed wake it was sent with (6B amendment n-1)", async () => {
  const t = rig();
  await t.start();
  const answered = t.deps.lease;
  let call = 0;
  t.deps.lease = async (ids) => {
    call += 1;
    if (call === 1) {
      t.r.asked.push([...ids]);
      return { jobs: [], retryAt: new Date(t.r.now + 5_000).toISOString() };
    }
    if (call === 2) {
      t.r.asked.push([...ids]);
      throw new ApiError("offline", "network", null);
    }
    return answered(ids);
  };
  t.agent.kick();
  await settle();
  t.r.now += 1_000;
  t.agent.kick();
  await settle();
  assert.equal(t.r.asked.length, 2, "two leases were sent");
  await t.advance(3_999);
  assert.equal(t.r.asked.length, 2, "nothing before the retryAt");
  await t.advance(1);
  assert.equal(t.r.asked.length, 3, "the retryAt wake survived the lease that got no answer; not pushed to the 30 s re-check");
});

test("a throw in a line's end heard inside the ack flush never stops it: the ack is forgotten, the line ends once (6B amendment n-3)", async () => {
  let pending: PendingPrintAck[] = [];
  const sent: string[] = [];
  const ends: LineJobEnd[] = [];
  let pumps = 0;
  const onAnswer = new Map<string, (answer: PrintAckData) => void>();
  const deps = {
    deviceId: "dev-n3",
    ack: async (id: string) => {
      sent.push(id);
      return printed(false);
    },
    readPending: () => [...pending],
    writePending: (entries: PendingPrintAck[]) => void (pending = [...entries]),
    now: () => RIG_T0,
    setTimer: () => 0,
    clearTimer: () => undefined,
    print: async () => ({ ok: true as const }),
    printerReady: () => true,
    printerState: () => null,
  } as unknown as PrintAgentDeps;
  const acks = createAckFlusher(deps, { stopped: () => false, answered: (key, answer) => onAnswer.get(key)?.(answer), requeued: () => undefined });
  const ctx = { deps, acks, answers: new Map(), holds: createRefusalHolds(deps), slipRefusals: new Map(), lineOf: () => "K", hold: () => undefined };
  runLineOnce(job("K1"), ctx, onAnswer, (end) => {
    ends.push(end);
    if (ends.length === 1) throw new Error("a line end that throws");
  }, () => void (pumps += 1));
  await settle();
  await settle();
  assert.deepEqual(sent, ["K1"], "the ack is sent once");
  assert.deepEqual(pending, [], "the ack is forgotten, never sent twice");
  assert.deepEqual(ends, [{ kind: "printed", more: false }], "the line ended once, by the answer");
  assert.equal(pumps, 1, "the run's own return still pumps");
});

test("a lease that gets no answer after stop() arms no timer (6B amendment n-1)", async () => {
  const t = rig();
  await t.start();
  const answered = t.deps.lease;
  let call = 0;
  let failLease: (error: unknown) => void = () => undefined;
  t.deps.lease = (ids) => {
    call += 1;
    t.r.asked.push([...ids]);
    if (call === 1) return Promise.resolve({ jobs: [], retryAt: new Date(t.r.now + 5_000).toISOString() });
    if (call === 2) return new Promise((_resolve, reject) => void (failLease = reject));
    return answered(ids);
  };
  t.agent.kick();
  await settle();
  t.r.now += 1_000;
  t.agent.kick();
  await settle();
  assert.equal(t.r.asked.length, 2, "the second lease is sent and hangs");
  t.agent.stop();
  failLease(new ApiError("offline", "network", null));
  await settle();
  assert.deepEqual(t.r.timers, [], "no timer is left on a stopped agent");
  await t.advance(PRINT_AGENT_REFUSED_RECHECK_MS + 10_000);
  assert.equal(t.r.asked.length, 2, "no lease after the stop, at the old retryAt or the re-check");
});
