import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  lifecycleOf,
  planAck,
  planConfirm,
  planExpiry,
  planLease,
  planLimits,
  planOfflinePrinted,
  planRetry,
  type PrintJobAck,
  type PrintJobLifecycle,
  type PrintJobPatch,
  type PrintJobPlan,
} from "./print-lifecycle";
import {
  PRINT_CLEARED_WHILE_PRINTING,
  clearRequestedOutcome,
  dismissRequestOf,
  lateAckAfterClear,
  withoutClearRequest,
} from "./print-lifecycle-clear";

// Printer UX PX-2 Task 1 (spec 2026-11-05 §6.9 B1, SR-3..SR-7, R7, R8): a staff Clear that lands while a slip is
// printing is kept on the job as a request; when that try ends without paper the job ends dismissed, and paper that
// came out (a printed ack, even a late one at the same epoch) still wins. Without the request every plan is today's.
// Kept apart from print-lifecycle.test.ts, which is already past the 300-line rule.

const NOW = Date.parse("2026-11-05T09:00:00.000Z");
const ASKED = new Date(NOW - 5_000);
const EXPIRES = NOW + 30_000;

function leased(kind: "kot" | "bill", over: Partial<PrintJobLifecycle> = {}): PrintJobLifecycle {
  return {
    kind,
    status: "leased",
    epoch: 3,
    attempts: 3,
    uncertainAttempts: 0,
    nextAttemptAt: new Date(NOW - 60_000),
    labels: [],
    createdAt: new Date(NOW - 60_000),
    lease: { deviceId: "d1", tabId: "t1", epoch: 3, expiresAt: new Date(EXPIRES) },
    dismissRequest: { at: ASKED, by: "Asha" },
    ...over,
  };
}
/** The same job as if the request had never been written. */
function bare(job: PrintJobLifecycle): PrintJobLifecycle {
  const copy = { ...job };
  delete copy.dismissRequest;
  return copy;
}
function ack(over: Partial<PrintJobAck> = {}): PrintJobAck {
  return { deviceId: "d1", epoch: 3, outcome: "failed", sent: "no", ...over };
}
function patchOf(plan: PrintJobPlan): PrintJobPatch {
  if (!plan.ok) throw new assert.AssertionError({ message: `expected a plan, got the refusal "${plan.reason}"` });
  return plan.patch;
}
const KOT = leased("kot");
const BILL = leased("bill");
/** The patch the request turns a try that ended without paper into. */
const DISMISSED: PrintJobPatch = {
  status: "dismissed",
  set: { status: "dismissed", dismissedAt: new Date(NOW), dismissReason: "staff", dismissedBy: "Asha" },
  unset: ["lease"],
  log: { at: new Date(NOW), event: "dismissed", deviceId: "d1", detail: "cleared while printing" },
};

test("a failed try that sent nothing ends dismissed, not queued", () => {
  assert.equal(PRINT_CLEARED_WHILE_PRINTING, "cleared while printing", "the log's words, verbatim from the spec");
  const plan = planAck(KOT, ack(), NOW);
  assert.equal(plan.ok, true, "the ack still applies");
  const patch = patchOf(plan);
  assert.equal(patch.status, "dismissed", "the staff's Clear ends the slip once the try sent nothing");
  assert.equal(patch.set.status, "dismissed", "the status is written");
  assert.equal(patch.set.dismissedBy, "Asha", "the clear names who asked");
  assert.equal(patch.set.dismissReason, "staff", "a staff Clear, as the band's readback names it");
  assert.deepEqual(patch.set.dismissedAt, new Date(NOW), "dismissed when the try ended");
  assert.deepEqual(patch.unset, ["lease"], "the lease goes; the request stays for a late printed ack (R8)");
  assert.equal(patch.log.event, "dismissed", "its history says it was dismissed");
  assert.equal(patch.log.detail, "cleared while printing", "and why");
  assert.deepEqual(patch, DISMISSED, "nothing else is written");
});

test("a maybe try ends dismissed: no REPRINT for a KOT, no check for a bill", () => {
  for (const job of [KOT, BILL]) {
    const patch = patchOf(planAck(job, ack({ sent: "maybe" }), NOW));
    assert.equal(patch.status, "dismissed", `${job.kind}: dismissed, never back in line or to the cashier`);
    assert.notEqual(patch.status, "needs-confirm", `${job.kind}: no "print again?" question`);
    assert.equal(patch.set.labels, undefined, `${job.kind}: no REPRINT / DUPLICATE label`);
    assert.deepEqual(patch, DISMISSED, `${job.kind}: the same dismissed patch`);
  }
});

