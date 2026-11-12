import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_AGENT_REFUSED_RECHECK_MS, type PrintAckData } from "@pos/shared/print-agent-wire";
import { PRINT_AGENT_QUIET_AFTER_ACK_MS, PRINT_DIRECT_HOLD_MS, createPrintAgent } from "@/lib/print-agent";
import { PRINT_AGENT_HOLD_END_MARGIN_MS, PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import { PRINT_HOST_NOT_DRAWN_MESSAGE } from "@/lib/print-host-tickets";
import { job, printed, queuedAt, rig, settle } from "@/lib/print-lines-rig";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 6 Task 5 (spec §9 rulings 15-21): the agent's rules per printer line, continued from
// lib/print-lines-rules.test.ts (split for the 300-line budget), on the same rig (lib/print-lines-rig.ts).

test("the quiet after an empty ack stays device-wide; a nudge while a line is in flight leases nothing", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  await t.finish("K1"); // K's empty ack: the quiet
  t.agent.nudge();
  await settle();
  assert.deepEqual(t.r.asked, [], "a status nudge within 500 ms of K's empty ack, B idle: no lease");
  t.agent.kick();
  await settle();
  assert.equal(t.r.asked.length, 1, "a kick within it leases");
  t.r.now += PRINT_AGENT_QUIET_AFTER_ACK_MS;
  t.agent.take(job("B1"));
  t.agent.nudge();
  await settle();
  assert.equal(t.r.asked.length, 1, "past the quiet, a nudge while B1 is in flight leases nothing");
});

test("a held job older than PRINT_DIRECT_HOLD_MS is handed back, per line", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  t.agent.take(job("K2"));
  await t.drawn();
  t.agent.take(job("B1"));
  await t.drawn();
  await t.finish("B1");
  t.r.now += PRINT_DIRECT_HOLD_MS;
  t.agent.nudge();
  await settle();
  assert.deepEqual(t.r.prints, ["K1", "B1"], "B1 printed beside K1; K2 never");
  assert.deepEqual(t.r.acks, ["B1:printed", "K2:failed:no"], "K2, held behind K1 past the bound, is handed back alone");
  assert.equal(t.r.bodies.at(-1)?.error, "held too long on this device", "as held too long");
});

test("stop hands back every line's held jobs; jobs in flight finish and ack", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  t.agent.take(job("K2"));
  await t.drawn();
  t.agent.take(job("B1"));
  t.agent.take(job("B2"));
  await t.drawn();
  t.agent.stop();
  await settle();
  assert.deepEqual(t.r.acks, ["K2:failed:no", "B2:failed:no"], "both lines' held jobs handed back at once");
  await t.finish("K1");
  await t.finish("B1");
  assert.deepEqual(t.r.acks.slice(2), ["K1:printed", "B1:printed"], "the jobs in flight finish and ack");
  assert.deepEqual(t.r.prints, ["K1", "B1"], "nothing else printed");
});

test("a job delivered twice prints once, whichever line's turn it is", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  t.agent.take(job("K1")); // while it prints
  t.agent.take(job("K2"));
  t.agent.take(job("K2")); // while it is held
  await t.drawn();
  t.agent.take(job("B1"));
  await t.finish("K1");
  t.agent.take(job("K2")); // while it prints
  await t.finish("B1");
  t.agent.take(job("B1")); // printed and acked
  await t.finish("K2");
  assert.deepEqual(t.r.prints, ["K1", "B1", "K2"], "each once, one per line");
});

test("a refusal holds its own line only; the device line's hold stops every line", async () => {
  const t = rig();
  await t.start();
  const refused = { ok: false as const, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) };
  t.agent.take(job("K1"));
  t.r.answers.set("K1", queuedAt(t.r.now + 2_000));
  await settle();
  await t.finish("K1", refused);
  assert.deepEqual(t.agent.openPrinters(), ["B", "D"], "K's refusal holds K only");
  t.agent.kick("B");
  await settle();
  assert.deepEqual(t.r.asked, [["B", "D"]], "B is leased");
  t.agent.take(job("J1", PRINT_DEVICE_LINE));
  t.r.answers.set("J1", queuedAt(t.r.now + 2_000));
  await settle();
  await t.finish("J1", refused);
  assert.deepEqual([t.agent.openPrinters(), t.agent.directReady()], [[], false], "the device line's refusal holds every line");
  t.agent.kick("B");
  t.agent.kick();
  await settle();
  assert.equal(t.r.asked.length, 1, "no lease at all");
});

