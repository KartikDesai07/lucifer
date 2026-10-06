import { PRINTER_UNREACHABLE_SKIP_MS } from "./print-failover";

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

/** A token cafe in simple mode (print-customization S7): 1.5 KOT rounds + 1 bill + 1 token slip per order
 *  (no 2-station doubling). print-budget.test.ts holds it under the same ceilings as the busy day. */
export const PRINT_BUDGET_TOKEN_SLIPS_PER_ORDER = 3.5;

/** Requests one slip costs: a lease and an ack. Job creation rides the order request (spec §7.4). */
export const PRINT_REQUESTS_PER_SLIP = 2;
/** Spec §17.3 item 4. */
export const PRINT_BUDGET_NORMAL_MAX_PER_DAY = 6_000;
export const PRINT_BUDGET_WORST_MAX_PER_DAY = 18_000;
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
/** Realtime Worker requests one slip another device prints costs (spec §17.2): its "queued" print-status
 *  aimed at that device, and in host mode the print-job nudge a host from before Phase 1 drains on. Its
 *  final state is not published (the Phase 2B gate, G-1: no device listened for it; it was 3). */
export const PRINT_REALTIME_PER_SLIP = 2;
/** Today's realtime traffic without printing (spec §17.2). */
export const PRINT_REALTIME_BASE_PER_DAY = 335;
/** Cloudflare Workers Free (spec §17.1); printing may use at most 5 % of it. */
export const REALTIME_FREE_REQUESTS_PER_DAY = 100_000;

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return printRequestsForSlips(day.slips, day.retryShare);
}

/** A lease and an ack per slip, plus the retried share, for any number of slips a day. */
export function printRequestsForSlips(slips: number, retryShare: number = PRINT_BUDGET_BUSY_DAY.retryShare): number {
  return Math.round(slips * PRINT_REQUESTS_PER_SLIP * (1 + retryShare));
}

/** Phase 2 Session 2B (spec §7.11, plan decisions 15, 16 and 9): a slip the asking device prints itself is
 *  made leased to its tab, so its one request is its ack, and nothing is published for it. A slip made with
 *  it on the same line (Pay Now's bill) follows through the ack's `more`: one lease and one ack. */
export const PRINT_REQUESTS_PER_DIRECT_SLIP = 1;
export const PRINT_REALTIME_PER_DIRECT_SLIP = 0;

/** The token fix (after the print-customization merge): a token slip is never made leased at creation (a page from
 *  before S7 cannot draw it), so even on the device that prints it, it costs a lease and an ack. */
export const PRINT_REQUESTS_PER_TOKEN_SLIP = PRINT_REQUESTS_PER_SLIP;

/** The busy day's token slips (one per order) at a lease and an ack each, plus the retried share: what a token cafe
 *  adds to any day above (print-budget.test.ts holds the printers-mode days it moves, and those left OPEN). */
export function printTokenRequestsPerDay(): number {
  return Math.round(PRINT_BUDGET_BUSY_DAY.orders * PRINT_REQUESTS_PER_TOKEN_SLIP * (1 + PRINT_BUDGET_BUSY_DAY.retryShare));
}

/** The owner's ruling (2026-10-06, the Phase 3 planning session, option A: accept and measure). A cafe in printers mode
 *  with a token per order may go over the 6,000 / 18,000 ceilings by its tokens, up to these: the two days that do
 *  (the 2C counter day and the heavy setup, with every printer-list read) are pinned exactly in print-budget.test.ts.
 *  A cafe without tokens is still held to the 6,000 / 18,000 ceilings. The pins count every slip at its own lease and
 *  ack (Session 2G measured 1.63 requests a job in printers mode), so the measured day is the gate: Phase 3's exit
 *  measures a token cafe in both modes against spec §17.3 item 5 (at most 20 % of the invocations and 15 % of the
 *  Active CPU on the busy day). */
