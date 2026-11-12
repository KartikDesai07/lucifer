import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import { SCENARIOS, SCENARIO_JOBS, TODAY, createLinesWorld, type ScenarioName } from "@/lib/print-lines-world";
import { WORLD_T0, createWorldClock, createWorldServer } from "@/lib/print-lines-world-clock";

// Printing Phase 6 Task 1 (spec §9 ruling 26): TODAY's leases and acks, measured on today's agent (one slip at a time,
// a one-step surface) in the scenario world (lib/print-lines-world.ts). They are the "before" of S4: Task 5 drives the
// agent per line through the same scenarios and pins its counts beside these.

const NAMES = Object.keys(SCENARIOS) as ScenarioName[];

// The final review's fix wave added backlogEven, retryKick and retryBesideBacklog (I-1, I-2), each pinned below.
test("the world names the twelve scenarios, each with its TODAY and its jobs", () => {
  const all: ScenarioName[] = ["direct", "frames", "framesLate", "frameBusy", "frameFree", "backlog", "backlogSlow", "stuck", "simple", "backlogEven", "retryKick", "retryBesideBacklog"];
  assert.deepEqual([...NAMES].sort(), [...all].sort(), `the scenarios: ${NAMES.join(", ")}`);
  assert.deepEqual(Object.keys(TODAY).sort(), [...all].sort(), `TODAY's scenarios: ${Object.keys(TODAY).join(", ")}`);
  assert.deepEqual(Object.keys(SCENARIO_JOBS).sort(), [...all].sort(), `SCENARIO_JOBS' scenarios: ${Object.keys(SCENARIO_JOBS).join(", ")}`);
});

// The Task 1 review (Minor 1): the real server answers a head a live lease holds with that lease's end as retryAt
// (lib/print-lease.ts:201-203), so an agent that names an occupied line gets a timer, and its counts move.
test("the world's server: a head a live lease holds answers its lease's end as retryAt; an ack ends the lease", async () => {
  const clock = createWorldClock();
  const server = createWorldServer(clock);
  clock.later(1_000, () => undefined);
  await clock.run(1_000);
  const iso = (ms: number): string => new Date(WORLD_T0 + ms).toISOString();
  server.queue("K", "K1");
  const first = server.lease(["K"]);
  assert.deepEqual(first.jobs.map((j) => j.id), ["K1"], `the first lease takes K1 (got ${first.jobs.map((j) => j.id).join(", ")})`);
  const leaseEnd = iso(1_000 + PRINT_LEASE_MS);
  const again = server.lease(["K"]);
  assert.deepEqual(again, { jobs: [], retryAt: leaseEnd }, `K1 leased at 1 000 ms: retryAt ${String(again.retryAt)}, expected ${leaseEnd}`);
  // A hand-back ends B1's lease: B1 waits not yet due (2 s backoff), the soonest of the two.
  server.deliver("B", "B1");
  const back = server.ack("B1", { deviceId: "dev", epoch: 1, outcome: "failed", sent: "no", error: "held too long on this device" });
  assert.equal(back.nextAttemptAt, iso(3_000), `B1 back in line, due at 3 000 ms (got ${String(back.nextAttemptAt)})`);
  const both = server.lease(["K", "B"]);
  assert.deepEqual(both, { jobs: [], retryAt: iso(3_000) }, `the soonest of K1's lease end and B1's due time: ${String(both.retryAt)}`);
  const printed = server.ack("K1", { deviceId: "dev", epoch: 1, outcome: "printed" });
  assert.equal(printed.applied, true, "K1's printed ack applies");
  const afterAck = server.lease(["K"]);
  assert.deepEqual(afterAck, { jobs: [], retryAt: null }, `K1's ack ended its lease and the line is empty: ${JSON.stringify(afterAck)}`);
});

for (const name of NAMES) {
  test(`the agent per line, one step: ${name} makes today's leases and acks (framesLate one lease fewer, ruling 25), every job on paper once`, async () => {
    const world = createLinesWorld({ twoStep: false });
    await SCENARIOS[name](world);
    await world.settle();
    const counts = world.counts();
    const measured = { leases: counts.leases, acks: counts.acks };
    // Phase 6 Task 5 (spec §9 ruling 25) deliberately changed: on a one-step device too, the late frames name jobs this
    // tab already holds, so the agent per line makes one empty lease fewer than TODAY (the recorded "before", {2, 3}).
    const expected = name === "framesLate" ? { leases: 1, acks: 3 } : TODAY[name];
    assert.deepEqual(
      measured,
      expected,
      `${name}: measured {leases ${measured.leases}, acks ${measured.acks}}, expected {leases ${expected.leases}, acks ${expected.acks}}, TODAY {leases ${TODAY[name].leases}, acks ${TODAY[name].acks}}`,
    );
    const ids = world.paper().map((record) => record.id);
    assert.equal(new Set(ids).size, ids.length, `${name}: no job on paper twice (paper: ${ids.join(", ")})`);
    assert.deepEqual([...ids].sort(), [...SCENARIO_JOBS[name]].sort(), `${name}: one paper per job (paper: ${ids.join(", ")})`);
    assert.equal(counts.printedAcks, SCENARIO_JOBS[name].length, `${name}: one printed ack per job (printed acks ${counts.printedAcks})`);
    const handBacks = name === "stuck" ? 2 : 0;
    assert.equal(counts.handBacks, handBacks, `${name}: hand-backs ${counts.handBacks}, expected ${handBacks} (stuck: B1 and D1 once each)`);
  });
}
