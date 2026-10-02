import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_HOST_MAX_AGE_MS, PRINT_JOB_KINDS } from "./print-job";
import {
  PRINT_BACKOFF_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_ATTEMPTS,
  addPrintLabel,
  lifecycleOf,
  planAck,
  planConfirm,
  planExpiry,
  planLease,
  planLimits,
  planRetry,
  printBackoffMs,
  printBannerText,
  printJobInitialLabels,
  printJobLifecycleInit,
  printJobStale,
  type PrintJobLifecycle,
  type PrintJobLogEntry,
  type PrintJobPatch,
  type PrintJobPlan,
} from "./print-lifecycle";
import type { PrintJobPayload } from "./schemas/print-job.schema";

// Spec §7.2, row by row. T0 is "now"; every job below was created at T0 unless it says otherwise.
const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };

function job(over: Partial<PrintJobLifecycle> = {}): PrintJobLifecycle {
  return {
    kind: "kot",
    status: "queued",
    epoch: 0,
    attempts: 0,
    uncertainAttempts: 0,
    nextAttemptAt: new Date(T0),
    labels: [],
    createdAt: new Date(T0),
    ...over,
  };
}
function leased(over: Partial<PrintJobLifecycle> = {}): PrintJobLifecycle {
  return job({
    status: "leased",
    epoch: 1,
    attempts: 1,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
    ...over,
  });
}
function patchOf(plan: PrintJobPlan): PrintJobPatch {
  if (!plan.ok) throw new assert.AssertionError({ message: `expected a plan, got the refusal "${plan.reason}"` });
  return plan.patch;
}
function refusalOf(plan: PrintJobPlan): { reason: string; log?: PrintJobLogEntry } {
  if (plan.ok) throw new assert.AssertionError({ message: `expected a refusal, got status "${plan.patch.status}"` });
  return plan;
}

test("create: a new job starts queued with zero counters, due now, epoch 0", () => {
  assert.deepEqual(printJobLifecycleInit(T0), { epoch: 0, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), labels: [] });
  assert.deepEqual(printJobLifecycleInit(T0, ["DUPLICATE"]).labels, ["DUPLICATE"]);
});

test("lease: a due queued job is leased for 90 s; epoch and attempts both step up", () => {
  const patch = patchOf(planLease(job({ epoch: 4, attempts: 2 }), WHO, T0));
  assert.equal(patch.status, "leased");
  assert.deepEqual(patch.set, {
    status: "leased",
    epoch: 5,
    attempts: 3,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 5, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
  });
  assert.deepEqual(patch.unset, []);
  assert.equal(patch.log.event, "leased");
  assert.equal(patch.log.deviceId, "dev-a");
});

test("lease: refused while in backoff, when stale, when over limits, and for every other status", () => {
  assert.equal(refusalOf(planLease(job({ nextAttemptAt: new Date(T0 + 1) }), WHO, T0)).reason, "not-due");
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  assert.equal(refusalOf(planLease(old, WHO, T0)).reason, "stale");
  assert.equal(refusalOf(planLease(job({ attempts: PRINT_MAX_ATTEMPTS }), WHO, T0)).reason, "over-limits");
  for (const status of ["leased", "printed", "needs-confirm", "failed", "dismissed"] as const) {
    assert.equal(refusalOf(planLease(job({ status }), WHO, T0)).reason, "wrong-status", status);
  }
});

test("lease: exactly 30 minutes old is still leasable; a stale job staff approved is leasable", () => {
  assert.ok(planLease(job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS) }), WHO, T0).ok, "the boundary is still fresh");
  const approved = job({ createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS), approvedAt: new Date(T0 - 1) });
  assert.ok(planLease(approved, WHO, T0).ok);
  assert.equal(printJobStale(approved, T0), false);
});

test("expiry: a KOT, notice or EOD whose lease ran out is queued again with REPRINT (it may have printed)", () => {
  const after = T0 + PRINT_LEASE_MS + 1;
  for (const kind of PRINT_JOB_KINDS.filter((k) => k !== "bill")) {
    const patch = patchOf(planExpiry(leased({ kind }), after));
    assert.equal(patch.status, "queued", kind);
    assert.deepEqual(patch.set.labels, ["REPRINT"], kind);
    assert.equal(patch.set.uncertainAttempts, 1, kind);
    assert.deepEqual(patch.set.nextAttemptAt, new Date(after + printBackoffMs(1)), kind);
    assert.deepEqual(patch.unset, ["lease"], kind);
    assert.equal(patch.log.event, "expired");
    assert.equal(patch.log.deviceId, "dev-a", "the log names the writer that went quiet");
  }
});

