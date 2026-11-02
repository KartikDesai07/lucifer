// Perf P1 F7 — a realtime nudge reads the floor fresh.
//
// GET /api/tables is served from a per-instance cache (TTL.TABLES, 5 s), so a
// nudge-driven tables refetch could land on a warm instance still holding the
// old floor; a second "late" refetch 6 s later used to read past it. Instead,
// a visible nudge round marks this flag (RealtimeInvalidateSpec.onRound) and
// the very next tables fetch — the round's own refetch — reads
// /api/tables?fresh=1 (TABLES_FRESH_PARAM, the route's existing cache bypass).
// One-shot: every other tables fetch (the poll, a mount, a focus) stays the
// plain cached read.

let freshReadDue = false;

/** A nudge round is about to refetch the tables: the next tables fetch reads fresh. */
export function markTablesFreshRead(): void {
  freshReadDue = true;
}

/** True once after a mark (and clears it): the caller's fetch reads past the instance cache. */
export function takeTablesFreshRead(): boolean {
  const due = freshReadDue;
  freshReadDue = false;
  return due;
}
