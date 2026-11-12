import { test } from "node:test";
import assert from "node:assert/strict";

import { SCENARIOS, SCENARIO_JOBS, TODAY, createLinesWorld, type LinesWorld, type PaperRecord, type ScenarioName, type WorldOptions } from "@/lib/print-lines-world";

// Printing Phase 6 Task 5 (spec §9 rulings 14-20, 25, 26): the agent runs one job per printer line. The scenarios (the
// nine, and three from the final review) on a two-step device (lib/print-lines-world.ts), each pinned beside TODAY
// (today's agent on a one-step surface, lib/print-lines-today.test.ts). Only the slow-write and the even backlog may cost
// more (ruling 25, P6-3); the late frames and the stuck printer cost less (ruling 26). Then the rules a whole world shows
// best (lib/print-lines-rules.test.ts: the rest).

/** The world's own timings (lib/print-lines-world.ts): one draw, an ack's answer. */
const DRAW_MS = 550;
const ACK_MS = 20;

const PHASE_6: Record<ScenarioName, { leases: number; acks: number; why: string }> = {
  direct: { leases: 0, acks: 3, why: "= TODAY" },
  frames: { leases: 2, acks: 3, why: "= TODAY" },
  framesLate: { leases: 1, acks: 3, why: "TODAY - 1 lease: the late frames name jobs this tab already holds" },
  frameBusy: { leases: 1, acks: 2, why: "= TODAY: the frame becomes K's more, leased when K1 ends" },
  frameFree: { leases: 1, acks: 2, why: "= TODAY, leased at once" },
  backlog: { leases: 2, acks: 5, why: "= TODAY: K's and B's more land while the next slip draws and share the lease at the surface's opening" },
  backlogSlow: { leases: 3, acks: 5, why: "TODAY + 1 lease (P6-3): K's more lands with the surface free" },
  stuck: { leases: 0, acks: 3, why: "TODAY - 2 leases - 2 acks: no hand-back" },
  simple: { leases: 2, acks: 2, why: "= TODAY" },
  // The final review's fix wave. backlogEven (I-1(b), accepted as P6-3, the owner's choice): the last line of the wave
  // writes after the opening that leased the others, so its more costs a lease of its own (one step: = TODAY).
  backlogEven: { leases: 3, acks: 6, why: "TODAY + 1 lease (P6-3): D1's more lands after the wave's shared lease" },
  retryKick: { leases: 2, acks: 2, why: "= TODAY (simple mode: the device line, one step)" },
  retryBesideBacklog: { leases: 4, acks: 5, why: "= TODAY" },
};

async function run(name: ScenarioName, options: Partial<WorldOptions> = {}): Promise<LinesWorld> {
  const world = createLinesWorld({ twoStep: true, ...options });
  await SCENARIOS[name](world);
  await world.settle();
  return world;
}

function paperOf(world: LinesWorld): Record<string, PaperRecord> {
  return Object.fromEntries(world.paper().map((record) => [record.id, record]));
}

for (const name of Object.keys(SCENARIOS) as ScenarioName[]) {
  const title = name === "stuck" ? "a stuck line holds only itself" : `one job per line, two steps: ${name}`;
  test(`${title} (${PHASE_6[name].leases} leases, ${PHASE_6[name].acks} acks: ${PHASE_6[name].why})`, async () => {
    const world = await run(name);
    const counts = world.counts();
    const measured = { leases: counts.leases, acks: counts.acks };
    const expected = { leases: PHASE_6[name].leases, acks: PHASE_6[name].acks };
    assert.deepEqual(measured, expected, `${name}: measured {leases ${measured.leases}, acks ${measured.acks}}, expected {leases ${expected.leases}, acks ${expected.acks}}; TODAY {leases ${TODAY[name].leases}, acks ${TODAY[name].acks}}`);
    assert.ok(counts.leases <= TODAY[name].leases + 1, `${name}: at most one lease more than TODAY (${counts.leases} vs ${TODAY[name].leases})`);
    const ids = world.paper().map((record) => record.id);
    assert.deepEqual([...ids].sort(), [...SCENARIO_JOBS[name]].sort(), `${name}: every job on paper exactly once (paper: ${ids.join(", ")})`);
    assert.equal(counts.printedAcks, SCENARIO_JOBS[name].length, `${name}: one printed ack per job (printed acks ${counts.printedAcks})`);
    assert.equal(counts.handBacks, 0, `${name}: nothing handed back (hand-backs ${counts.handBacks})`);
  });
}