test("expiry: a bill whose lease ran out waits for the cashier (needs-confirm), never reprinted by itself", () => {
  const patch = patchOf(planExpiry(leased({ kind: "bill" }), T0 + PRINT_LEASE_MS + 1));
  assert.equal(patch.status, "needs-confirm");
  assert.equal(patch.set.labels, undefined, "DUPLICATE is added only when the cashier says print again");
  assert.equal(patch.set.uncertainAttempts, 1);
});

test("expiry: a live lease is held; only a leased job can expire", () => {
  assert.equal(refusalOf(planExpiry(leased(), T0 + PRINT_LEASE_MS)).reason, "lease-held", "expiresAt itself is still held");
  assert.equal(refusalOf(planExpiry(job(), T0 + PRINT_LEASE_MS + 1)).reason, "wrong-status");
});

test("ack printed with the lease's epoch: printed, stamped with the writer, lease and error cleared", () => {
  const patch = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + 5_000));
  assert.equal(patch.status, "printed");
  assert.deepEqual(patch.set, { status: "printed", printedAt: new Date(T0 + 5_000), printedBy: "dev-a" });
  assert.deepEqual(patch.unset, ["lease", "lastError"]);
  assert.equal(patch.log.event, "printed");
});

test("ack failed, nothing sent: queued again after the backoff, no label, no uncertain attempt", () => {
  const patch = patchOf(planAck(leased({ attempts: 3 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: "NOT_CONNECTED" }, T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set.nextAttemptAt, new Date(T0 + 10_000), "the third attempt waits 10 s");
  assert.equal(patch.set.labels, undefined);
  assert.equal(patch.set.uncertainAttempts, undefined);
  assert.equal(patch.set.lastError, "NOT_CONNECTED");
});

test("backoff after a refusal: 2 s, 5 s, 10 s, then every 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(printBackoffMs), [2_000, 5_000, 10_000, 30_000, 30_000, 30_000]);
  assert.equal(printBackoffMs(0), PRINT_BACKOFF_MS[0], "a job never leased waits the shortest step");
});

test("ack failed, maybe sent: a KOT is queued again with REPRINT; a bill waits for the cashier", () => {
  const kot = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(kot.status, "queued");
  assert.deepEqual(kot.set.labels, ["REPRINT"]);
  assert.equal(kot.set.uncertainAttempts, 1);
  assert.equal(kot.set.lastError, "may have printed", "a failure with no text still says why");
  const bill = patchOf(planAck(leased({ kind: "bill" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(bill.status, "needs-confirm");
});

test("ack failed with a permanent error: failed at once, no retry", () => {
  const patch = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", permanent: true, error: "TOO_LARGE" }, T0));
  assert.equal(patch.status, "failed");
  assert.equal(patch.set.lastError, "TOO_LARGE");
  assert.equal(patch.set.uncertainAttempts, 0, "nothing was sent, so no uncertain attempt");
  const maybe = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe", permanent: true }, T0));
  assert.equal(maybe.set.uncertainAttempts, 1, "a permanent error after a byte left still counts as maybe printed");
});

test("limits: the third uncertain attempt or the eighth lease ends in failed, never another retry", () => {
  const third = patchOf(planAck(leased({ uncertainAttempts: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(third.status, "failed");
  const eighth = patchOf(planAck(leased({ attempts: PRINT_MAX_ATTEMPTS }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0));
  assert.equal(eighth.status, "failed");
  const swept = patchOf(planLimits(job({ uncertainAttempts: 3 }), T0));
  assert.equal(swept.status, "failed");
  assert.equal(refusalOf(planLimits(job({ uncertainAttempts: 2, attempts: 7 }), T0)).reason, "wrong-status");
  assert.equal(refusalOf(planLimits(leased({ uncertainAttempts: 3 }), T0)).reason, "wrong-status", "only a queued job is failed by the sweep");
});

test("late ack (spec §7.9): a printed ack for the epoch that expired still resolves the job", () => {
  for (const status of ["queued", "needs-confirm", "failed"] as const) {
    const patch = patchOf(planAck(job({ status, epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
    assert.equal(patch.status, "printed", status);
    assert.equal(patch.log.event, "late-ack", status);
  }
});

test("stale epoch: an ack from an attempt that was leased again is logged and otherwise ignored", () => {
  const releasedAgain = refusalOf(planAck(leased({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
  assert.equal(releasedAgain.reason, "stale-epoch");
  assert.equal(releasedAgain.log?.event, "late-ack");
  assert.match(releasedAgain.log?.detail ?? "", /ignored/);
  const expiredAgain = refusalOf(planAck(job({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
  assert.equal(expiredAgain.reason, "stale-epoch", "leased again and expired again: still not this attempt's job");
  const oldFailure = refusalOf(planAck(leased({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(oldFailure.reason, "stale-epoch");
  assert.equal(oldFailure.log, undefined, "a stale failure report changes nothing and is not worth a write");
});

test("idempotent acks: a repeated printed ack of a printed job is 'resolved'; a failed ack outside its lease is 'not-leased'", () => {
  assert.equal(refusalOf(planAck(job({ status: "printed", epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0)).reason, "resolved");
  assert.equal(refusalOf(planAck(job({ status: "dismissed", epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0)).reason, "resolved");
  assert.equal(refusalOf(planAck(job({ epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0)).reason, "not-leased");
});

test("needs-confirm, print again: queued with DUPLICATE, counters reset, approved now (never parked as stale)", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1, createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS) });
  const patch = patchOf(planConfirm(waiting, "reprint", "Asha", T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set, { status: "queued", labels: ["DUPLICATE"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.equal(patch.log.event, "confirmed");
  assert.ok(planLease(lifecycleOf({ ...waiting, ...patch.set }), WHO, T0).ok, "the cashier's reprint is leasable at once");
});

test("needs-confirm, it printed / dismiss: printed by the cashier, or dismissed as 'cashier'", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1 });
  const said = patchOf(planConfirm(waiting, "printed", "Asha", T0));
  assert.deepEqual(said.set, { status: "printed", printedAt: new Date(T0), printedBy: "Asha" });
  const dropped = patchOf(planConfirm(waiting, "dismiss", "Asha", T0));
  assert.deepEqual(dropped.set, { status: "dismissed", dismissedAt: new Date(T0), dismissReason: "cashier", dismissedBy: "Asha" });
  assert.equal(dropped.log.event, "dismissed");
  assert.equal(refusalOf(planConfirm(job(), "printed", "Asha", T0)).reason, "wrong-status", "only a job waiting for a decision takes one");
});

test("failed, print again: labelled when it may have printed, counters reset, approved now", () => {
  const kot = patchOf(planRetry(job({ status: "failed", attempts: 8, uncertainAttempts: 1 }), T0));
  assert.deepEqual(kot.set, { status: "queued", labels: ["REPRINT"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.deepEqual(kot.unset, ["lastError"]);
  const bill = patchOf(planRetry(job({ kind: "bill", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(bill.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
  assert.equal(kot.log.event, "retried");
});

test("stale, print now: a 30-minute-old queued job becomes leasable; a fresh one needs no tap", () => {
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  const patch = patchOf(planRetry(old, T0));
  assert.deepEqual(patch.set, { approvedAt: new Date(T0), nextAttemptAt: new Date(T0) });
  assert.equal(patch.status, "queued");
  assert.ok(planLease(lifecycleOf({ ...old, ...patch.set }), WHO, T0).ok);
  assert.equal(refusalOf(planRetry(job(), T0)).reason, "wrong-status");
});

test("labels: only ever added, kept in banner order, and printed as one banner", () => {
  assert.deepEqual(addPrintLabel(["REPRINT"], "BACKUP PRINTER"), ["BACKUP PRINTER", "REPRINT"]);
  assert.deepEqual(addPrintLabel(["REPRINT"], "REPRINT"), ["REPRINT"], "no duplicate label");
  assert.equal(printBannerText(["REPRINT", "BACKUP PRINTER"]), "BACKUP PRINTER · REPRINT");
  assert.equal(printBannerText([]), "");
});

test("a client-started repeat carries its label from the start (spec §7.7)", () => {
  const snapshot = {} as never;
  const cases: Array<[PrintJobPayload, string[]]> = [
    [{ kind: "kot", snapshot, round: null }, ["REPRINT"]],
    [{ kind: "kot", snapshot, round: 2 }, []],
    [{ kind: "bill", snapshot, reprint: true }, ["DUPLICATE"]],
    [{ kind: "bill", snapshot }, []],
    [{ kind: "eod", dateKey: "2026-10-02", dateLabel: "2 Oct" }, []],
  ];
  for (const [payload, labels] of cases) assert.deepEqual(printJobInitialLabels(payload), labels, JSON.stringify(payload).slice(0, 40));
});

test("lifecycleOf: a row from before Phase 1 reads as a fresh job due since it was created", () => {
  const legacy = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0 - 1_000), labels: ["REPRINT", "BOGUS"] });
  assert.equal(legacy.epoch, 0);
  assert.equal(legacy.attempts, 0);
  assert.equal(legacy.uncertainAttempts, 0);
  assert.deepEqual(legacy.nextAttemptAt, new Date(T0 - 1_000));
  assert.deepEqual(legacy.labels, ["REPRINT"], "an unknown label is dropped, never printed");
  assert.ok(planLease(legacy, WHO, T0).ok);
});
