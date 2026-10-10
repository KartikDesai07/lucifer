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
  printWakeWriterCap,
  PRINT_WAKE_PRINTERS_DAILY_CAP,
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
  PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER,
  PRINT_BUDGET_WORST_MAX_PER_DAY,
  PRINT_REALTIME_BASE_PER_DAY,
  PRINT_REALTIME_PER_SLIP,
  REALTIME_FREE_REQUESTS_PER_DAY,
  PRINT_BUDGET_STATIONS_DAY,
  PRINT_REALTIME_PER_PRINTER_SLIP,
  PRINT_REALTIME_PER_DIRECT_SLIP,
  PRINT_REQUESTS_PER_DIRECT_SLIP,
  PRINT_REQUESTS_PER_SLIP,
  PRINT_REQUESTS_PER_TOKEN_SLIP,
  printOneDeviceRequestsPerDay,
  printRequestsForSlips,
  printSlipRequestsPerDay,
  printStationSlipsPerDay,
  PRINT_SETUP_REFRESH_MIN_MS,
  PRINT_SETUP_STALE_MS,
  printHeavyCounterDayRequests,
  printSetupReadsWorstPerDay,
  printTokenRequestsPerDay,
  PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY,
  VERCEL_HOBBY_INVOCATIONS_PER_DAY,
  printUnreachableRequestsPerWriterPerDay,
  printHealthRefreshWritesPerPrinterPerDay,
  PRINT_REALTIME_PER_MOVED_SLIP,
  printUnreachableAnnouncesPerWriterPerDay,
} from "./print-budget";
import { PRINTER_HEALTH_REFRESH_MS, PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";
import { PRINTERS_MAX } from "./print-printers";

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

// The Phase 2B gate (G-1) deliberately changed this pin: a slip's final state is no longer published (no
// device listened for it), so a slip another device prints costs 2 Worker requests, not 3 (was 3,935/day).
test("realtime: two Worker requests per slip another device prints stay under 5 % of the free 100,000 a day", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.slips * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(PRINT_REALTIME_PER_SLIP, 2, "its queued print-status and the host's nudge");
  assert.equal(perDay, 2_735);
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

// Print customization S7: a token cafe prints one more slip per order. Simple mode has no 2-station doubling, so
// it is 1.5 KOT rounds + 1 bill + 1 token = 3.5 slips an order (the busy day's 1,200 is 4 an order). Every figure
// below is computed from the exported constants and the agents' real cadence function, never typed in; the
// literals are landmarks that the arithmetic still lands where the plan says. NOTE the 1C gate above compares its
// bursts to the 2,640 no-host estimate, which a token cafe's trailing leases (3,360) exceed by design: the honest
// ceilings for those are the normal and worst day maxima, held here.
test("S7 token cafe: 3.5 slips an order stays inside the busy day's slips, and lease + ack (with retries) inside the 2,640 estimate", () => {
  const slips = PRINT_BUDGET_BUSY_DAY.orders * PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER;
  assert.equal(slips, 1_050);
  assert.ok(slips <= PRINT_BUDGET_BUSY_DAY.slips, `${slips} slips within the busy day's ${PRINT_BUDGET_BUSY_DAY.slips}`);
  const leaseAndAck = Math.round(slips * 2 * (1 + PRINT_BUDGET_BUSY_DAY.retryShare));
  assert.equal(leaseAndAck, 2_310);
  assert.ok(leaseAndAck <= printSlipRequestsPerDay(), `${leaseAndAck}/day within the ${printSlipRequestsPerDay()} no-host estimate`);
});

test("S7 token cafe: with one trailing empty lease per slip (every slip its own burst) the day stays under the normal ceiling; with a host's wake polls, under it still", () => {
  const slips = PRINT_BUDGET_BUSY_DAY.orders * PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER;
  const trailing = Math.round(slips * 2 * (1 + PRINT_BUDGET_BUSY_DAY.retryShare) + slips);
  assert.equal(trailing, 3_360);
  assert.ok(trailing <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${trailing}/day within ${PRINT_BUDGET_NORMAL_MAX_PER_DAY}`);
  // Host mode, socket healthy, the same three agents the normal-day pin above uses (conservative: Phase 1 lets one device poll).
  const wakePerAgent = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  const hostDay = trailing + PRINT_BUDGET_BUSY_DAY.agents * wakePerAgent;
  assert.equal(hostDay, 5_520);
  assert.ok(hostDay <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${hostDay}/day within ${PRINT_BUDGET_NORMAL_MAX_PER_DAY}`);
});

test("S7 token cafe: the worst day (socket down, agents always busy, the shared cap spent) stays under 18,000", () => {
  const slips = PRINT_BUDGET_BUSY_DAY.orders * PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER;
  const trailing = Math.round(slips * 2 * (1 + PRINT_BUDGET_BUSY_DAY.retryShare) + slips);
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  for (const agents of [1, 2, 3, 5, 8, 16]) {
    const perAgent = Math.min(OPEN_MS / fastest, printWakeAgentCap(agents));
    assert.ok(trailing + agents * perAgent <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${agents} agents: ${trailing + agents * perAgent}/day`);
  }
  const three = trailing + 3 * Math.min(OPEN_MS / fastest, printWakeAgentCap(3));
  assert.equal(three, 17_760);
});

test("S7 token cafe: realtime (2 Worker requests a slip since printing Phase 2, plus today's base) stays under 5 % of the free 100,000", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.orders * PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 2_435); // 3,485 before printing Phase 2 cut PRINT_REALTIME_PER_SLIP from 3 to 2
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
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

test("1D gate retention: unattended waiting slips go after 3 h; the feed reads that window plus the acted grace; a slip staff acted on gets its try", () => {
  assert.equal(PRINT_JOB_QUEUED_RETENTION_MS, 3 * 60 * 60 * 1000, "the owner: 3 h (was 12 h)");
  // The Phase 1 final gate (M2, deliberate change): a slip tapped just before its 3 h is kept 15 min more, and shown.
  assert.equal(PRINT_ATTENTION_WINDOW_MS, PRINT_JOB_QUEUED_RETENTION_MS + PRINT_JOB_ACTED_GRACE_MS, "the panel shows every waiting slip the prune keeps (a tap before its 3 h)");
  assert.ok(PRINT_JOB_QUEUED_RETENTION_MS > PRINT_HOST_MAX_AGE_MS, "a stale slip is shown (and can be printed now) before it is deleted");
  assert.ok(PRINT_JOB_ACTED_GRACE_MS >= PRINT_LEASE_MS + PRINT_ACK_PENDING_MAX_MS, "a tapped slip is never deleted mid-print or before its late ack");
  assert.ok(PRINT_REPAIR_ORDER_MAX_AGE_MS >= PRINT_JOB_QUEUED_RETENTION_MS, "a long-sitting table's new round is still repaired");
});

test("1D gate retention: the prune rides the existing throttle, and stale device rows go after 7 days", () => {
  assert.equal(PRINT_JOB_PRUNE_MIN_INTERVAL_MS, 5 * 60 * 1000, "at most one prune per 5 min per instance");
  assert.equal(PRINT_DEVICE_PRUNE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.ok(PRINT_DEVICE_PRUNE_MS > 1000 * PRINT_DEVICE_ONLINE_MS, "only a device gone for days, never one that is merely offline");
});

// Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A5): the stations recount the 1C gate asked
// for. Printers mode routes each KOT round to its stations' printers (spec §8), and each printer's writer
// leases its own line. These pins hold the cafe under the same ceilings with stations, with the heavy setup
// (a full copy per round too), and with any number of writers.
test("Phase 2 busy day with stations: spec §17.2's 1,200 slips; a full copy per round makes 1,650", () => {
  assert.equal(printStationSlipsPerDay({ fullCopy: false }), 1_200, "1.5 rounds x 2 stations + 1 bill, 300 orders");
  assert.equal(printStationSlipsPerDay({ fullCopy: true }), 1_650, "and a full copy of each round");
  assert.equal(printRequestsForSlips(1_200), printSlipRequestsPerDay(), "the same lease-and-ack price per slip as Phase 1");
});

test("Phase 2 normal day (socket healthy): stations stay at 4,800; the heavy setup at 5,790, under 6,000", () => {
  const wakePerWriter = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  const writers = PRINT_BUDGET_STATIONS_DAY.writers;
  const stations = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: false })) + writers * wakePerWriter;
  const heavy = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + writers * wakePerWriter;
  assert.equal(stations, 4_800);
  assert.equal(heavy, 5_790);
  assert.ok(heavy <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${heavy}/day`);
});

test("Phase 2 worst case (socket down all day, every writer always busy): the writers' shared cap holds even the heavy setup under 18,000", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  const heavySlips = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true }));
  for (const writers of [1, 2, 3, 5, 8, 12]) {
    const wake = writers * Math.min(OPEN_MS / fastest, printWakeWriterCap(writers));
    assert.ok(wake <= PRINT_WAKE_PRINTERS_DAILY_CAP, `${writers} writers: ${wake} wake hits`);
    assert.ok(heavySlips + wake <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${writers} writers: ${heavySlips + wake}/day`);
  }
  assert.equal(heavySlips + 3 * Math.min(OPEN_MS / fastest, printWakeWriterCap(3)), 17_628, "the heavy day's worst case");
});

test("Phase 2: in printers mode only writers poll; ordering devices and a leftover host never do", () => {
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true, printersMode: true, isWriter: false }), false, "a host that writes to no printer stops polling");
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false, printersMode: true, isWriter: true }), true, "a writer polls");
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false, printersMode: true }), false, "an ordering device never polls");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true }), true, "simple mode is unchanged");
  assert.ok(PRINT_WAKE_PRINTERS_DAILY_CAP <= PRINT_WAKE_DAILY_CAP, "printers mode never polls more than a host did");
});

// The Phase 2B gate (G-1) deliberately changed this pin: no final state, so one Worker request per slip in
// printers mode, at most (a slip its writer asked for publishes none; was 2 per slip, 3,635/day).
test("Phase 2 realtime: at most one Worker request per slip in printers mode, the heavy day under 5 %", () => {
  const perDay = printStationSlipsPerDay({ fullCopy: true }) * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(PRINT_REALTIME_PER_PRINTER_SLIP, 1, "its queued print-status aimed at its writer");
  assert.equal(perDay, 1_985);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

// Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9; the owner's ask of 2026-10-04): a slip the
// asking device prints itself, with the fewest requests and no realtime message.
test("2B: a slip the asking device prints itself costs one request (its ack) and no realtime request; another device's slip keeps a lease and an ack", () => {
  assert.equal(PRINT_REQUESTS_PER_DIRECT_SLIP, 1, "made leased with the order request: only its ack");
  assert.equal(PRINT_REALTIME_PER_DIRECT_SLIP, 0, "nothing is published to the device printing it");
  assert.equal(PRINT_REQUESTS_PER_SLIP, 2, "a slip another device prints: one lease and one ack");
  assert.equal(PRINT_REALTIME_PER_SLIP, 2, "its queued print-status and the host's nudge");
  const payNow = PRINT_REQUESTS_PER_DIRECT_SLIP + PRINT_REQUESTS_PER_SLIP;
  assert.equal(payNow, 3, "Pay Now on one printer: the KOT's ack, then the bill's lease and ack (Phase 1: 5, with its empty lease)");
});

test("2B: the ack's more ends a burst with no empty lease: Phase 1's busy day (2,400 with a trailing lease) costs 1,650", () => {
  const slips = PRINT_BUDGET_BUSY_DAY.orders * (PRINT_BUDGET_STATIONS_DAY.roundsPerOrder + PRINT_BUDGET_STATIONS_DAY.billsPerOrder);
  assert.equal(printRequestsForSlips(slips), 1_650, "a lease and an ack per slip, plus the retried share, nothing more");
});

test("2B: the busy day of a cafe whose one device takes and prints its orders: 1,200 requests and no realtime request for printing", () => {
  const requests = printOneDeviceRequestsPerDay();
  assert.equal(requests, 1_200, "every round's KOT made leased; every bill behind its KOT (Pay Now), the worst case");
  assert.ok(requests < printRequestsForSlips(750), "less than the same day's slips leased one by one (1,650)");
  const wakePerHost = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  assert.equal(requests + wakePerHost, 1_920, "the device as the host also polls the wake on a healthy socket");
  assert.ok(requests + wakePerHost <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "well inside the normal-day ceiling");
  const realtime = 750 * PRINT_REALTIME_PER_DIRECT_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(realtime, PRINT_REALTIME_BASE_PER_DAY, "printing adds no Worker request at all");
});

// Phase 2 Session 2C: each device reads the outlet's printers on mount, on a print-setup frame (an admin save:
// two Worker requests, then one read per device) and on a focus at most every 30 min. Never per slip, never on a
// timer. 30 min, not 5: at 5 min a focus-happy day would push the heavy worst case past 18,000 (the 2B gate).
test("2C: reading the printers costs at most 192 requests a day, and the heavy setup still fits both ceilings", () => {
  assert.equal(PRINT_SETUP_STALE_MS, 30 * 60 * 1000);
  const reads = printSetupReadsWorstPerDay();
  assert.equal(reads, 192, "8 devices, a focus read at most twice an hour, 12 h");
  const wakePerWriter = Math.round(OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: null, capSpent: false }));
  const heavy = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + PRINT_BUDGET_STATIONS_DAY.writers * wakePerWriter;
  assert.ok(heavy + reads <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `normal heavy day ${heavy + reads}/day`);
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  const worst = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + 3 * Math.min(OPEN_MS / fastest, printWakeWriterCap(3));
  assert.equal(worst + reads, 17_820, "the heavy worst case with every focus read");
  assert.ok(worst + reads <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${worst + reads}/day`);
});

