import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINT_HOST_MAX_AGE_MS,
  PRINT_JOB_ACTED_GRACE_MS,
  PRINT_JOB_PRUNE_MIN_INTERVAL_MS,
  PRINT_JOB_QUEUED_RETENTION_MS,
  PRINT_JOB_RESOLVED_RETENTION_MS,
  PRINT_WAKE_DAILY_CAP,
} from "./print-job";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  PRINT_AGENT_TIMER_MAX_MS,
  PRINT_AGENT_TIMER_MIN_MS,
  PRINT_ATTENTION_WINDOW_MS,
  printAgentMayLease,
  printAgentPollsWake,
  printAgentTimerDelayMs,
  printAgentWakeIntervalMs,
  printWakeAgentCap,
} from "./print-agent-wire";
import {
  PRINT_ACK_PENDING_MAX_MS,
  PRINT_ACK_RETRY_MS,
  PRINT_BACKOFF_MS,
  PRINT_DEVICE_ONLINE_MS,
  PRINT_DEVICE_PRUNE_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  PRINT_REPAIR_ORDER_MAX_AGE_MS,
  PRINT_REPAIR_WINDOW_MS,
} from "./print-lifecycle";
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

// Session 1C (the owner's decisions after Session 1B): no automatic attempt while a printer is off, at
// most two attempts that may reach paper per slip, and nothing the agent adds is a recurring request on
// an ordering device. Every new cadence the agent has is pinned here.
test("1C agent: it never leases while its printer can not print, while a refusal holds, or while busy", () => {
  const open = { enabled: true, busy: false, running: false, printerReady: true, refusalHolds: false };
  assert.equal(printAgentMayLease(open), true, "an open gate leases");
  for (const closed of [{ enabled: false }, { busy: true }, { running: true }, { printerReady: false }, { refusalHolds: true }]) {
    assert.equal(printAgentMayLease({ ...open, ...closed }), false, `closed by ${JSON.stringify(closed)}`);
  }
});

test("1C agent: its one local timer is clamped to 2–30 s from the server's clock, never a tight loop", () => {
  const now = 1_800_000_000_000;
  assert.equal(printAgentTimerDelayMs(now - 60_000, now), PRINT_AGENT_TIMER_MIN_MS, "a time in the past waits the shortest step");
  assert.equal(printAgentTimerDelayMs(now + 10 * 60_000, now), PRINT_AGENT_TIMER_MAX_MS, "a far time is re-checked at the steady step");
  assert.equal(printAgentTimerDelayMs(now + 5_000, now), 5_000);
  assert.ok(PRINT_AGENT_TIMER_MIN_MS >= PRINT_BACKOFF_MS[0], "never sooner than the shortest backoff");
  assert.ok(PRINT_AGENT_TIMER_MAX_MS <= PRINT_BACKOFF_MS[PRINT_BACKOFF_MS.length - 1], "never later than the steady backoff");
});

