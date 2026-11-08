// P2 follow-ups F1 (the final review): a slip leased to this tab that waits in the print agent's held list (the host
// bridge still busy, or a lease's extra jobs) is print work, so no document load starts under it. Only while the agent
// drains and has not stopped: a disabled agent's held slip cannot print here and would make a hold that never ends.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import { PRINT_DIRECT_HOLD_MS, createPrintAgent, type PendingPrintAck, type PrintAgent, type PrintAgentAckBody, type PrintAgentResult } from "@/lib/print-agent";
import { addPrintBusySource, holdPrintBusy, leaveWhenPrintFree, printHostBusy, printHostBusySince, setPrintBusyClock, trackPrintBusy } from "@/lib/print-host-busy";

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

// The minimum of lib/print-agent.test.ts's fakes. The print is tracked like the page's (hooks/use-print-agent.ts), and
// each print records what the agent and print-busy said the moment it started.
function world() {
  const w = {
    now: T0,
    leases: [] as PrintLeaseData[],
    acks: [] as { id: string; body: PrintAgentAckBody }[],
    prints: [] as string[],
    atPrint: [] as { holds: boolean | null; busy: boolean }[],
    hang: false,
    finish: [] as Array<(result: PrintAgentResult) => void>,
    pending: [] as PendingPrintAck[],
    agent: null as PrintAgent | null,
  };
  const deps = {
    deviceId: "dev-a",
    lease: async (): Promise<PrintLeaseData> => w.leases.shift() ?? { jobs: [], retryAt: null },
    ack: async (id: string, body: PrintAgentAckBody): Promise<PrintAckData> => {
      w.acks.push({ id, body });
      return { applied: true, status: body.outcome === "printed" ? "printed" : "queued", nextAttemptAt: null };
    },
    print: (j: LeasedPrintJob): Promise<PrintAgentResult> => {
      w.prints.push(j.id);
      const printing = trackPrintBusy(new Promise<PrintAgentResult>((resolve) => (w.hang ? void w.finish.push(resolve) : resolve({ ok: true }))));
      w.atPrint.push({ holds: w.agent?.holdsJob() ?? null, busy: printHostBusy() });
      return printing;
    },
    printerReady: () => true,
    printerState: () => w,
    readPending: () => [...w.pending],
    writePending: (entries: PendingPrintAck[]) => void (w.pending = [...entries]),
    now: () => w.now,
    setTimer: () => 0,
    clearTimer: () => undefined,
  };
  const agent = createPrintAgent(deps);
  w.agent = agent;
  return { w, agent };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

test("a slip taken while the bridge is busy is held: print is busy through the agent's source until its print starts", async () => {
  const { w, agent } = world();
  agent.setGate({ enabled: true, busy: true });
  const off = addPrintBusySource(() => agent.holdsJob());
  try {
    assert.equal(agent.holdsJob(), false, "nothing held at first");
    assert.equal(printHostBusy(), false, "nothing held: print is free");
    agent.take(job("j1"));
    await settle();
    assert.deepEqual(w.prints, [], "the bridge is busy: the slip waits");
    assert.equal(agent.holdsJob(), true, "the slip leased to this tab waits in the agent");
    assert.equal(printHostBusy(), true, "so print is busy through the registered source");
    let went = 0;
    const cancel = leaveWhenPrintFree(() => void (went += 1), { setTimer: () => 1, clearTimer: () => undefined });
    assert.equal(went, 0, "a document load's gate waits while the slip waits");
    cancel();
    agent.setGate({ enabled: true, busy: false });
    await settle();
    assert.deepEqual(w.prints, ["j1"], "the bridge free: it prints");
    assert.deepEqual(w.atPrint[0], { holds: false, busy: true }, "at its print the hold hands over to the tracked print");
    assert.equal(agent.holdsJob(), false, "printed: nothing held");
    assert.equal(printHostBusy(), false, "print is free again");
  } finally {
    off();
    agent.stop();
  }
});

test("a lease's extra jobs are held while the first prints; the hold ends when the last one's print starts", async () => {
  const { w, agent } = world();
  w.hang = true;
  w.leases.push({ jobs: [job("a"), job("b")], retryAt: null });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["a"], "the first job prints");
  assert.equal(agent.holdsJob(), true, "the lease's second job waits its turn in the agent");
  w.finish.shift()?.({ ok: true });
  await settle();
  assert.deepEqual(w.prints, ["a", "b"], "then the second prints");
  assert.deepEqual(w.atPrint[1], { holds: false, busy: true }, "its print takes over the hold");
  assert.equal(agent.holdsJob(), false, "nothing held while the last one prints");
  w.finish.shift()?.({ ok: true });
  await settle();
  agent.stop();
});