// The final review (I-1(b), P6-3 as the owner chose it): a backlog wave costs up to one lease per printer, never more.
test("an even backlog on two steps costs at most one lease more per printer than TODAY (P6-3)", async () => {
  const world = await run("backlogEven");
  const bound = TODAY.backlogEven.leases + world.stations.length;
  assert.ok(world.counts().leases <= bound, `backlogEven, two steps: ${world.counts().leases} leases, at most ${bound}`);
});

test("a stuck line holds only itself: B1 and D1 cut before 3 × 550 + 100 ms, K1 at 60 000 ms and after", async () => {
  const paper = paperOf(await run("stuck"));
  for (const id of ["B1", "D1"]) {
    assert.ok((paper[id]?.cutAt ?? Infinity) < 3 * DRAW_MS + 100, `${id} cut at ${paper[id]?.cutAt} ms, while K1 still writes`);
  }
  assert.ok((paper.K1?.cutAt ?? 0) >= 60_000, `K1 cut at ${paper.K1?.cutAt} ms (its write takes 60 s)`);
});

test("direct print with 2 s writes: each slip is drawn while the one before still writes; the last cut by 3 × 550 + 2 000 + 100 ms", async () => {
  const paper = paperOf(await run("direct", { writeMs: { K: 2_000, B: 2_000, D: 2_000 } }));
  const [k1, b1, d1] = [paper.K1, paper.B1, paper.D1];
  assert.ok(k1 !== undefined && b1 !== undefined && d1 !== undefined, `all three on paper: ${Object.keys(paper).join(", ")}`);
  assert.ok(b1.drawnAt > k1.drawnAt && b1.drawnAt < k1.cutAt, `B1 drawn at ${b1.drawnAt}: after K1's draw (${k1.drawnAt}), before K1's cut (${k1.cutAt})`);
  assert.ok(d1.drawnAt > b1.drawnAt && d1.drawnAt < b1.cutAt, `D1 drawn at ${d1.drawnAt}: after B1's draw (${b1.drawnAt}), before B1's cut (${b1.cutAt})`);
  const last = Math.max(k1.cutAt, b1.cutAt, d1.cutAt);
  assert.ok(last <= 3 * DRAW_MS + 2_000 + 100, `the last cut at ${last} ms`);
});

// ── The rules a whole world shows best ──

test("a line holds one slip in flight; its next starts only after its write and ack (another line draws meanwhile)", async () => {
  const world = createLinesWorld({ twoStep: true, writeMs: { K: 2_000 } });
  world.deliver({ id: "K1", line: "K" }, { id: "K2", line: "K" }, { id: "B1", line: "B" });
  await world.settle();
  const { K1: k1, K2: k2, B1: b1 } = paperOf(world);
  assert.ok(k1 !== undefined && k2 !== undefined && b1 !== undefined, "K1, K2 and B1 on paper");
  assert.ok(k2.drawnAt - DRAW_MS >= k1.cutAt + ACK_MS, `K2's draw starts at ${k2.drawnAt - DRAW_MS}, after K1's cut (${k1.cutAt}) and ack`);
  assert.ok(b1.drawnAt < k1.cutAt, `B1 drawn at ${b1.drawnAt}, while K1 still writes (cut at ${k1.cutAt})`);
});

test("the device line runs alone: a device-line job and a printer-line job each wait for the other's write and ack", async () => {
  for (const order of [["K1", "J1"], ["J1", "K1"]]) {
    const world = createLinesWorld({ twoStep: true, writeMs: { K: 2_000 } });
    world.deliver(...order.map((id) => ({ id, line: id === "J1" ? "" : "K" })));
    await world.settle();
    const paper = paperOf(world);
    const [first, second] = order.map((id) => paper[id]);
    assert.ok(first !== undefined && second !== undefined, `${order.join(" then ")}: both on paper`);
    assert.ok(second.drawnAt - DRAW_MS >= first.cutAt + ACK_MS, `${order.join(" then ")}: ${order[1]}'s draw starts at ${second.drawnAt - DRAW_MS}, after ${order[0]}'s cut (${first.cutAt}) and ack`);
  }
});