// Session 2C (decision 15 per printer line): the counter device writes the full copy and the bills; when it takes
// every order, each round's full copy is made leased to it (one request), its bill follows through the ack's
// more, and each station slip costs its writer a lease and an ack.
test("2C: the heavy day when the counter takes every order: its full copies cost one request each (5,340 with the wake)", () => {
  const wakePerWriter = Math.round(OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: null, capSpent: false }));
  assert.equal(printHeavyCounterDayRequests(), 3_180, "450 full copies at one request instead of two");
  assert.equal(printHeavyCounterDayRequests() + PRINT_BUDGET_STATIONS_DAY.writers * wakePerWriter, 5_340);
});

// The 2C gate's review (I-2): a stale printer list heals from the pulse or the wake within a minute, and the read
// is bounded: at most one a minute, only while a printer job aimed at the device is not among its ready printers,
// and such a job goes stale (out of the count) after 30 min.
test("2C: a stale printer list is read again at most once a minute, and at most 30 times for one waiting slip", () => {
  assert.equal(PRINT_SETUP_REFRESH_MIN_MS, 60_000);
  assert.ok(PRINT_SETUP_REFRESH_MIN_MS >= 3 * 20_000, "never more often than every third pulse");
  assert.equal(Math.ceil(PRINT_HOST_MAX_AGE_MS / PRINT_SETUP_REFRESH_MIN_MS), 30, "a slip leaves the count when it goes stale (30 min)");
});