test("a cleared slip's answer on one line changes nothing on another: B's ack and lease as without it", async () => {
  const round = async (kAnswer: PrintAckData) => {
    const t = rig();
    await t.start();
    t.agent.take(job("K1"));
    await t.drawn();
    t.agent.take(job("B1"));
    await t.drawn();
    t.r.answers.set("K1", kAnswer);
    t.r.answers.set("B1", printed(true));
    await t.finish("K1");
    await t.finish("B1");
    return { acks: t.r.acks.filter((a) => a.startsWith("B")), asked: t.r.asked };
  };
  const cleared = await round({ applied: true, status: "dismissed", nextAttemptAt: null, more: false });
  assert.deepEqual(cleared, { acks: ["B1:printed"], asked: [["K", "B", "D"]] }, "K's slip cleared after this try: B's ack, then B's more leases");
  assert.deepEqual(cleared, await round(printed(false)), "exactly as with K simply printed");
});

test("a printed ack is kept before it is sent, per line; a new agent on the same store sends both first", async () => {
  const t = rig();
  await t.start();
  t.r.down = true;
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.take(job("B1"));
  await t.drawn();
  await t.finish("K1");
  await t.finish("B1");
  assert.deepEqual(t.r.pending.map((e) => e.id).sort(), ["B1", "K1"], "both kept while unanswered");
  const sends = t.r.acks.filter((a) => a.endsWith(":printed")).length;
  assert.equal(t.r.kept.length, sends, `each printed ack was in the store when it went out (${t.r.kept.length} of ${sends})`);
  t.agent.stop();
  t.r.down = false;
  t.r.acks = [];
  const next = createPrintAgent(t.deps);
  await next.flushAcks();
  assert.deepEqual([...t.r.acks].sort(), ["B1:printed", "K1:printed"], "the next page sends both first");
  assert.deepEqual(t.r.pending, [], "answered: cleared");
  next.stop();
});

// Session 2C's lease of one job per line (lib/print-agent.test.ts keeps the device-line case: one by one, ruling 16).
test("a lease that answers several printer lines' jobs prints one per line, as the surface frees", async () => {
  const t = rig();
  await t.start();
  t.r.leases.push([job("K1"), job("B1"), job("D1")]);
  t.agent.kick();
  await settle();
  assert.deepEqual(t.r.prints, ["K1"], "the first starts at once; the others wait for the surface");
  await t.drawn();
  await t.drawn();
  assert.deepEqual(t.r.prints, ["K1", "B1", "D1"], "one more at each opening, while K1 still writes");
  assert.equal(t.r.open.size, 3, "three lines in flight, one job each");
});