test("a permanent failure and a try over the limits end dismissed", () => {
  for (const sent of ["no", "maybe"] as const) {
    const patch = patchOf(planAck(KOT, ack({ sent, permanent: true, error: "TOO_LARGE" }), NOW));
    assert.deepEqual(patch, DISMISSED, `a permanent failure (sent ${sent}) ends dismissed, not failed`);
  }
  for (const job of [leased("kot", { uncertainAttempts: 1 }), leased("bill", { uncertainAttempts: 1 })]) {
    const patch = patchOf(planAck(job, ack({ sent: "maybe" }), NOW));
    assert.equal(patch.status, "dismissed", `${job.kind}: a second maybe ends dismissed, not failed`);
    assert.deepEqual(patch, DISMISSED, `${job.kind}: the same dismissed patch`);
  }
});

test("paper that came out still wins", () => {
  for (const job of [KOT, BILL]) {
    const plan = planAck(job, ack({ outcome: "printed", sent: undefined }), NOW);
    assert.equal(patchOf(plan).status, "printed", `${job.kind}: a printed ack stays printed`);
    assert.deepEqual(plan, planAck(bare(job), ack({ outcome: "printed", sent: undefined }), NOW), `${job.kind}: today's printed patch`);
  }
});

test("a lease that ran out ends dismissed; a held lease is still held", () => {
  for (const job of [KOT, BILL, leased("kot", { uncertainAttempts: 1 })]) {
    const patch = patchOf(planExpiry(job, EXPIRES + 1));
    assert.equal(patch.status, "dismissed", `${job.kind}: dismissed, not queued / needs-confirm / failed`);
    assert.deepEqual(
      patch,
      { ...DISMISSED, set: { ...DISMISSED.set, dismissedAt: new Date(EXPIRES + 1) }, log: { ...DISMISSED.log, at: new Date(EXPIRES + 1) } },
      `${job.kind}: the log names the writer that went quiet`,
    );
  }
  assert.deepEqual(planExpiry(KOT, EXPIRES), { ok: false, reason: "lease-held" }, "a lease not yet over is held");
  assert.deepEqual(planExpiry(KOT, NOW), { ok: false, reason: "lease-held" }, "the request never cuts a lease short");
});

test("a stale or late ack is untouched", () => {
  assert.deepEqual(planAck(KOT, ack({ epoch: 2 }), NOW), { ok: false, reason: "stale-epoch" }, "an older try's failure is refused as today");
  assert.deepEqual(planAck(KOT, ack({ epoch: 2 }), NOW), planAck(bare(KOT), ack({ epoch: 2 }), NOW), "the same refusal without the request");
  const dismissed = leased("kot", { status: "dismissed" });
  for (const late of [ack(), ack({ sent: "maybe" }), ack({ outcome: "printed", sent: undefined, epoch: 2 })]) {
    assert.deepEqual(planAck(dismissed, late, NOW), { ok: false, reason: "resolved" }, `a dismissed job stays resolved (${late.outcome}, epoch ${late.epoch})`);
  }
  const printed = leased("kot", { status: "printed" });
  for (const late of [ack(), ack({ outcome: "printed", sent: undefined })]) {
    assert.deepEqual(planAck(printed, late, NOW), { ok: false, reason: "resolved" }, `a printed job stays resolved (${late.outcome})`);
  }
  assert.deepEqual(
    planAck(bare(dismissed), ack({ outcome: "printed", sent: undefined }), NOW),
    { ok: false, reason: "resolved" },
    "a dismissed job without the request + a printed ack is resolved, as today",
  );
});