// The token fix (plan 2026-10-06-token-direct-fix.md, T1): a token is never made leased at creation (an older page
// cannot draw it), so it always costs a lease and an ack. The S7 pins above already price every token slip so (2 per
// slip, simple mode), and no pin above priced a token as made leased: none changes. The fix moves one day only:
// printers mode, a counter that writes the bill printer but no full copy takes every order, so the token was the
// request's first job on the counter's line (made leased: 1 request) and is now leased by the counter's page (2).
// Its review (Fable 5.1, I-1) also recounted the printers-mode days a token cafe adds to, which S7 never priced: the
// two pins below hold those figures (OPEN until the owner accepted them, 2026-10-06); the token fix does not change them.
const fastestWake = (): number => cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
const healthyWakePerWriter = (): number => Math.round(OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: null, capSpent: false }));

test("token fix: a token always costs a lease and an ack; the day it moves (a counter that writes the bills only) goes 5,160 -> 5,460, 5,652 with the printer-list reads, inside the normal ceiling", () => {
  assert.equal(PRINT_REQUESTS_PER_TOKEN_SLIP, PRINT_REQUESTS_PER_SLIP, "a lease and an ack, like a slip another device prints");
  assert.notEqual(PRINT_REQUESTS_PER_TOKEN_SLIP, PRINT_REQUESTS_PER_DIRECT_SLIP, "never the one request of a slip made leased at creation");
  const tokens = printTokenRequestsPerDay();
  assert.equal(tokens, 660, "300 tokens, a lease and an ack each, plus the retried share");
  const orders = PRINT_BUDGET_BUSY_DAY.orders;
  const wasMadeLeased = Math.round(orders * (PRINT_REQUESTS_PER_DIRECT_SLIP + PRINT_BUDGET_BUSY_DAY.retryShare * PRINT_REQUESTS_PER_SLIP));
  assert.equal(tokens - wasMadeLeased, 300, "on that counter the fix costs one lease per token: 300 a day");
  // Each round's station slips at their writers and each bill behind its token: a lease and an ack apiece.
  const slips = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: false }));
  const wake = PRINT_BUDGET_STATIONS_DAY.writers * healthyWakePerWriter();
  assert.equal(slips + wasMadeLeased + wake, 5_160, "before the fix");
  const after = slips + tokens + wake;
  assert.equal(after, 5_460, "after the fix");
  assert.equal(after + printSetupReadsWorstPerDay(), 5_652, "with every printer-list read");
  assert.ok(after + printSetupReadsWorstPerDay() <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${after + printSetupReadsWorstPerDay()}/day within ${PRINT_BUDGET_NORMAL_MAX_PER_DAY}`);
  const realtime = (printStationSlipsPerDay({ fullCopy: true }) + orders) * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(realtime, 2_285, "at most one Worker request a token (none when the asking tab prints it), the heavy day under 5 %");
  assert.ok(realtime <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${realtime}/day`);
});