test("1C agent: a printer that says ready but keeps refusing costs at most one lease and one ack per 30 s per slip, until the slip is stale", () => {
  assert.ok(PRINT_AGENT_REFUSED_RECHECK_MS >= 30_000, "a refusal holds the agent at least 30 s");
  const perStuckSlip = 2 * Math.ceil(PRINT_HOST_MAX_AGE_MS / PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.ok(perStuckSlip <= 120, `${perStuckSlip} requests over the 30-minute stale window, then the slip waits for a tap`);
});

test("1C agent: a ready printer makes at most two attempts per slip (the first plus one labelled retry): at most 4 requests", () => {
  assert.equal(PRINT_MAX_PAPER_ATTEMPTS, 2, "the owner's rule");
  assert.ok(PRINT_MAX_PAPER_ATTEMPTS * 2 <= 4, "a lease and an ack per attempt");
});

test("1C agent: an unanswered printed ack is re-sent every 5 s for at most 10 minutes, only while no answer comes", () => {
  assert.ok(PRINT_ACK_RETRY_MS >= 5_000, "never faster than every 5 s");
  assert.ok(PRINT_ACK_PENDING_MAX_MS / PRINT_ACK_RETRY_MS <= 120, "at most 120 re-sends per lost ack, then it is dropped");
});

// The 1C review gate (fresh review, 2026-10-03): two request sources the per-event pins above did not add
// up. After every burst of slips the agent leases once more and finds its line empty; and a printer that
// reports ready but keeps refusing costs a lease and an ack per 30 s re-check, all day.
test("1C gate: Phase 1's busy day, with one trailing empty lease per burst, still fits the no-host estimate", () => {
  // Phase 1 has no stations: 1.5 KOT rounds + 1 bill per order. At worst every slip is its own burst.
  const slips = PRINT_BUDGET_BUSY_DAY.orders * 2.5;
  const bursts = slips;
  const perDay = Math.round(slips * 2 * (1 + PRINT_BUDGET_BUSY_DAY.retryShare) + bursts);
  assert.equal(perDay, 2_400);
  assert.ok(perDay <= printSlipRequestsPerDay(), `${perDay}/day within the 2,640 estimate`);
});

test("1C gate: a printer that says ready but keeps refusing costs at most 2 requests per 30 s per device: 2,880 over the day", () => {
  const perDevice = 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(perDevice, 2_880);
  assert.ok(perDevice <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "even a whole day of it stays inside the normal-day ceiling");
});

// The owner's decision after Session 1D: no print data kept longer than needed, deleted on the throttled
// prune that already rides the pulse's after() sweep (no cron, no new request). These pins hold the floors
// that keep a shorter retention from printing anything twice or hiding anything still waiting.
test("1D gate retention: finished slips go after 45 min, never inside the KOT repair window (+15 min) or an ack's retries", () => {
  assert.equal(PRINT_JOB_RESOLVED_RETENTION_MS, 45 * 60 * 1000, "the owner: as soon as it is safe (was 2 h)");
  assert.ok(
    PRINT_JOB_RESOLVED_RETENTION_MS >= PRINT_REPAIR_WINDOW_MS + 15 * 60 * 1000,
    "a printed row deleted inside the repair window would be re-created and print twice",
  );
  assert.ok(PRINT_JOB_RESOLVED_RETENTION_MS > PRINT_ACK_PENDING_MAX_MS + PRINT_LEASE_MS, "a late ack still finds its row");
});

test("1D gate retention: unattended waiting slips go after 3 h; the feed reads the same window; a slip staff acted on gets its try", () => {
  assert.equal(PRINT_JOB_QUEUED_RETENTION_MS, 3 * 60 * 60 * 1000, "the owner: 3 h (was 12 h)");
  assert.equal(PRINT_ATTENTION_WINDOW_MS, PRINT_JOB_QUEUED_RETENTION_MS, "the panel shows every waiting slip the prune keeps");
  assert.ok(PRINT_JOB_QUEUED_RETENTION_MS > PRINT_HOST_MAX_AGE_MS, "a stale slip is shown (and can be printed now) before it is deleted");
  assert.ok(PRINT_JOB_ACTED_GRACE_MS >= PRINT_LEASE_MS + PRINT_ACK_PENDING_MAX_MS, "a tapped slip is never deleted mid-print or before its late ack");
  assert.ok(PRINT_REPAIR_ORDER_MAX_AGE_MS >= PRINT_JOB_QUEUED_RETENTION_MS, "a long-sitting table's new round is still repaired");
});

test("1D gate retention: the prune rides the existing throttle, and stale device rows go after 7 days", () => {
  assert.equal(PRINT_JOB_PRUNE_MIN_INTERVAL_MS, 5 * 60 * 1000, "at most one prune per 5 min per instance");
  assert.equal(PRINT_DEVICE_PRUNE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.ok(PRINT_DEVICE_PRUNE_MS > 1000 * PRINT_DEVICE_ONLINE_MS, "only a device gone for days, never one that is merely offline");
});