test("without a request every plan is today's", () => {
  const notSent = planAck(bare(KOT), ack(), NOW);
  assert.deepEqual(
    notSent,
    {
      ok: true,
      patch: {
        status: "queued",
        set: { status: "queued", nextAttemptAt: new Date(NOW + 10_000), lastError: "nothing was sent" },
        unset: ["lease"],
        log: { at: new Date(NOW), event: "failed", deviceId: "d1", detail: "not sent: nothing was sent" },
      },
    },
    "sent no: back in line after the third lease's 10 s backoff",
  );
  const kotMaybe = planAck(bare(KOT), ack({ sent: "maybe" }), NOW);
  assert.deepEqual(
    kotMaybe,
    {
      ok: true,
      patch: {
        status: "queued",
        set: { status: "queued", uncertainAttempts: 1, labels: ["REPRINT"], nextAttemptAt: new Date(NOW + 10_000), lastError: "may have printed" },
        unset: ["lease"],
        log: { at: new Date(NOW), event: "failed", deviceId: "d1", detail: "may have printed" },
      },
    },
    "a KOT maybe: back in line as its REPRINT",
  );
  const billMaybe = planAck(bare(BILL), ack({ sent: "maybe" }), NOW);
  assert.deepEqual(
    billMaybe,
    {
      ok: true,
      patch: {
        status: "needs-confirm",
        set: { status: "needs-confirm", uncertainAttempts: 1, lastError: "may have printed" },
        unset: ["lease"],
        log: { at: new Date(NOW), event: "failed", deviceId: "d1", detail: "may have printed" },
      },
    },
    "a bill maybe: the cashier's question",
  );
  const cases: Array<[string, (job: PrintJobLifecycle) => PrintJobPlan]> = [
    ["sent no", (job) => planAck(job, ack(), NOW)],
    ["maybe", (job) => planAck(job, ack({ sent: "maybe" }), NOW)],
    ["permanent", (job) => planAck(job, ack({ permanent: true }), NOW)],
    ["over the limits", (job) => planAck({ ...job, uncertainAttempts: 1 }, ack({ sent: "maybe" }), NOW)],
    ["printed", (job) => planAck(job, ack({ outcome: "printed", sent: undefined }), NOW)],
    ["expired", (job) => planExpiry(job, EXPIRES + 1)],
    ["held", (job) => planExpiry(job, EXPIRES)],
    ["stale epoch", (job) => planAck(job, ack({ epoch: 2 }), NOW)],
    ["retry", (job) => planRetry({ ...job, status: "failed" }, NOW)],
    ["reprint", (job) => planConfirm({ ...job, status: "needs-confirm" }, "reprint", "Ravi", NOW)],
  ];
  for (const job of [KOT, BILL]) {
    for (const [name, run] of cases) {
      const today = run(bare(job));
      assert.equal(today.ok && today.patch.status === "dismissed", false, `${job.kind} ${name}: never dismissed without the request`);
      assert.equal(clearRequestedOutcome(bare(job), today, NOW, "d1"), today, `${job.kind} ${name}: the clear outcome passes it through`);
      assert.equal(withoutClearRequest(bare(job), today), today, `${job.kind} ${name}: no request to unset`);
    }
    const dismissed = bare({ ...job, status: "dismissed" });
    assert.equal(lateAckAfterClear(dismissed, ack({ outcome: "printed", sent: undefined }), NOW), null, `${job.kind}: no late-ack case`);
  }
  assert.deepEqual(planAck(bare(BILL), ack({ sent: "maybe" }), NOW), billMaybe, "the same input, the same plan");
});

test("lifecycleOf reads the request", () => {
  const doc = { kind: "kot" as const, status: "leased" as const, createdAt: new Date(NOW), epoch: 3 };
  assert.deepEqual(lifecycleOf({ ...doc, dismissRequestedAt: ASKED, dismissRequestedBy: "Asha" }).dismissRequest, { at: ASKED, by: "Asha" }, "who asked, and when");
  assert.equal(lifecycleOf({ ...doc, dismissRequestedAt: ASKED }).dismissRequest?.by, "Staff", "a nameless request is the staff's");
  assert.equal(lifecycleOf({ ...doc, dismissRequestedAt: ASKED, dismissRequestedBy: "" }).dismissRequest?.by, "Staff", "an empty name too");
  const without = lifecycleOf({ ...doc, dismissRequestedBy: "Asha" });
  assert.equal(without.dismissRequest, undefined, "no time, no request");
  assert.equal("dismissRequest" in without, false, "the field is absent, so the object is today's");
  assert.equal("dismissRequest" in lifecycleOf(doc), false, "a row from before PX-2 reads as today");
  const notADate = { ...doc, dismissRequestedAt: "2026-11-05" as unknown as Date };
  assert.equal(dismissRequestOf(notADate), undefined, "only a real Date counts, so a malformed field never ends a slip");
  assert.equal("dismissRequest" in lifecycleOf(notADate), false, "and lifecycleOf leaves it out");
});

