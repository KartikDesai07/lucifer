// ─────────────────────────────────────────────────────────────────────────────
// CR2.3 — the staff-attention "pulse" CONTRACT, single-homed here (#31) because
// two runtime pieces inside the SAME app must agree on it without importing
// each other's private state:
//   • a cafe API route (server) polls open-request + accepted-self-order state
//     and serves this shape;
//   • a React provider (client) polls that route, diffs consecutive ticks with
//     `pulseArrival`, and drives an audible/visual alert + KOT auto-print off
//     `autoPrintCandidate`.
// This module is pure and client-safe (PURE JS/TS only, no Node/DB imports) —
// the same predicates run identically wherever the provider mounts.
// ─────────────────────────────────────────────────────────────────────────────

/** Server-side scan bound when counting/paging OPEN self-order requests — a
 *  cap, not a page size, so a stuck queue can never turn the poll into an
 *  unbounded collection scan on the free-tier cluster. */
export const PULSE_OPEN_SCAN_LIMIT = 50;

/** How many recently-accepted, still-UNPRINTED self-orders the payload carries
 *  at once (newest first). Unprinted-only is load-bearing (CR2.3 review C4): if
 *  printed rows occupied these slots, a backlog deeper than the limit would
 *  leave the OLDEST unprinted tickets invisible to both the alert bar and the
 *  auto-printer exactly when the printer device had been offline — the one
 *  scenario the queue exists for. Printing a shown row frees its slot, so a
 *  deep backlog drains oldest-visible-first across successive ticks. */
export const PULSE_SELF_ORDER_LIMIT = 5;

/** A self-order stays eligible to appear in the accepted list for this long
 *  after acceptance. */
export const PULSE_SELF_ORDER_WINDOW_MS = 60 * 60 * 1000;

/** Auto-print only fires for a self-order accepted within this long ago — an
 *  order accepted before the panel was opened (or before this device came
 *  back online) must NOT dump a stale ticket the moment the screen mounts. */
export const AUTO_PRINT_MAX_AGE_MS = 10 * 60 * 1000;

/** Minimum gap between repeat alerts for the SAME outstanding condition, so a
 *  staff member who dismisses a chime isn't re-alerted every poll tick. */
export const ALERT_REPEAT_MS = 2 * 60 * 1000;

/** Surfaced by the provider next to the alert UI: this pulse is polled from
 *  the mounted panel, not pushed — it has no server-side delivery guarantee
 *  if the screen is closed or the device goes to sleep. */
export const SELF_ORDER_ALERT_LIMITATION =
  "Alerts and auto-print only work while this panel is open on this device — keep this screen open at the counter.";

/** One self-order request accepted onto a table/tab, as carried over the wire
 *  (JSON — dates are ISO strings, never `Date`). */
export interface PulseSelfOrder {
  requestId: string;
  orderId: string;
  kotRound: number;
  acceptedAt: string;
  printed: boolean;
}

/** The full poll payload. `selfOrders` carries UNPRINTED self-orders only,
 *  sorted `acceptedAt` DESC (newest first) — every predicate below relies on
 *  that ordering instead of re-sorting; a printed row leaves the payload on
 *  the next tick (the `printed` field stays in the row type so client-side
 *  stale data between ticks still reads correctly). `selfOrdersTruncated`
 *  means the unprinted backlog reached the limit — older unprinted tickets
 *  exist beyond what is shown, recoverable via the Orders screen's manual KOT
 *  reprint. `openRev` is the max `updatedAt` (ISO) over currently-OPEN
 *  requests, or `null` when there are none; it changes on an in-place edit to
 *  an open request (e.g. a diner PATCHing their own pending request) even
 *  when the open count and newest-id stay the same. */
export interface PosPulseData {
  openCount: number;
  openTruncated: boolean;
  newestOpenId: string | null;
  newestOpenAt: string | null;
  openRev: string | null;
  selfOrders: PulseSelfOrder[];
  selfOrdersTruncated: boolean;
}

/** What changed between two consecutive polls, for the provider to act on. */
export interface PulseDelta {
  /** Sound/flash the staff-attention alert. */
  ring: boolean;
  /** Invalidate the staff pending-requests list. */
  requestsChanged: boolean;
  /** Invalidate orders + tables queries and re-render the unprinted list. */
  selfOrdersChanged: boolean;
}

