import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_JOB_DISMISS_REASONS } from "@pos/shared/print-job";

import { printJobSchema, PrintJob } from "../models/PrintJob";
import { printHostSchema, PrintHost } from "../models/PrintHost";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// Print-host plan (.claude/plan/v2/print-host-plan.md §C PH-2) — DB-free
// schema/index shape tests for the new PrintJob queue row and the PrintHost
// singleton. No DB connection: every assertion reads the compiled schema's
// declared indexes/paths/enums, or validates a plain (unsaved) document
// instance, mirroring lib/order-request-model.test.ts.

test("PrintJob: schema.indexes() carries {status:1, createdAt:1, _id:1} in EXACTLY that key order", () => {
  const indexes = printJobSchema.indexes();
  const match = indexes.find(
    ([key]: [Record<string, unknown>, unknown]) =>
      key.status === 1 && key.createdAt === 1 && key._id === 1,
  );
  assert.ok(match, "expected a {status:1, createdAt:1, _id:1} index");
  // Key ORDER is the contract (MERGED-16): D1/D2 filter on the status
  // equality PREFIX then range on createdAt — a reordered spec compiles, the
  // membership check passes, and the planner loses the prefix on M0. Mongoose
  // passes schema.index() specs through verbatim, so insertion order here IS
  // the server-side key order.
  const [key] = match as [Record<string, unknown>, unknown];
  assert.deepEqual(Object.keys(key), ["status", "createdAt", "_id"]);
});

test("PrintJob: schema.indexes() carries a unique+sparse index on jobKey alone", () => {
  const indexes = printJobSchema.indexes();
  const match = indexes.find(([key]) => key.jobKey === 1);
  assert.ok(match, "expected a jobKey:1 index");
  const [key, options] = match as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual(Object.keys(key), ["jobKey"], "the dedupe fence is single-key");
  assert.equal(options.unique, true);
  assert.equal(options.sparse, true);
});

// `createdAt` (timestamps) silently drives the ENTIRE queue — the D1/D2/D3
// feed filters, the 30-min staleness predicate, and both prune sweeps. Losing
// `{timestamps:true}` breaks none of the other assertions in this file and no
// type (IPrintJob.createdAt is hand-declared), so it gets its own pin.
test("PrintJob + PrintHost: {timestamps:true} is set on both schemas", () => {
  assert.equal(printJobSchema.get("timestamps"), true);
  assert.equal(printHostSchema.get("timestamps"), true);
});

