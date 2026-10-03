// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
// (print-agent-wire.ts), and fails when printing could outgrow a cafe's free Vercel Hobby allowance.

export const PRINT_BUDGET_BUSY_DAY = {
  openHours: 12,
  orders: 300,
  /** 1.5 KOT rounds × 2 stations + 1 bill per order. */
  slips: 1_200,
  agents: 3,
  orderingDevices: 5,
  /** Share of slips that need a second lease + ack. */
  retryShare: 0.1,
} as const;

/** Requests one slip costs: a lease and an ack. Job creation rides the order request (spec §7.4). */
export const PRINT_REQUESTS_PER_SLIP = 2;
/** Spec §17.3 item 4. */
export const PRINT_BUDGET_NORMAL_MAX_PER_DAY = 6_000;
export const PRINT_BUDGET_WORST_MAX_PER_DAY = 18_000;
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
/** Realtime Worker requests one slip costs (spec §17.2): its "queued" print-status, its final
 *  print-status, and in host mode the print-job nudge a host from before Phase 1 drains on. */
export const PRINT_REALTIME_PER_SLIP = 3;
/** Today's realtime traffic without printing (spec §17.2). */
export const PRINT_REALTIME_BASE_PER_DAY = 335;
/** Cloudflare Workers Free (spec §17.1); printing may use at most 5 % of it. */
export const REALTIME_FREE_REQUESTS_PER_DAY = 100_000;

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return printRequestsForSlips(day.slips);
}

/** A lease and an ack per slip, plus the retried share, for any number of slips a day. */
export function printRequestsForSlips(slips: number): number {
  return Math.round(slips * PRINT_REQUESTS_PER_SLIP * (1 + PRINT_BUDGET_BUSY_DAY.retryShare));
}

/** Phase 2, the recount the 1C gate asked for (spec §8, §17.2): the busy day with stations. Each KOT round
 *  splits over two stations (spec §17.2's 1,200 slips), and the heavy setup adds a full copy per round
 *  (1,650). Every slip is ONE job whatever its copies, and costs one lease and one ack: the ack answers
 *  whether its printer's line holds more, so no lease is made to find an empty line (Session 2B). */
export const PRINT_BUDGET_STATIONS_DAY = {
  roundsPerOrder: 1.5,
  stationsPerRound: 2,
  fullCopyPerRound: 1,
  billsPerOrder: 1,
  /** Devices that write to a printer: a kitchen, a bar and a counter device (spec §17.2's 3 agents). */
  writers: 3,
} as const;

export function printStationSlipsPerDay(input: { fullCopy: boolean }): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const perRound = d.stationsPerRound + (input.fullCopy ? d.fullCopyPerRound : 0);
  return Math.round(PRINT_BUDGET_BUSY_DAY.orders * (d.roundsPerOrder * perRound + d.billsPerOrder));
}

/** Printers mode publishes 2 realtime requests per slip: its "queued" print-status aimed at its writer, and
 *  its final state. No print-job nudge: that is for a host, and printers mode has none. */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 2;
