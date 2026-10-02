import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_WAKE_DAILY_CAP } from "./print-job";
import { printAgentPollsWake, printAgentWakeIntervalMs, printWakeAgentCap } from "./print-agent-wire";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
  PRINT_BUDGET_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_WORST_MAX_PER_DAY,
  PRINT_REALTIME_BASE_PER_DAY,
  PRINT_REALTIME_PER_SLIP,
  REALTIME_FREE_REQUESTS_PER_DAY,
  printSlipRequestsPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
// Vercel Hobby allowance fails here, before it ships.
const OPEN_MS = PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000;

function cadence(input: { socketHealthy: boolean; msSinceLastJob: number | null; capSpent: boolean }): number {
  const ms = printAgentWakeIntervalMs(input);
  assert.notEqual(ms, false, "this case polls");
  return ms as number;
}

test("normal busy day (socket healthy): printing stays under 6,000 invocations (spec §17.2: 4,800)", () => {
  const wakePerAgent = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  const total = printSlipRequestsPerDay() + PRINT_BUDGET_BUSY_DAY.agents * wakePerAgent;
  assert.equal(total, 4_800);
  assert.ok(total <= PRINT_BUDGET_NORMAL_MAX_PER_DAY);
});

test("worst case (socket down all day, every agent always busy): the shared cap holds the cafe under 18,000", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  for (const agents of [1, 2, 3, 5, 8, 16]) {
    const perAgent = Math.min(OPEN_MS / fastest, printWakeAgentCap(agents));
    const total = printSlipRequestsPerDay() + agents * perAgent;
    assert.ok(total <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${agents} agents: ${total}/day`);
  }
  const three = printSlipRequestsPerDay() + 3 * Math.min(OPEN_MS / fastest, printWakeAgentCap(3));
  assert.equal(three, 17_040, "spec §17.2's worst-case figure");
});

test("more printer devices never raise the cafe's wake total (spec §9.1 shared cap)", () => {
  for (let agents = 0; agents <= 64; agents++) {
    assert.ok(Math.max(1, agents) * printWakeAgentCap(agents) <= PRINT_WAKE_DAILY_CAP, `${agents} agents`);
  }
  assert.equal(printWakeAgentCap(1), PRINT_WAKE_DAILY_CAP);
  assert.equal(printWakeAgentCap(3), 4_800);
});

test("no agent poll runs faster than 3 s, and a spent cap stops the poll", () => {
  for (const socketHealthy of [true, false]) {
    for (const msSinceLastJob of [null, 0, 119_999, 120_000, 3_600_000]) {
      const ms = cadence({ socketHealthy, msSinceLastJob, capSpent: false });
      assert.ok(ms >= PRINT_AGENT_MIN_CADENCE_MS, `${socketHealthy}/${msSinceLastJob}: ${ms} ms`);
    }
    assert.equal(printAgentWakeIntervalMs({ socketHealthy, msSinceLastJob: 0, capSpent: true }), false);
  }
});

test("spec §9.1 cadences: 60 s on a healthy socket; 3 s while busy without one; 15 s when idle", () => {
  assert.equal(cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false }), 60_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: 119_999, capSpent: false }), 3_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: 120_000, capSpent: false }), 15_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: null, capSpent: false }), 15_000);
});

// 1A review gate (I3 and the reviewer's recommendation 1). Dividing the cap by the agents online cannot
// bound agents that join late: one agent alone spends 9,600 before two more arrive, then each of them
// spends 4,800, so 19,200 wake hits. Phase 1 therefore lets exactly one device poll the wake.
test("Phase 1: at most one device polls the wake, in either simple mode, so the shared cap is exact", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  for (const devices of [1, 2, 3, 5, 8, 16]) {
    for (const hostConfigured of [true, false]) {
      const pollers = Array.from({ length: devices }, (_, i) =>
        printAgentPollsWake({ hostConfigured, isHost: hostConfigured && i === 0 }),
      ).filter(Boolean).length;
      assert.ok(pollers <= 1, `${devices} devices, host ${hostConfigured}: ${pollers} pollers`);
      const total = printSlipRequestsPerDay() + pollers * Math.min(OPEN_MS / fastest, printWakeAgentCap(pollers));
      assert.ok(total <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${devices} devices, host ${hostConfigured}: ${total}/day`);
    }
  }
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false }), false, "no host: nobody polls (spec §17.2)");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: false }), false, "a device that is not the host never polls");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true }), true, "the host polls");
});

test("no host: printing costs only a lease and an ack per slip, never a poll (spec §17.2: 2,640/day)", () => {
  assert.equal(printSlipRequestsPerDay(), 2_640);
  assert.ok(printSlipRequestsPerDay() <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "inside the normal-day ceiling");
});

test("realtime: three Worker requests per slip stay under 5 % of the free 100,000 a day", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.slips * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 3_935);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});