test("PrintJob: kind enum rejects an unknown value", () => {
  const doc = new PrintJob({
    kind: "not-a-real-kind",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown kind");
  assert.ok(err?.errors.kind, "expected the error to be on the kind path");
});

test("PrintJob: kind enum accepts \"cancel-notice\" (MERGED-04, the 6th kind)", () => {
  const doc = new PrintJob({
    kind: "cancel-notice",
    payload: "{}",
    label: "Cancel notice · T-4",
    queuedBy: "Staff",
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal cancel-notice doc must validate cleanly");
});

test("PrintJob: status enum rejects an unknown value", () => {
  const doc = new PrintJob({
    kind: "kot",
    status: "not-a-real-status",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown status");
  assert.ok(err?.errors.status, "expected the error to be on the status path");
});

test("PrintJob: a minimal doc defaults status to \"queued\" (the one real default)", () => {
  const doc = new PrintJob({
    kind: "kot",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
  });
  assert.equal(doc.status, "queued");
});

test("PrintJob: dismissReason enum rejects an unknown value", () => {
  const doc = new PrintJob({
    kind: "kot",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
    dismissReason: "not-a-real-reason",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown dismissReason");
  assert.ok(err?.errors.dismissReason, "expected the error to be on the dismissReason path");
});

test("PrintJob: dismissReason enum accepts \"host-cleared\" (MERGED-17)", () => {
  assert.ok(
    PRINT_JOB_DISMISS_REASONS.includes("host-cleared"),
    "positive landmark: host-cleared must be one of the declared dismiss reasons",
  );
  const doc = new PrintJob({
    kind: "kot",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
    dismissReason: "host-cleared",
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a doc with dismissReason \"host-cleared\" must validate cleanly");
});

test("PrintJob: optional fields are absent on a minimal valid doc (omit-empty) — no default: anywhere", () => {
  const doc = new PrintJob({
    kind: "kot",
    payload: "{}",
    label: "KOT round 1 · T-4",
    queuedBy: "Staff",
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal doc must validate cleanly");
  assert.equal(doc.claimedAt, undefined);
  assert.equal(doc.claimedBy, undefined);
  assert.equal(doc.jobKey, undefined);
  assert.equal(doc.orderId, undefined);
  assert.equal(doc.dismissedAt, undefined);
  assert.equal(doc.dismissReason, undefined);
  assert.equal(doc.dismissedBy, undefined);
});

test("PrintJob: a doc missing kind/payload/label/queuedBy fails validation on exactly those paths", () => {
  const doc = new PrintJob({});
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error");
  assert.ok(err?.errors.kind, "expected the error to cover kind");
  assert.ok(err?.errors.payload, "expected the error to cover payload");
  assert.ok(err?.errors.label, "expected the error to cover label");
  assert.ok(err?.errors.queuedBy, "expected the error to cover queuedBy");
  assert.equal(Object.keys(err?.errors ?? {}).length, 4, "expected exactly 4 failing paths");
});

// This model is never walked by the registry's module-load TTL sweep (it is
// deliberately not federated — see the model file's header comment), so this
// test pins the guard directly instead of relying on that sweep to catch a
// future TTL mistake here. Passes BECAUSE there is no TTL index declared
// (apps/cafe/lib/ttl-guard.ts:40-44's default-deny only fires on a declared
// TTL — no declaration means nothing to check).
test("assertSchemaTtlAllowed(PrintJob) does not throw — there is no TTL index", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PrintJob", printJobSchema));
});

test("PrintJob: no index anywhere carries expireAfterSeconds (vision-guarded by the positive index asserts above)", () => {
  const indexes = printJobSchema.indexes();
  // Positive landmark first: the two real indexes must still be there, so a
  // stripped/blinded indexes() array can't make the negative loop vacuous.
  const hasFeedIndex = indexes.some(
    ([key]: [Record<string, unknown>, unknown]) =>
      key.status === 1 && key.createdAt === 1 && key._id === 1,
  );
  const hasJobKeyIndex = indexes.some(([key]) => key.jobKey === 1);
  assert.ok(hasFeedIndex, "positive landmark: the feed index must be present");
  assert.ok(hasJobKeyIndex, "positive landmark: the jobKey index must be present");
  for (const [, options] of indexes) {
    assert.equal((options as Record<string, unknown>).expireAfterSeconds, undefined);
  }
});

// ── PrintHost — the singleton designated-device row ────────────────────────

test("PrintHost: key path is required and unique", () => {
  const path = printHostSchema.path("key");
  assert.ok(path, "key path must exist");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.equal(options.unique, true);
  assert.equal(options.required, true);
});

test("PrintHost: a minimal valid doc validates cleanly with silentMode/silentProbeMs undefined (omit-empty)", () => {
  const doc = new PrintHost({
    key: "primary",
    deviceId: "device-1",
    label: "Counter PC",
    setBy: "Staff",
    setAt: new Date(),
    lastSeenAt: new Date(),
  });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal doc must validate cleanly");
  assert.equal(doc.silentMode, undefined);
  assert.equal(doc.silentProbeMs, undefined);
});

test("PrintHost: a doc missing deviceId/label/setBy fails validation on those exact paths", () => {
  const doc = new PrintHost({
    key: "primary",
    setAt: new Date(),
    lastSeenAt: new Date(),
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error");
  assert.ok(err?.errors.deviceId, "expected the error to cover deviceId");
  assert.ok(err?.errors.label, "expected the error to cover label");
  assert.ok(err?.errors.setBy, "expected the error to cover setBy");
});

test("assertSchemaTtlAllowed(PrintHost) does not throw — there is no TTL index", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PrintHost", printHostSchema));
});