// The owner's ruling on the two days below (2026-10-06, the Phase 3 planning session, option A): accepted, and measured
// in Phase 3's exit. Each figure stays pinned exactly; it is over the ceiling a cafe without tokens is held to, and
// inside a token cafe's own (PRINT_BUDGET_TOKEN_*_MAX_PER_DAY). A change that moves either day fails here first.
test("ACCEPTED by the owner (2026-10-06, option A; pre-existing since S7): the 2C heavy counter day with a token per order is 6,000, and 6,192 with the printer-list reads: over the normal ceiling, inside a token cafe's", () => {
  // The counter writes the full copy too: each round's full copy heads its line, so the token always waited behind it.
  const day = printHeavyCounterDayRequests() + printTokenRequestsPerDay() + PRINT_BUDGET_STATIONS_DAY.writers * healthyWakePerWriter();
  assert.equal(day, 6_000, "the 2C pin's 5,340 plus the tokens, before and after the fix alike");
  const withReads = day + printSetupReadsWorstPerDay();
  assert.equal(withReads, 6_192, "with every printer-list read");
  assert.ok(withReads > PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${withReads}/day is over the ${PRINT_BUDGET_NORMAL_MAX_PER_DAY} normal ceiling a cafe without tokens is held to`);
  assert.ok(withReads <= PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY, `${withReads}/day within a token cafe's ${PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY}`);
});

test("ACCEPTED by the owner (2026-10-06, option A; pre-existing since S7): the heavy setup with a token per order, taken on devices that print nothing, is 6,450 a day (6,642 with reads) and 18,288 at worst (18,480 with reads): over both ceilings, inside a token cafe's", () => {
  const slips = printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) + printTokenRequestsPerDay();
  const normal = slips + PRINT_BUDGET_STATIONS_DAY.writers * healthyWakePerWriter();
  assert.equal(normal, 6_450, "the 2A heavy day's 5,790 plus the tokens");
  assert.equal(normal + printSetupReadsWorstPerDay(), 6_642, "with every printer-list read");
  assert.ok(normal > PRINT_BUDGET_NORMAL_MAX_PER_DAY, `${normal}/day is over the ${PRINT_BUDGET_NORMAL_MAX_PER_DAY} normal ceiling a cafe without tokens is held to`);
  assert.ok(normal + printSetupReadsWorstPerDay() <= PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY, `${normal + printSetupReadsWorstPerDay()}/day within a token cafe's ${PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY}`);
  const worst = slips + 3 * Math.min(OPEN_MS / fastestWake(), printWakeWriterCap(3));
  assert.equal(worst, 18_288, "the 2A heavy worst case's 17,628 plus the tokens");
  assert.equal(worst + printSetupReadsWorstPerDay(), 18_480, "with every printer-list read");
  assert.ok(worst > PRINT_BUDGET_WORST_MAX_PER_DAY, `${worst}/day is over the ${PRINT_BUDGET_WORST_MAX_PER_DAY} worst-case ceiling a cafe without tokens is held to`);
  assert.ok(worst + printSetupReadsWorstPerDay() <= PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY, `${worst + printSetupReadsWorstPerDay()}/day within a token cafe's ${PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY}`);
});