test("a held slip handed back after PRINT_DIRECT_HOLD_MS ends the hold, unprinted", async () => {
  const { w, agent } = world();
  agent.setGate({ enabled: true, busy: true });
  agent.take(job("j1"));
  await settle();
  assert.equal(agent.holdsJob(), true, "held while the bridge is busy");
  w.now += PRINT_DIRECT_HOLD_MS;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, [], "held too long: never printed");
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.sent]), [["j1", "no"]], "handed back to its line (sent: no)");
  assert.equal(agent.holdsJob(), false, "handed back: no hold");
  agent.stop();
});

test("stop() hands a held slip back and ends the hold", async () => {
  const { agent } = world();
  agent.setGate({ enabled: true, busy: true });
  const off = addPrintBusySource(() => agent.holdsJob());
  try {
    agent.take(job("j1"));
    await settle();
    assert.equal(printHostBusy(), true, "held: busy");
    agent.stop();
    assert.equal(agent.holdsJob(), false, "stopped: no hold");
    assert.equal(printHostBusy(), false, "print is free once stopped");
  } finally {
    off();
  }
});

test("ruling F1: a disabled agent's held slip is no hold (it cannot print here); enabled again, it is", async () => {
  const { w, agent } = world();
  agent.setGate({ enabled: false, busy: false });
  agent.take(job("j1"));
  await settle();
  assert.deepEqual(w.prints, [], "disabled: the slip stays held, unprinted");
  assert.equal(agent.holdsJob(), false, "a disabled agent reports no hold");
  agent.setGate({ enabled: true, busy: true });
  assert.equal(agent.holdsJob(), true, "enabled (the bridge busy): the same held slip is a hold");
  agent.stop();
});

test("sources: a throwing source counts as not busy, another still counts, unregistering twice is harmless", () => {
  const offThrowing = addPrintBusySource(() => {
    throw new Error("gone");
  });
  try {
    assert.equal(printHostBusy(), false, "a source that throws counts as not busy");
    let holding = true;
    const off = addPrintBusySource(() => holding);
    assert.equal(printHostBusy(), true, "another source still counts beside a throwing one");
    holding = false;
    assert.equal(printHostBusy(), false, "read at every call: the source let go");
    holding = true;
    off();
    off();
    assert.equal(printHostBusy(), false, "an unregistered source is no longer read; twice is harmless");
  } finally {
    offThrowing();
  }
});

test("the hold clock starts on the first read after a source turns true and runs on through a hand-over", async () => {
  let t = 1000;
  const restore = setPrintBusyClock(() => t);
  let holding = false;
  const off = addPrintBusySource(() => holding);
  try {
    assert.equal(printHostBusySince(), null, "the source says free: no hold");
    holding = true;
    t = 3000;
    assert.equal(printHostBusySince(), 3000, "a pull source has no change event: the first read after it turned true starts the hold");
    t = 5000;
    assert.equal(printHostBusySince(), 3000, "kept while it holds");
    let release!: (value: string) => void;
    const tracked = trackPrintBusy(new Promise<string>((resolve) => (release = resolve)));
    holding = false;
    t = 7000;
    assert.equal(printHostBusySince(), 3000, "the held slip handing over to its tracked print is one hold");
    release("ok");
    await tracked;
    assert.equal(printHostBusySince(), null, "free again");
    const bridge = Symbol("bridge");
    holdPrintBusy(bridge, true);
    holding = true;
    holdPrintBusy(bridge, false);
    assert.equal(printHostBusySince(), 7000, "a holder handing over to the source is one hold too");
    holding = false;
    assert.equal(printHostBusySince(), null, "the source let go: free");
  } finally {
    off();
    restore();
  }
});