test("a late printed ack on a slip the request ended is printed", () => {
  const dismissed = leased("kot", { status: "dismissed" });
  const late = ack({ outcome: "printed", sent: undefined });
  const patch = patchOf(planAck(dismissed, late, NOW));
  assert.equal(patch.status, "printed", "the paper is on the counter: never recorded as cleared");
  assert.equal(patch.log.event, "late-ack", "its history says the ack came late");
  const todayLate = planAck(bare(leased("kot", { status: "queued", lease: undefined })), late, NOW);
  assert.deepEqual(patch, patchOf(todayLate), "the same patch as today's late ack");
  assert.deepEqual(lateAckAfterClear(dismissed, late, NOW), { ok: true, patch }, "the helper makes it");
  assert.deepEqual(planAck(dismissed, ack({ outcome: "printed", sent: undefined, epoch: 2 }), NOW), { ok: false, reason: "resolved" }, "an older try's ack is refused");
  assert.deepEqual(planAck(bare(dismissed), late, NOW), { ok: false, reason: "resolved" }, "without the request: resolved, as today");
  assert.equal(lateAckAfterClear(leased("kot", { status: "printed" }), late, NOW), null, "a printed job is not printed twice");
});

test("Try again and Print again unset a leftover request", () => {
  const failed = leased("kot", { status: "failed", uncertainAttempts: 1, lease: undefined });
  const stale = leased("kot", { status: "queued", createdAt: new Date(NOW - 31 * 60_000), lease: undefined });
  const needsConfirm = leased("bill", { status: "needs-confirm", uncertainAttempts: 1, lease: undefined });
  const taps: Array<[string, PrintJobLifecycle, (job: PrintJobLifecycle) => PrintJobPlan, string[]]> = [
    ["Try again", failed, (job) => planRetry(job, NOW), ["lastError"]],
    ["Print now", stale, (job) => planRetry(job, NOW), []],
    ["Print again", needsConfirm, (job) => planConfirm(job, "reprint", "Ravi", NOW), ["lastError"]],
  ];
  for (const [name, job, run, todayUnset] of taps) {
    const today = patchOf(run(bare(job)));
    assert.deepEqual(today.unset, todayUnset, `${name}: today's unset without the request`);
    assert.deepEqual(
      run(job),
      { ok: true, patch: { ...today, unset: [...todayUnset, "dismissRequestedAt", "dismissRequestedBy"] } },
      `${name}: today's patch, and the later tap wins over the earlier Clear`,
    );
  }
  assert.equal(patchOf(planRetry(bare(failed), NOW)).set.uncertainAttempts, PRINT_MAX_PAPER_ATTEMPTS - 1, "one more attempt, as today");
  assert.deepEqual(planRetry(KOT, NOW), { ok: false, reason: "wrong-status" }, "a printing slip cannot be retried");
  assert.deepEqual(planConfirm(KOT, "reprint", "Ravi", NOW), { ok: false, reason: "wrong-status" }, "nor asked again");
});

test("lease and limits ignore the request", () => {
  const queued = leased("kot", { status: "queued", nextAttemptAt: new Date(NOW), lease: undefined });
  const overLimits = { ...queued, uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS };
  const needsConfirm = leased("bill", { status: "needs-confirm", uncertainAttempts: 1, lease: undefined });
  const fresh = leased("kot", { status: "queued", epoch: 0, attempts: 0, nextAttemptAt: new Date(NOW), lease: undefined });
  const calls: Array<[string, PrintJobLifecycle, (job: PrintJobLifecycle) => PrintJobPlan]> = [
    ["a lease", queued, (job) => planLease(job, { deviceId: "d2", tabId: "t2" }, NOW)],
    ["the limits", overLimits, (job) => planLimits(job, NOW)],
    ["It printed", needsConfirm, (job) => planConfirm(job, "printed", "Ravi", NOW)],
    ["Dismiss", needsConfirm, (job) => planConfirm(job, "dismiss", "Ravi", NOW)],
    ["an offline print", fresh, (job) => planOfflinePrinted(job, "d1", "offline O-1", NOW)],
  ];
  for (const [name, job, run] of calls) {
    const plan = run(job);
    assert.equal(plan.ok, true, `${name}: applies`);
    assert.deepEqual(plan, run(bare(job)), `${name}: the same plan with or without the request`);
  }
  const lease = patchOf(planLease(queued, { deviceId: "d2", tabId: "t2" }, NOW));
  assert.deepEqual(lease.set.lease?.expiresAt, new Date(NOW + PRINT_LEASE_MS), "a lease leaves the request (and is a full lease)");
  assert.equal(lease.unset.length, 0, "nothing is unset by a lease");
});
