// ─────────────────────────────────────────────────────────────────────────────
// F3.8 — the hot-add pump's result vocabulary (split out of hotadd-plan.ts to
// respect the 300-line file-length rule; hotadd.ts is the only consumer — no
// port/step body needs these). Pure types only, no IO.
// ─────────────────────────────────────────────────────────────────────────────

// ── Pump status vocabulary (mapped onto POST /api/tasks/[id]/run's response):
// done=closed this pump (D4); creating=M0 not IDLE, re-pump (D1/A3); busy=
// Retry-After would blow the budget (A2/HotAddBusy); already-rolled=fill
// rolled elsewhere, closes done (D4/A6); in-progress=claimed, no terminal
// outcome yet; lost-lease=killed pump's lease lapsed (A4); closed-by-other=
// another run closed first (A5); refused=not-active tenant/wrong type/
// done-dismissed/no approvedBy (D13/A1).
export type HotAddStatus =
  | "done"
  | "creating"
  | "busy"
  | "already-rolled"
  | "in-progress"
  | "lost-lease"
  | "closed-by-other"
  | "refused";

/** R8 (post-review fix wave): machine-readable classification of a 'refused'
 *  result — lets the route map specific refusals (e.g. 403 on a fresh
 *  step-up requirement) without parsing `note` text. Only "needs-step-up" is
 *  wired up today; the rest are reserved for finer-grained future refusals. */
export type HotAddRefusalCode = "needs-step-up" | "not-consumable" | "tenant-not-active" | "standby-collision";