/** Parses an ISO string to epoch ms, or `null` on a missing/malformed value —
 *  Date.parse never throws but silently returns NaN, and every caller here
 *  must treat that as "no usable timestamp", not a comparable number. */
function parseMsOrNull(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `nextIso` is a valid, STRICTLY newer timestamp than `prevIso`
 *  (or `prevIso` is absent). Any malformed/missing `nextIso` short-circuits to
 *  `false` — a ring must never fire off a timestamp we can't trust. */
function isNewerArrival(nextIso: string | null, prevIso: string | null): boolean {
  const nextMs = parseMsOrNull(nextIso);
  if (nextMs === null) return false;
  const prevMs = parseMsOrNull(prevIso);
  if (prevMs === null) return prevIso === null; // no prior value ⇒ newer; malformed prior ⇒ untrusted, no ring
  return nextMs > prevMs;
}

function computeRequestsChanged(prev: PosPulseData, next: PosPulseData): boolean {
  return (
    prev.openCount !== next.openCount ||
    prev.newestOpenId !== next.newestOpenId ||
    prev.openRev !== next.openRev
  );
}

function computeSelfOrdersChanged(prev: PulseSelfOrder[], next: PulseSelfOrder[]): boolean {
  if (prev.length !== next.length) return true;
  if ((prev[0]?.requestId ?? null) !== (next[0]?.requestId ?? null)) return true;

  const prevPrintedById = new Map(prev.map((row) => [row.requestId, row.printed]));
  for (const row of next) {
    const prevPrinted = prevPrintedById.get(row.requestId);
    if (prevPrinted !== undefined && prevPrinted !== row.printed) return true;
  }
  return false;
}

/**
 * Diffs two consecutive poll ticks into a `PulseDelta`. `prev === null` means
 * this is the FIRST successful tick after mount/reload — a reload is not an
 * arrival, so every field comes back `false` and the caller seeds its refs
 * silently (no alert on open).
 *
 * `ring` deliberately tests RECENCY of the newest arrival timestamp, never an
 * id/count change: accepting the currently-newest open request makes
 * `newestOpenId`/`newestOpenAt` fall back to an OLDER pending row, so an
 * id-change predicate would false-ring on every accept of the newest request.
 * A strictly-greater timestamp can't be produced by an accept (which only
 * removes rows), so it can't false-positive the same way.
 */
export function pulseArrival(prev: PosPulseData | null, next: PosPulseData): PulseDelta {
  if (prev === null) {
    return { ring: false, requestsChanged: false, selfOrdersChanged: false };
  }

  const openRing = isNewerArrival(next.newestOpenAt, prev.newestOpenAt);
  const selfOrderRing = isNewerArrival(
    next.selfOrders[0]?.acceptedAt ?? null,
    prev.selfOrders[0]?.acceptedAt ?? null,
  );

  return {
    ring: openRing || selfOrderRing,
    requestsChanged: computeRequestsChanged(prev, next),
    selfOrdersChanged: computeSelfOrdersChanged(prev.selfOrders, next.selfOrders),
  };
}

/**
 * Picks the OLDEST unprinted, still-eligible self-order to auto-print (kitchen
 * ticket order — first accepted, first printed), or `null` when none qualify.
 * Pure: the per-device "auto-print enabled" gate is the caller's concern, not
 * this function's. A malformed `acceptedAt` is skipped rather than throwing.
 */
export function autoPrintCandidate(
  selfOrders: PulseSelfOrder[],
  nowMs: number,
): PulseSelfOrder | null {
  let oldest: PulseSelfOrder | null = null;
  let oldestMs = Infinity;

  for (const row of selfOrders) {
    if (row.printed) continue;
    const acceptedMs = parseMsOrNull(row.acceptedAt);
    if (acceptedMs === null) continue;
    if (nowMs - acceptedMs > AUTO_PRINT_MAX_AGE_MS) continue;
    if (acceptedMs < oldestMs) {
      oldestMs = acceptedMs;
      oldest = row;
    }
  }

  return oldest;
}
