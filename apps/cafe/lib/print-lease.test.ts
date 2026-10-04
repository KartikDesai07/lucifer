import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobsForMeFilter, printJobUpdateOf, printerLineFilter } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.

const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };

function patchOf(plan: PrintJobPlan): PrintJobPatch {
  if (!plan.ok) throw new assert.AssertionError({ message: `expected a plan, got "${plan.reason}"` });
  return plan.patch;
}

// Session 2C deliberately added printerId: { $exists: false }: a printers-mode job is aimed at its printer's
// writer too (targetDeviceId), but it waits on its printer's line, never on the device's simple line.
test("printJobLineFilter: this device's leased job, plus its queued jobs that are fresh or approved (simple mode only)", () => {
  assert.deepEqual(printJobLineFilter("dev-a", T0), {
    targetDeviceId: "dev-a",
    printerId: { $exists: false },
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

// Session 2C (spec §7.6, plan decision 1): in printers mode each printer is a line of its own, oldest first.
test("printerLineFilter: one printer's leased job, plus its queued jobs that are fresh or approved", () => {
  assert.deepEqual(printerLineFilter("p1", T0), {
    printerId: "p1",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

// Session 2B (found on the emulator at the 2A gate): the pulse and the wake counted this device's own running
// lease, so one landing mid-print kicked the agent into an empty lease after its ack.
test("printJobsForMeFilter: the line, less a lease still running; a lease that ran out still counts (its lease call expires it)", () => {
  assert.deepEqual(printJobsForMeFilter("dev-a", T0), {
    ...printJobLineFilter("dev-a", T0),
    $nor: [{ status: "leased", "lease.expiresAt": { $gte: new Date(T0) } }],
  });
});

test("printJobCasFilter: fences on the status and epoch the plan read; epoch 0 also matches a row with no epoch", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(printJobCasFilter(id, { status: "queued", epoch: 0 }), { _id: id, status: "queued", epoch: { $in: [0, null] } });
  assert.deepEqual(printJobCasFilter(id, { status: "leased", epoch: 3 }), { _id: id, status: "leased", epoch: 3 });
});

test("printJobUpdateOf: $set as planned, $unset only when asked, and the log capped at the newest entries", () => {
  const queued = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0) });
  const lease = patchOf(planLease(queued, WHO, T0));
  const update = printJobUpdateOf(lease);
  assert.deepEqual(update.$set, lease.set);
  assert.equal("$unset" in update, false, "nothing to unset: no $unset key at all");
  assert.deepEqual(update.$push, { log: { $each: [lease.log], $slice: -PRINT_JOB_LOG_MAX } });
  const leased = lifecycleOf({
    kind: "kot",
    status: "leased",
    createdAt: new Date(T0),
    epoch: 1,
    attempts: 1,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
  });
  const expired = patchOf(planExpiry(leased, T0 + PRINT_LEASE_MS + 1));
  assert.deepEqual(printJobUpdateOf(expired).$unset, { lease: 1 });
});

test("leasedPrintJobOf: the wire job carries the new epoch, the attempt number, the labels and the parsed payload", () => {
  const id = new mongoose.Types.ObjectId();
  const queued = lifecycleOf({ kind: "eod", status: "queued", createdAt: new Date(T0), epoch: 2, attempts: 2 });
  const lease = patchOf(planLease(queued, WHO, T0));
  const payload: PrintJobPayload = { kind: "eod", dateKey: "2026-10-02", dateLabel: "2 Oct 2026" };
  const head = { _id: id, kind: "eod" as const, label: "End of day · 2 Oct", createdAt: new Date(T0) };
  assert.deepEqual(leasedPrintJobOf(head, lease, payload, ["REPRINT"]), {
    id: String(id),
    epoch: 3,
    kind: "eod",
    label: "End of day · 2 Oct",
    createdAt: new Date(T0).toISOString(),
    payload,
    labels: ["REPRINT"],
    copyIndex: 0,
    attempt: 3,
  });
});