// Phase 3 Session 3A (spec §9.3): failover adds no request. The skip is ten refusal rechecks long, so a writer that
// cannot reach a network printer another device can print costs at most a lease and an ack per 5 minutes. The 3A review
// gate (m-3) deliberately re-worded this pin: 288 is the cost at the skip's floor; on a flaky link (the app's probe
// answers, its print's connect does not) the ceiling stays Phase 1's refusal recheck, 2 requests per 30 s, not new.
test("Phase 3 failover: a writer that could not reach a network printer costs at most 288 requests a day at the skip's 5-minute floor (ten 30 s rechecks); Phase 1's 2 requests per 30 s stays the ceiling", () => {
  assert.equal(PRINTER_UNREACHABLE_SKIP_MS, 5 * 60 * 1000);
  assert.ok(PRINTER_UNREACHABLE_SKIP_MS >= 10 * PRINT_AGENT_REFUSED_RECHECK_MS, "never shorter than ten of Phase 1's refusal rechecks");
  assert.equal(printUnreachableRequestsPerWriterPerDay(), 288, "144 skips over the busy day's 12 h, a lease and an ack each");
  assert.ok(printUnreachableRequestsPerWriterPerDay() <= 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS) / 10, "a tenth of a refusing printer's cost");
});

// Phase 3 Session 3A (spec §10): printer health rides the wake, so it adds no request; its Mongo writes are bounded.
test("Phase 3 health: no request of its own; at most 144 refresh writes a printer a day, 1,728 for a cafe's twelve printers (0.04 a second)", () => {
  assert.equal(PRINTER_HEALTH_REFRESH_MS, 5 * 60 * 1000);
  assert.equal(printHealthRefreshWritesPerPrinterPerDay(), 144);
  const cafe = printHealthRefreshWritesPerPrinterPerDay() * PRINTERS_MAX;
  assert.equal(cafe, 1_728);
  assert.ok(cafe / (OPEN_MS / 1000) < 0.05, "far under Atlas M0's 100 operations a second");
});

