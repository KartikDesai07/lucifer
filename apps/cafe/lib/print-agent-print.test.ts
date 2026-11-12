import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { offlineSlipWithBound } from "@/lib/offline-send";
import { agentPrint, printSlipOnce, type AgentPrintSeams } from "@/lib/print-agent-print";
import { PRINT_AGENT_SLIP_DEADLINE_MS } from "@/lib/print-agent-slip";
import { printersBeingWritten } from "@/lib/print-agent-seams";
import { leaveWhenPrintFree, printHostBusySince, setPrintBusyClock, trackPrintBusy } from "@/lib/print-host-busy";
import { PRINT_HOST_NOT_DRAWN_MESSAGE, type HostPrintDone, type HostPrintResult } from "@/lib/print-host-tickets";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 6 Session 6A, Task 6 (spec §9 rulings 3, 12, 14): the agent's print step and its 140 s bound, the offline
// slip's bound, the agent's gate (the surface), and the one hold over several tracked prints.

const JOB = {
  id: "j1", epoch: 1, kind: "eod", label: "EOD", createdAt: "2026-11-10T00:00:00Z", labels: [], copyIndex: 0, attempt: 1, printerId: "p1",
  payload: { kind: "eod", dateKey: "2026-11-10", dateLabel: "10 Nov" },
} as unknown as LeasedPrintJob;
const EOD_SLIP = { surface: "eod" } as unknown as HostPrintSlip;

type Targets = ReturnType<AgentPrintSeams["targets"]>;
interface Queued { slip: HostPrintSlip; done: HostPrintDone; withdrawn: number }
interface FakeTimer { fn: () => void; ms: number; cleared: boolean }

function fixture(opts: { withdraws?: boolean; ready?: string[]; takeovers?: string[]; targets?: Targets } = {}) {
  const queued: Queued[] = [];
  const timers: FakeTimer[] = [];
  const seams: AgentPrintSeams = {
    queueSlip: (slip, done) => {
      const entry: Queued = { slip, done, withdrawn: 0 };
      queued.push(entry);
      return {
        withdraw: () => {
          entry.withdrawn += 1;
          if (opts.withdraws !== true) return false;
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") });
          return true;
        },
      };
    },
    targets: () => opts.targets ?? {},
    takeovers: () => opts.takeovers ?? [],
    ready: () => opts.ready ?? ["p1"],
    today: () => "2026-11-10",
    setTimer: (fn, ms) => {
      const t: FakeTimer = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as FakeTimer).cleared = true;
    },
  };
  return { seams, queued, timers };
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const errorOf = (r: unknown): unknown => (r as { error: unknown }).error;

test("the 140 s bound withdraws a slip still waiting: sent no, never maybe", async () => {
  const f = fixture({ withdraws: true });
  const p = printSlipOnce(f.seams, JOB, 1);
  assert.equal(f.timers.length, 1, "one deadline timer, started when the slip is queued");
  assert.equal(f.timers[0].ms, PRINT_AGENT_SLIP_DEADLINE_MS, "at the 140 s bound");
  f.timers[0].fn();
  const r = await p;
  assert.equal(f.queued[0].withdrawn, 1, "the bound asked the bridge to withdraw it");
  assert.equal(r.ok, false, "it is not printed");
  assert.equal(printWriteOutcomeOf(errorOf(r)).sent, "no", "a slip never drawn goes back unprinted: sent no");
  assert.equal(printWriteOutcomeOf(errorOf(r)).message, PRINT_HOST_NOT_DRAWN_MESSAGE, "with the ticket's own sentence, not the generic maybe one");
});

test("a slip on its lane at the bound is waited for", async () => {
  const f = fixture({ withdraws: false });
  let answer: unknown = null;
  const p = printSlipOnce(f.seams, JOB, 1).then((r) => {
    answer = r;
    return r;
  });
  f.timers[0].fn();
  await tick();
  assert.equal(f.queued[0].withdrawn, 1, "the bound tried to withdraw");
  assert.equal(answer, null, "no early answer at 140 s: the line never frees under a write");
  f.queued[0].done({ ok: true, written: 1 }); // the write's own result, 30 s later
  assert.deepEqual(await p, { ok: true, written: 1 }, "the ticket's own result passes through unchanged, written included");
  const g = fixture();
  const q = printSlipOnce(g.seams, JOB, 1);
  g.queued[0].done({ ok: false, error: new Error("boom") });
  assert.equal((await q).ok, false, "a failure passes through");
  assert.equal(g.timers[0].cleared, true, "the deadline timer is cleared when the answer comes");
});

test("a job on a printer this device does not print is refused sent no", async () => {
  const f = fixture({ ready: ["other"] });
  const r = await agentPrint(f.seams)(JOB);
  assert.equal(printWriteOutcomeOf(errorOf(r)).sent, "no", "refused sent no");
  assert.equal(f.queued.length, 0, "no slip reached the bridge");
});

test("a payload that cannot become a slip answers sent no at once, as today", async () => {
  const f = fixture();
  const r = await printSlipOnce(f.seams, { ...JOB, payload: null } as unknown as LeasedPrintJob, 1);
  const o = printWriteOutcomeOf(errorOf(r));
  assert.deepEqual([o.sent, o.permanent, o.message], ["no", true, PRINT_HOST_PRINT_FAILED_MESSAGE], "nothing sent, never will be");
  assert.equal(f.queued.length, 0, "nothing queued");
});