export const PRINT_BUDGET_TOKEN_NORMAL_MAX_PER_DAY = 6_700;
export const PRINT_BUDGET_TOKEN_WORST_MAX_PER_DAY = 18_500;
/** Phase 3 (spec §9.3, §17): failover adds no request; who is online rides the wake's heartbeat. A writer that could not
 *  reach a network printer is passed over for it for PRINTER_UNREACHABLE_SKIP_MS while another device can take it, so
 *  such a printer costs that writer at most one lease and one ack per 5 minutes (a device that knows its printer is
 *  down never leases for it at all: Phase 1's rule). */
export function printUnreachableRequestsPerWriterPerDay(): number {
  return Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINTER_UNREACHABLE_SKIP_MS) * PRINT_REQUESTS_PER_SLIP;
}

/** Vercel Hobby's monthly function invocations (spec §17.1), as a day's share over 30 days: 33,333. */
export const VERCEL_HOBBY_INVOCATIONS_PER_DAY = Math.floor(1_000_000 / 30);

/** The busy day (spec §17.2's 300 orders) of a cafe whose one device takes and prints every order, at its
 *  worst: every bill rides with its KOT (Pay Now), so each bill costs a lease and an ack; every other KOT
 *  round is made leased. A retried slip costs a lease and an ack. The ack's `more` leaves no empty lease. */
export function printOneDeviceRequestsPerDay(): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const orders = PRINT_BUDGET_BUSY_DAY.orders;
  const slips = orders * (d.roundsPerOrder + d.billsPerOrder);
  const firstTries = orders * (d.roundsPerOrder * PRINT_REQUESTS_PER_DIRECT_SLIP + d.billsPerOrder * PRINT_REQUESTS_PER_SLIP);
  return Math.round(firstTries + slips * PRINT_BUDGET_BUSY_DAY.retryShare * PRINT_REQUESTS_PER_SLIP);
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

/** Printers mode publishes 1 realtime request per slip its writer did not ask for: its "queued" print-status
 *  aimed at that writer. No final state (the Phase 2B gate, G-1; it was 2), and no print-job nudge: that is
 *  for a host, and printers mode has none. A slip its writer asked for publishes nothing (Session 2B). */
export const PRINT_REALTIME_PER_PRINTER_SLIP = 1;

/** Phase 2 Session 2C: how long a device keeps the outlet's printers list before a focus reads it again (the
 *  "print-setup" frame reads it at once; this is the fallback for a missed frame). */
export const PRINT_SETUP_STALE_MS = 30 * 60 * 1000;
/** Session 2C (the 2C gate's review, I-2): a list a printer job shows to be stale (the pulse or the wake names a
 *  printer job aimed at this device that it does not print on) is read again at most this often. */
export const PRINT_SETUP_REFRESH_MIN_MS = 60 * 1000;

/** Session 2C: the printers reads of a day at most, every device refocused all day (spec §17.2's 3 + 5
 *  devices): mount and print-setup reads come on top only per page load and per admin save. */
export function printSetupReadsWorstPerDay(): number {
  const devices = PRINT_BUDGET_BUSY_DAY.agents + PRINT_BUDGET_BUSY_DAY.orderingDevices;
  return devices * Math.round((PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000) / PRINT_SETUP_STALE_MS);
}

/** Session 2C (decision 15 per printer line): the heavy day when the counter device, the writer of the full copy
 *  and the bills, takes every order: each round's full copy is made leased to it (one request); its bill follows
 *  through the ack's more, and each station slip costs its writer a lease and an ack, as before. */
export function printHeavyCounterDayRequests(): number {
  const d = PRINT_BUDGET_STATIONS_DAY;
  const fullCopies = PRINT_BUDGET_BUSY_DAY.orders * d.roundsPerOrder * d.fullCopyPerRound;
  return printRequestsForSlips(printStationSlipsPerDay({ fullCopy: true })) - Math.round(fullCopies * (PRINT_REQUESTS_PER_SLIP - PRINT_REQUESTS_PER_DIRECT_SLIP));
}