test("a held device-line job never starves: no B or D job starts and nothing is leased until it has started; it starts when K ends", async () => {
  const world = createLinesWorld({ twoStep: true, writeMs: { K: 2_000 } });
  world.deliver({ id: "K1", line: "K" });
  world.at(100, () => world.deliver({ id: "J1", line: "" }));
  world.at(200, () => world.deliver({ id: "B1", line: "B" }));
  world.at(300, () => {
    world.queue("D", "D1");
    world.frame("D", "D1");
  });
  let leasesBefore = -1;
  world.at(2_560, () => void (leasesBefore = world.counts().leases));
  await world.settle();
  const { K1: k1, J1: j1, B1: b1, D1: d1 } = paperOf(world);
  assert.ok(k1 !== undefined && j1 !== undefined && b1 !== undefined && d1 !== undefined, `every job on paper: ${world.paper().map((r) => r.id).join(", ")}`);
  assert.equal(leasesBefore, 0, "no lease while the device-line job waits (D's frame waits for it)");
  assert.ok(j1.drawnAt - DRAW_MS >= k1.cutAt + ACK_MS, `J1 starts at ${j1.drawnAt - DRAW_MS}, once K1 ended (cut ${k1.cutAt})`);
  for (const later of [b1, d1]) assert.ok(later.drawnAt - DRAW_MS >= j1.cutAt + ACK_MS, `${later.id} starts at ${later.drawnAt - DRAW_MS}, after J1 ended (cut ${j1.cutAt})`);
});

test("a hand-back is a wish to lease (one step, stuck): the two hand-backs lead to a lease at once; B1 and D1 print once", async () => {
  const world = createLinesWorld({ twoStep: false });
  await SCENARIOS.stuck(world);
  let leasesSoon = -1;
  world.at(60_700, () => void (leasesSoon = world.counts().leases));
  await world.settle();
  const counts = world.counts();
  assert.equal(counts.handBacks, 2, `one step: B1 and D1 waited behind K1 past the hold bound and went back (hand-backs ${counts.handBacks})`);
  assert.equal(leasesSoon, 1, `their hand-backs leased at once, after their acks (leases by 60.7 s: ${leasesSoon})`);
  const ids = world.paper().map((record) => record.id).sort();
  assert.deepEqual(ids, ["B1", "D1", "K1"], `each printed once (paper: ${ids.join(", ")})`);
});

test("a named kick for a busy line waits for that line; for a free line it leases at once", async () => {
  const busy = createLinesWorld({ twoStep: true });
  let busyBefore = -1;
  busy.at(2_540, () => void (busyBefore = busy.counts().leases));
  await SCENARIOS.frameBusy(busy);
  await busy.settle();
  assert.equal(busyBefore, 0, "K2's frame while K1 writes: no lease before K1 ends");
  assert.equal(busy.counts().leases, 1, "one lease once K1's line frees");
  const free = createLinesWorld({ twoStep: true });
  let freeSoon = -1;
  free.at(610, () => void (freeSoon = free.counts().leases));
  await SCENARIOS.frameFree(free);
  await free.settle();
  assert.equal(freeSoon, 1, "B1's frame while K1 writes: B leased at once");
});

test("a frame for a job this tab holds costs no lease; a frame for a busy line's next job is leased once that line frees", async () => {
  for (const twoStep of [true, false]) {
    const world = createLinesWorld({ twoStep });
    await SCENARIOS.framesLate(world);
    await world.settle();
    assert.equal(world.counts().leases, 1, `framesLate (${twoStep ? "two steps" : "one step"}): the late frames name held jobs: ${world.counts().leases} leases`);
  }
  // K1's ack is answered more:false (K2 was not queued yet when it arrived), but K2's frame landed while K was busy.
  const world = createLinesWorld({ twoStep: true });
  world.deliver({ id: "K1", line: "K" });
  world.at(DRAW_MS + 10, () => {
    world.queue("K", "K2");
    world.frame("K", "K2");
  });
  await world.settle();
  assert.deepEqual(world.paper().map((r) => r.id), ["K1", "K2"], "K2 is leased once K frees, never left to the pulse");
  assert.equal(world.counts().leases, 1, "one lease");
});

test("an unnamed kick while a line is busy leases once, after a line frees (the pulse's and the wake's kicks)", async () => {
  const world = createLinesWorld({ twoStep: true, writeMs: { K: 2_000 } });
  world.deliver({ id: "K1", line: "K" });
  world.at(600, () => {
    world.queue("B", "B1");
    world.frame();
    world.frame();
  });
  let before = -1;
  world.at(2_540, () => void (before = world.counts().leases));
  await world.settle();
  assert.equal(before, 0, "no lease while K1 writes: an unnamed kick does not lease the idle lines at once");
  assert.equal(world.counts().leases, 1, "one lease after K1's line frees, for both kicks");
  assert.deepEqual(world.paper().map((r) => r.id), ["K1", "B1"], "B1 printed");
});