// The Task 5 review (I-1): a job back in line holds its line until its own nextAttemptAt (today's cycle dropped a kick
// that landed meanwhile: it "would only find it not due"); the line's named timer leases it then.
test("a line's own want ends when its job goes back in line: no lease before its backoff ends, its line leased then", async () => {
  for (const error of [new Error(PRINTER_WRITE_FAILED_MESSAGE), new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no")]) {
    const t = rig();
    await t.start();
    t.agent.take(job("K1"));
    await t.drawn();
    t.agent.kick("K", "K2"); // K2's frame while K1 writes: K wants
    await settle();
    t.r.answers.set("K1", queuedAt(t.r.now + 5_000));
    await t.finish("K1", { ok: false, error });
    await t.advance(4_999);
    assert.deepEqual(t.r.asked, [], `${error.message}: K1 is back at the head of K's line, not due: no lease`);
    await t.advance(1);
    assert.deepEqual(t.r.asked, [["K", "B", "D"]], `${error.message}: its backoff ends: K is leased (K1 again, then K2)`);
  }
});

// The Task 5 review (m-2): a refusal answered with no retry time ("clear after this try") still holds its line; a want on
// that line is looked at when the hold ends, never left to the pulse.
test("a want on a line its refusal holds is leased when the hold ends, even when the answer names no retry", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.kick("K", "K2");
  await settle();
  t.r.answers.set("K1", { applied: true, status: "dismissed", nextAttemptAt: null, more: true });
  await t.finish("K1", { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  assert.deepEqual(t.agent.openPrinters(), ["B", "D"], "K's refusal holds K");
  await t.advance(PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.deepEqual(t.r.asked, [], "nothing while the hold lasts");
  await t.advance(PRINT_AGENT_HOLD_END_MARGIN_MS);
  assert.deepEqual(t.r.asked, [["K", "B", "D"]], "the hold ends: K's want leases it");
});

// The Task 5 review (m-3): today's cycle printed its lease's first job even when the tab stopped draining meanwhile (the
// drain lock follows the printer); its extras stayed held. A held job left to expire would come back as a REPRINT.
test("a lease answered after the tab stopped draining still prints its first job, as today; the extra stays held", async () => {
  const t = rig();
  await t.start();
  t.r.leases.push([job("K1"), job("B1")]);
  t.agent.kick();
  t.agent.setGate({ enabled: false, busy: false }); // the drain lock lost while the lease is on its way
  await settle();
  assert.deepEqual(t.r.prints, ["K1"], "the lease's first job prints");
  await t.finish("K1");
  assert.deepEqual([t.r.acks, t.r.prints], [["K1:printed"], ["K1"]], "and acks; B1 stays held");
  t.agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(t.r.prints, ["K1", "B1"], "draining again, the held extra prints");
});

// The Task 5 re-review (m-3's pick): the lease's first job, when the tab stopped draining meanwhile, follows ruling 16 too.
test("a lease answered after the tab stopped draining starts nothing while a device-line job of it must wait; that job starts first", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn(); // K1 writes
  t.r.leases.push([job("J1", PRINT_DEVICE_LINE), job("B1")]);
  t.agent.kick("B");
  t.agent.setGate({ enabled: false, busy: false }); // the drain lock lost while the lease is on its way
  await settle();
  assert.deepEqual(t.r.prints, ["K1"], "J1 waits for K1 (the device line runs alone), and B1 never starts ahead of it");
  await t.finish("K1");
  t.agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(t.r.prints, ["K1", "J1"], "draining again with no line in flight: J1 starts first, alone");
  await t.finish("J1");
  assert.deepEqual(t.r.prints, ["K1", "J1", "B1"], "then B1");
});

test("a lease answered after the tab stopped draining starts none of its jobs while an older device-line job waits here", async () => {
  const t = rig();
  t.agent.stop(); // this test's agent takes a device-line job while its lease is on the way
  let self: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...t.deps,
    lease: (ids) => {
      if (t.r.leases.length > 0) {
        self?.setGate({ enabled: false, busy: false }); // the drain lock lost
        self?.take(job("J0", PRINT_DEVICE_LINE)); // a device-line job leased to this tab arrives meanwhile
      }
      return t.deps.lease(ids);
    },
  });
  self = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  t.r.leases.push([job("B1")]);
  agent.kick("B");
  await settle();
  assert.deepEqual(t.r.prints, [], "J0 waits here (ruling 16), so B1 does not start ahead of it");
  agent.stop();
});

// The final review (I-2): only in simple mode does a job going back drop an unnamed kick kept meanwhile; with printer
// lines the others may hold that kick's job (ruling 20).
test("with printer lines an unnamed kick kept while a line was busy still leases when that line's job goes back", async () => {
  const t = rig();
  await t.start();
  t.agent.take(job("K1"));
  await t.drawn();
  t.agent.kick(); // the pulse while K1 writes
  await settle();
  t.r.answers.set("K1", queuedAt(t.r.now + 5_000));
  await t.finish("K1", { ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  assert.deepEqual(t.r.asked, [["K", "B", "D"]], "the kick leases the lines at once");
});
