// Kitchen board, paid Walk-In / parcel arm (spec 2026-11-13 kitchen-paid-walkin, owner rules O3/O4) — the pure Mongo
// filter builders. Pure: no DB, no React, no fetch (the server read that runs them comes later).
//
// A PAID order of the business day with no table (Walk-In) or marked parcel stays on the Kitchen board until Ready or
// the 120 minute stale-out, exactly like a paid token order. Every call returns FRESH objects: no nested array or
// object is shared between calls or with OPEN_TAB_FILTER.
import { OPEN_TAB_FILTER, PAID_STATUS, paidTokenFilter, type TokenMode } from "@/lib/token-board";

/** A paid order of the current business day with no table (`tableNo: null` matches absent and null) or a parcel. */
export function paidWalkInFilter(dayStart: Date) {
  return {
    status: PAID_STATUS,
    createdAt: { $gte: dayStart },
    $or: [{ tableNo: null }, { parcel: true }],
  };
}

/** The Walk-In arm's own read. Tokens on, token orders belong to the token arm, so they are skipped here. */
export function walkInArmFilter(mode: TokenMode) {
  const walkIn = paidWalkInFilter(mode.dayStart);
  return mode.enabled ? { ...walkIn, tokenNumber: { $exists: false } } : walkIn;
}

/** THE kitchen gate with the Walk-In arm: open tabs, the paid-token arm (tokens on only), and paid Walk-Ins. */
export function kitchenGateFilter(mode: TokenMode) {
  return {
    $or: [
      { ...OPEN_TAB_FILTER },
      ...(mode.enabled ? [paidTokenFilter(mode.dayStart)] : []),
      paidWalkInFilter(mode.dayStart),
    ],
  };
}
