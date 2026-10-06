import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_HOST_MAX_AGE_MS, PRINT_JOB_KINDS } from "./print-job";
import {
  PRINT_BACKOFF_MS,
  PRINT_DIRECT_LEASE_DETAIL,
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  addPrintLabel,
  directLeaseOf,
  lifecycleOf,
  planAck,
  planConfirm,
  planExpiry,
  planLease,
  planLimits,
  planRetry,
  printBackoffMs,
  printBannerText,
  printJobFailedAtCreation,
  printJobInitialLabels,
  printJobLifecycleInit,
  printJobStale,
  printRepeatLabel,
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
  assert.equal(refusalOf(planLease(job({ uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS }), WHO, T0)).reason, "over-limits");
  assert.ok(planLease(job({ attempts: 50 }), WHO, T0).ok, "leases refused before writing never count toward the limit");
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

test("expiry: a KOT, notice, EOD or token whose lease ran out is queued again with its repeat label (REPRINT; a token says DUPLICATE) - it may have printed", () => {
  const after = T0 + PRINT_LEASE_MS + 1;
  for (const kind of PRINT_JOB_KINDS.filter((k) => k !== "bill")) {
    const patch = patchOf(planExpiry(leased({ kind }), after));
    assert.equal(patch.status, "queued", kind);
    assert.deepEqual(patch.set.labels, [printRepeatLabel(kind)], kind);
    assert.deepEqual(patch.set.labels, [kind === "token" ? "DUPLICATE" : "REPRINT"], `${kind}: the label is spelled out, not just derived`);
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

// The owner's rule after Session 1B (2026-10-03): at most two attempts that may reach paper, the first
// plus one labelled retry; refusals made before writing (the printer was off) never count.
test("limits: the second attempt that may have printed ends in failed; a refusal never counts, however often", () => {
  assert.equal(PRINT_MAX_PAPER_ATTEMPTS, 2, "the first attempt plus ONE labelled retry");
  const first = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(first.status, "queued", "the first maybe is retried once, labelled");
  assert.deepEqual(first.set.labels, ["REPRINT"], "the retry says REPRINT");
  const second = patchOf(planAck(leased({ uncertainAttempts: 1, labels: ["REPRINT"] }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(second.status, "failed", "the second maybe ends in failed");
  assert.equal(second.set.uncertainAttempts, 2, "both attempts are recorded");
  const expired = patchOf(planExpiry(leased({ uncertainAttempts: 1, lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0) } }), T0 + 1));
  assert.equal(expired.status, "failed", "a second lease that ran out counts the same as a second maybe");
  const refused = patchOf(planAck(leased({ attempts: 50, uncertainAttempts: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0));
  assert.equal(refused.status, "queued", "the 50th refusal still waits in line");
  assert.equal(refused.set.uncertainAttempts, undefined, "a refusal adds no attempt");
  const swept = patchOf(planLimits(job({ uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS }), T0));
  assert.equal(swept.status, "failed", "the sweep fails a queued job over the limit");
  assert.equal(refusalOf(planLimits(job({ uncertainAttempts: 1, attempts: 50 }), T0)).reason, "wrong-status", "many refused leases are not over the limit");
  assert.equal(refusalOf(planLimits(leased({ uncertainAttempts: 2 }), T0)).reason, "wrong-status", "only a queued job is failed by the sweep");
});

test("a bill: the first maybe asks the cashier; the cashier's print again is the one retry; a second maybe is failed", () => {
  const asked = patchOf(planAck(leased({ kind: "bill" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(asked.status, "needs-confirm", "the cashier decides after the first maybe");
  const again = patchOf(planConfirm(job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1 }), "reprint", "Asha", T0));
  const retried = lifecycleOf({ ...job({ kind: "bill", epoch: 1 }), ...again.set });
  const leasedAgain = patchOf(planLease(retried, WHO, T0));
  const secondMaybe = patchOf(
    planAck(lifecycleOf({ ...retried, ...leasedAgain.set }), { deviceId: "dev-a", epoch: 2, outcome: "failed", sent: "maybe" }, T0),
  );
  assert.equal(secondMaybe.status, "failed", "never a second cashier prompt: the bill waits in failed");
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

test("needs-confirm, print again: queued with DUPLICATE as the bill's one retry, approved now (never parked as stale)", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1, createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS) });
  const patch = patchOf(planConfirm(waiting, "reprint", "Asha", T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set, { status: "queued", labels: ["DUPLICATE"], attempts: 0, uncertainAttempts: 1, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
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

test("failed, retry: one staff tap is one more attempt, labelled when it may have printed, approved now", () => {
  const kot = patchOf(planRetry(job({ status: "failed", attempts: 8, uncertainAttempts: 2 }), T0));
  assert.deepEqual(kot.set, { status: "queued", labels: ["REPRINT"], attempts: 0, uncertainAttempts: 1, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.deepEqual(kot.unset, ["lastError"]);
  const bill = patchOf(planRetry(job({ kind: "bill", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(bill.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
  assert.equal(kot.log.event, "retried");
  const tapped = lifecycleOf({ ...job({ epoch: 3 }), ...kot.set });
  const lease = patchOf(planLease(tapped, WHO, T0));
  const maybe = patchOf(planAck(lifecycleOf({ ...tapped, ...lease.set }), { deviceId: "dev-a", epoch: 4, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(maybe.status, "failed", "one tap, one try: a maybe on the retried slip sends it back to failed");
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
    [{ kind: "token", snapshot, reprint: true }, ["DUPLICATE"]],
    [{ kind: "token", snapshot }, []],
    [{ kind: "eod", dateKey: "2026-10-02", dateLabel: "2 Oct" }, []],
  ];
  for (const [payload, labels] of cases) assert.deepEqual(printJobInitialLabels(payload), labels, JSON.stringify(payload).slice(0, 40));
});

// S7: the token is the customer's slip (like the bill: DUPLICATE) but is retried like a KOT (never parked for the cashier).
test("printRepeatLabel: a bill and a token say DUPLICATE, every other kind says REPRINT", () => {
  assert.equal(printRepeatLabel("token"), "DUPLICATE");
  assert.equal(printRepeatLabel("bill"), "DUPLICATE");
  for (const kind of PRINT_JOB_KINDS.filter((k) => k !== "bill" && k !== "token")) assert.equal(printRepeatLabel(kind), "REPRINT", kind);
  assert.ok(PRINT_JOB_KINDS.includes("token") && PRINT_JOB_KINDS.includes("kot"), "landmark: both sides of the split exist");
});

test("token, ack failed maybe sent: queued again with DUPLICATE (never needs-confirm, never REPRINT); the second maybe is failed", () => {
  const first = patchOf(planAck(leased({ kind: "token" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(first.status, "queued", "a token retries by itself: no cashier question");
  assert.deepEqual(first.set.labels, ["DUPLICATE"]);
  assert.equal(first.set.uncertainAttempts, 1);
  // Landmark: the bill beside it still parks for the cashier, so the token behaviour is the token's, not a loosened gate.
  assert.equal(patchOf(planAck(leased({ kind: "bill" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0)).status, "needs-confirm");
  const second = patchOf(planAck(leased({ kind: "token", uncertainAttempts: 1, labels: ["DUPLICATE"] }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(second.status, "failed", "the owner's two-attempt rule holds for a token too");
});

test("token, expiry: queued with DUPLICATE and never needs-confirm; a failed token retried by staff after a maybe is labelled DUPLICATE", () => {
  const expired = patchOf(planExpiry(leased({ kind: "token" }), T0 + PRINT_LEASE_MS + 1));
  assert.equal(expired.status, "queued");
  assert.notEqual(expired.status, "needs-confirm");
  assert.deepEqual(expired.set.labels, ["DUPLICATE"]);
  const retry = patchOf(planRetry(job({ kind: "token", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(retry.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ kind: "token", status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
});

test("2D: a printer's test slip is a kind of its own, starts with no label, and a repeat of it says REPRINT", () => {
  assert.ok(PRINT_JOB_KINDS.includes("test"), "the test kind is listed (the model's enum reads this list)");
  const payload: PrintJobPayload = { kind: "test", printerName: "Bar", lines: [], requestedBy: "Asha", requestedAt: "2026-10-04T10:00:00.000Z" };
  assert.deepEqual(printJobInitialLabels(payload), [], "a first test slip carries no banner");
  assert.equal(printRepeatLabel("test"), "REPRINT", "only a bill says DUPLICATE");
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

// Phase 2 Session 2B (spec §7.11, plan decision 15): a slip the asking tab prints itself is made already
// leased to it, in the one write that creates it.
function directRow(kind: PrintJobLifecycle["kind"], labels: PrintJobLifecycle["labels"] = []): PrintJobLifecycle {
  const direct = directLeaseOf({ labels, who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  return lifecycleOf({
    kind,
    status: direct.status,
    createdAt: new Date(T0),
    epoch: direct.epoch,
    attempts: direct.attempts,
    uncertainAttempts: direct.uncertainAttempts,
    nextAttemptAt: direct.nextAttemptAt,
    labels: direct.labels,
    lease: direct.lease,
  });
}

test("direct lease: a job made leased to the asking tab is exactly what a lease request would make of it", () => {
  const direct = directLeaseOf({ labels: ["DUPLICATE"], who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  const viaLease = patchOf(planLease(job({ labels: ["DUPLICATE"] }), WHO, T0));
  assert.equal(direct.status, viaLease.status, "leased");
  assert.equal(direct.epoch, viaLease.set.epoch, "epoch 1");
  assert.equal(direct.attempts, viaLease.set.attempts, "one attempt");
  assert.deepEqual(direct.lease, viaLease.set.lease, "the same 90 s lease, for the same tab");
  assert.deepEqual(
    { uncertainAttempts: direct.uncertainAttempts, nextAttemptAt: direct.nextAttemptAt, labels: direct.labels },
    { uncertainAttempts: 0, nextAttemptAt: new Date(T0), labels: ["DUPLICATE"] },
    "the create row's own fields, and its first label",
  );
  assert.deepEqual(
    direct.log.map((entry) => [entry.event, entry.deviceId, entry.detail]),
    [["created", "dev-a", undefined], ["leased", "dev-a", PRINT_DIRECT_LEASE_DETAIL]],
    "its history says it was leased when it was made",
  );
  assert.deepEqual(directLeaseOf({ labels: [], who: WHO, nowMs: T0 }).log[0], { at: new Date(T0), event: "created" }, "no asking device: the created entry names none");
});

test("direct lease: its tab's ack prints it; a tab that dies lets it expire into REPRINT, or the cashier's question for a bill", () => {
  assert.equal(patchOf(planAck(directRow("kot"), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + 5_000)).status, "printed");
  assert.equal(refusalOf(planExpiry(directRow("kot"), T0 + PRINT_LEASE_MS)).reason, "lease-held", "a live lease is never expired");
  const kot = patchOf(planExpiry(directRow("kot"), T0 + PRINT_LEASE_MS + 1));
  assert.deepEqual([kot.status, kot.set.labels, kot.set.uncertainAttempts], ["queued", ["REPRINT"], 1], "the KOT prints again, labelled");
  assert.equal(patchOf(planExpiry(directRow("bill"), T0 + PRINT_LEASE_MS + 1)).status, "needs-confirm", "a bill that may have printed asks the cashier");
  const late = patchOf(planAck({ ...directRow("kot"), status: "queued" }, { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + PRINT_LEASE_MS + 5_000));
  assert.equal(late.log.event, "late-ack", "a late ack from its tab still resolves it (spec §7.9)");
});

// Phase 2 Session 2C (spec §8: a KOT is never dropped): a slip no printer takes is made failed at once, in the
// write that creates it, so staff see it under "Couldn't print".
test("failed at creation: never attempted, its reason kept and logged, and a staff Retry queues it unlabelled", () => {
  const made = printJobFailedAtCreation({ labels: [], error: "No printer is set up for bills.", originDeviceId: "dev-a", nowMs: T0 });
  assert.deepEqual(
    [made.status, made.epoch, made.attempts, made.uncertainAttempts, made.lastError, made.labels],
    ["failed", 0, 0, 0, "No printer is set up for bills.", []],
    "nothing was attempted, so nothing can be on paper",
  );
  assert.deepEqual(
    made.log.map((entry) => [entry.event, entry.deviceId, entry.detail]),
    [["created", "dev-a", undefined], ["failed", undefined, "no printer: No printer is set up for bills."]],
    "its history says why",
  );
  const row = lifecycleOf({ kind: "bill", status: made.status, createdAt: new Date(T0), epoch: made.epoch, attempts: made.attempts, uncertainAttempts: made.uncertainAttempts, nextAttemptAt: made.nextAttemptAt, labels: made.labels });
  const retried = patchOf(planRetry(row, T0 + 1_000));
  assert.deepEqual([retried.status, retried.set.labels], ["queued", []], "a Retry queues it with no DUPLICATE: it never printed");
  assert.deepEqual(printJobFailedAtCreation({ labels: ["REPRINT"], error: "x", nowMs: T0 }).labels, ["REPRINT"], "a staff reprint keeps its label");
});