// The 3A review gate (m-2): the head announcements failover adds (announcePrinterHead: a printer's waiting slips moved
// to the device that took it over, or to its backup printer) were inside P3-3's 5 % ruling but not pinned. A moved slip
// costs at most one more Worker request; at the heavy token day's figure with EVERY printer slip and token moved once,
// plus a head announced per 5-minute skip for each of the three writers, realtime printing stays under 5 %.
test("Phase 3 realtime: a slip moved by failover or to its backup costs at most one more Worker request; the heavy token day with every slip moved once and every writer skipped all day stays under 5 %", () => {
  assert.equal(PRINT_REALTIME_PER_MOVED_SLIP, 1, "its line's head announced to its new writer");
  assert.equal(printUnreachableAnnouncesPerWriterPerDay(), 144, "one head announced per 5-minute skip over the busy day's 12 h");
  const slips = printStationSlipsPerDay({ fullCopy: true }) + PRINT_BUDGET_BUSY_DAY.orders;
  const heavy = slips * PRINT_REALTIME_PER_PRINTER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(heavy, 2_285, "the S7 heavy token day (one Worker request a slip or token)");
  const perDay = heavy + slips * PRINT_REALTIME_PER_MOVED_SLIP + PRINT_BUDGET_STATIONS_DAY.writers * printUnreachableAnnouncesPerWriterPerDay();
  assert.equal(perDay, 4_667, "plus every slip moved once and each writer skipped all day");
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

test("the owner's token ruling: a token cafe's ceilings sit just above the accepted days, the normal one inside 20 % of the free daily invocations as a figure, and a cafe without tokens keeps 6,000 / 18,000", () => {
  assert.equal(VERCEL_HOBBY_INVOCATIONS_PER_DAY, 33_333, "1,000,000 a month over 30 days");
  assert.ok(6_642 <= VERCEL_HOBBY_INVOCATIONS_PER_DAY * 0.2, "the heavy token day with every read is at most 20 % of the free daily invocations (19.9 %)");
  assert.ok(PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY - 6_642 < 100 && PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY - 18_480 < 100, "the token ceilings leave under 100 a day of room: any growth needs a new ruling");
  assert.equal(PRINT_BUDGET_NORMAL_MAX_PER_DAY, 6_000, "never loosened for a cafe without tokens");
  assert.equal(PRINT_BUDGET_WORST_MAX_PER_DAY, 18_000, "never loosened for a cafe without tokens");
});