test("markPrinterWriting spans the whole job", async () => {
  const f = fixture({ targets: { p1: { paper: "80mm", nativeId: "app-1" } } });
  const p = agentPrint(f.seams)({ ...JOB, copies: 2 });
  assert.equal(printersBeingWritten(), "app-1", "on before the first write");
  f.queued[0].done({ ok: true });
  await tick();
  assert.equal(printersBeingWritten(), "app-1", "still on between the copies");
  f.queued[1].done({ ok: true });
  await p;
  assert.equal(printersBeingWritten(), "", "off after the last copy");
  assert.equal(f.queued.length, 2, "one slip per copy (Task 7 changes this)");
  assert.ok(!("writes" in f.queued[0].slip), "a one-copy slip carries no writes: byte for byte as before");
});

test("a takeover printer's slip is marked takeover, and writes rides the slip only above one", () => {
  const f = fixture({ takeovers: ["p1"] });
  void printSlipOnce(f.seams, JOB, 3);
  assert.equal(f.queued[0].slip.takeover, true, "pictures (Phase 4 §5.3)");
  assert.equal(f.queued[0].slip.writes, 3, "writes > 1 rides the slip");
  const g = fixture();
  void printSlipOnce(g.seams, JOB, 1);
  assert.ok(!("takeover" in g.queued[0].slip) && !("writes" in g.queued[0].slip), "no marker, no writes on a plain one-copy slip");
});

test("an offline slip still waiting at its bound is withdrawn: no", async () => {
  const f = fixture({ withdraws: true });
  const p = offlineSlipWithBound(f.seams.queueSlip, EOD_SLIP, f.seams);
  assert.equal(f.timers[0].ms, PRINT_AGENT_SLIP_DEADLINE_MS, "the same bound");
  f.timers[0].fn();
  assert.equal(await p, "no", "withdrawn: the ticket's own no, never maybe");
});

test("one on its lane is answered by its write", async () => {
  const f = fixture({ withdraws: false });
  let outcome: string | null = null;
  const p = offlineSlipWithBound(f.seams.queueSlip, EOD_SLIP, f.seams).then((o) => {
    outcome = o;
    return o;
  });
  f.timers[0].fn();
  await tick();
  assert.equal(f.queued[0].withdrawn, 1, "the bound tried to withdraw");
  assert.equal(outcome, null, "no maybe at the bound: it is waited for");
  const result: HostPrintResult = { ok: true, written: 1 };
  f.queued[0].done(result);
  assert.equal(await p, "printed", "answered by its own write");
});

test("the agent's gate is the surface", () => {
  const read = (rel: string): string => stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"));
  const drain = read("components/print/PrintHostDrain.tsx");
  assert.ok(drain.includes("usePrintAgent({ enabled: drains, isHost: enabled, printers, deviceId, tabId, busy: drawing, queueSlip: onSlip });"), "the agent waits on the drawing only");
  assert.ok(drain.includes("useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });"), "the self-order lane keeps busy (ruling 22)");
  const hook = read("hooks/use-print-agent.ts");
  assert.ok(hook.includes("print: (job) => trackPrintBusy(print(job)),") && hook.includes("agentPrint({"), "the hook tracks the print step the module builds");
  assert.ok(hook.includes("ready: () => readyRef.current,"), "its printers are the ones this device prints here, not readyNow");
});

test("leaveWhenPrintFree waits for the last line", async () => {
  let now = 1_000;
  const restore = setPrintBusyClock(() => now);
  const resolvers: Array<() => void> = [];
  const work = (): Promise<void> => new Promise((r) => resolvers.push(r));
  const pending: Array<() => void> = [];
  let went = 0;
  try {
    const a = trackPrintBusy(work());
    now = 1_300;
    const b = trackPrintBusy(work());
    assert.equal(printHostBusySince(), 1_000, "one hold: the first one's start while they overlap");
    const cancel = leaveWhenPrintFree(() => { went += 1; }, { setTimer: (run) => { pending.push(run); return pending.length; }, clearTimer: () => undefined });
    assert.equal(went, 0, "not while a line prints");
    resolvers[0]();
    await a;
    pending.splice(0).forEach((run) => run());
    assert.equal(went, 0, "not after the first of two");
    assert.equal(printHostBusySince(), 1_000, "still the first one's start");
    resolvers[1]();
    await b;
    pending.splice(0).forEach((run) => run());
    assert.equal(went, 1, "once, after the second");
    assert.equal(printHostBusySince(), null, "null after the last");
    cancel();
  } finally {
    restore();
  }
});

test("an offline slip's timer is cleared when it answers: no withdraw after", async () => {
  const f = fixture({ withdraws: true });
  const p = offlineSlipWithBound(f.seams.queueSlip, EOD_SLIP, f.seams);
  f.queued[0].done({ ok: true, written: 1 });
  assert.equal(await p, "printed", "answered by its own end");
  assert.equal(f.timers[0].cleared, true, "the bound's timer was cleared");
});

test("agentPrint end to end: a withdrawn first copy is no; a withdrawn second copy is maybe", async () => {
  const gone: HostPrintResult = { ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") };
  const a = fixture();
  const first = agentPrint(a.seams)({ ...JOB, copies: 2 });
  a.queued[0].done(gone);
  const r1 = await first;
  const o1 = printWriteOutcomeOf(errorOf(r1));
  assert.deepEqual([r1.ok, o1.sent, o1.message], [false, "no", PRINT_HOST_NOT_DRAWN_MESSAGE], "copy 1 never drawn: sent no, with the ticket's sentence");
  assert.equal(a.queued.length, 1, "no second copy after a failed first");
  const b = fixture();
  const second = agentPrint(b.seams)({ ...JOB, copies: 2 });
  b.queued[0].done({ ok: true });
  await tick();
  b.queued[1].done(gone);
  const r2 = await second;
  assert.deepEqual([r2.ok, printWriteOutcomeOf(errorOf(r2)).sent], [false, "maybe"], "copy 1 is on paper: a withdrawn copy 2 is maybe");
});
