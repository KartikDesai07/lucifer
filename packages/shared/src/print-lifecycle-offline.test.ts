import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycleOf, planLease, planOfflinePrinted, printJobPrintedAtCreation, printJobReprintAtCreation, PRINT_MAX_PAPER_ATTEMPTS } from "./print-lifecycle";

// Printing Phase 5 (spec 2026-11-03 §5.9): the two jobs an offline round makes besides today's. A line the device
// printed offline is born printed (never leased, never announced); a line whose offline write may have put paper out is
// born queued with REPRINT and one uncertain attempt, so its one retry says REPRINT and a second maybe fails it.
// Kept apart from print-lifecycle.test.ts, which is already past the 300-line rule.

const T0 = Date.parse("2026-11-04T08:00:00.000Z");

test("a job born printed carries its printer, time and log", () => {
  const made = printJobPrintedAtCreation({ labels: [], deviceId: "dev-a", detail: "offline O-3", originDeviceId: "dev-a", nowMs: T0 });
  assert.deepEqual(
    [made.status, made.epoch, made.attempts, made.uncertainAttempts, made.labels],
    ["printed", 0, 0, 0, []],
    "printed on the device, never leased by the server",
  );
  assert.equal(made.printedAt.getTime(), T0, "printed at creation");
  assert.equal(made.printedBy, "dev-a", "printed by the device that took the round");
  assert.deepEqual(
    made.log.map((entry) => [entry.event, entry.deviceId, entry.detail]),
    [["created", "dev-a", undefined], ["printed", "dev-a", "offline O-3"]],
    "its history says it printed offline",
  );
  assert.equal(made.nextAttemptAt.getTime(), T0, "the lifecycle's init fields are there");
  const row = lifecycleOf({ kind: "kot", status: made.status, createdAt: new Date(T0), epoch: made.epoch, attempts: made.attempts });
  assert.equal(planLease(row, { deviceId: "dev-b", tabId: "t" }, T0).ok, false, "a printed job is never leased");
});

test("a reprint at creation adds REPRINT once and counts one uncertain attempt", () => {
  const made = printJobReprintAtCreation({ labels: [], originDeviceId: "dev-a", nowMs: T0 });
  assert.deepEqual(
    [made.status, made.epoch, made.attempts, made.uncertainAttempts, made.labels],
    ["queued", 0, 0, 1, ["REPRINT"]],
    "queued, labelled REPRINT, the offline write counted as one attempt that may have reached paper",
  );
  assert.deepEqual(made.log.map((entry) => [entry.event, entry.deviceId]), [["created", "dev-a"]], "created, nothing else yet");
  assert.deepEqual(printJobReprintAtCreation({ labels: ["REPRINT"], nowMs: T0 }).labels, ["REPRINT"], "REPRINT is never added twice");
  assert.ok(made.uncertainAttempts < PRINT_MAX_PAPER_ATTEMPTS, "one more attempt is allowed");
  const row = lifecycleOf({ kind: "kot", status: made.status, createdAt: new Date(T0), epoch: made.epoch, attempts: made.attempts, uncertainAttempts: made.uncertainAttempts, nextAttemptAt: made.nextAttemptAt, labels: made.labels });
  const lease = planLease(row, { deviceId: "dev-b", tabId: "t" }, T0);
  assert.equal(lease.ok, true, "its one retry may be leased");
});

test("the replay moves a queued job never tried to printed; anything else stays", () => {
  const queued = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0), epoch: 0, attempts: 0 });
  const plan = planOfflinePrinted(queued, "dev-a", "offline O-3", T0 + 1_000);
  assert.ok(plan.ok, "an untried queued job moves");
  if (!plan.ok) return;
  assert.deepEqual([plan.patch.status, plan.patch.set.printedBy, plan.patch.set.printedAt?.getTime()], ["printed", "dev-a", T0 + 1_000], "printed by the device that printed it offline");
  assert.deepEqual([plan.patch.log.event, plan.patch.log.deviceId, plan.patch.log.detail], ["printed", "dev-a", "offline O-3"], "its history says so");
  assert.deepEqual(plan.patch.unset, ["lease", "lastError"], "nothing of an attempt is left");
  const tried = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0), epoch: 1, attempts: 1 });
  assert.equal(planOfflinePrinted(tried, "dev-a", "x", T0).ok, false, "a job with an attempt may already be on paper: it stays");
  for (const status of ["leased", "printed", "failed", "needs-confirm", "dismissed"] as const) {
    const row = lifecycleOf({ kind: "kot", status, createdAt: new Date(T0), epoch: 0, attempts: 0 });
    assert.equal(planOfflinePrinted(row, "dev-a", "x", T0).ok, false, `a ${status} job stays`);
  }
});
