import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINT_JOB_DISMISS_REASONS, PRINT_JOB_KINDS, PRINT_JOB_STATUSES } from "@pos/shared/print-job";

import { printJobSchema, PrintJob } from "../models/PrintJob";
import { printHostSchema, PrintHost } from "../models/PrintHost";
import { printDeviceSchema, PrintDevice } from "../models/PrintDevice";
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

test("PrintJob: kind enum accepts \"token\" (print customization S7) and still rejects an unknown kind beside it; the model enum is the shared PRINT_JOB_KINDS", () => {
  const doc = new PrintJob({
    kind: "token",
    payload: "{}",
    label: "Token 7 · T-4",
    queuedBy: "Staff",
  });
  assert.equal(doc.validateSync(), undefined, "a minimal token doc must validate cleanly (no model edit was needed: the enum IS PRINT_JOB_KINDS)");
  assert.ok(PRINT_JOB_KINDS.includes("token"), "landmark: the shared list carries token");
  // Landmark for the absence side: the same builder with a bogus kind fails, so the accept above is not a validator that never runs.
  assert.ok(new PrintJob({ kind: "tokens", payload: "{}", label: "x", queuedBy: "Staff" }).validateSync()?.errors.kind);
  const kindEnum = (printJobSchema.path("kind") as unknown as { enumValues: string[] }).enumValues;
  assert.deepEqual([...kindEnum].sort(), [...PRINT_JOB_KINDS].sort());
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
  // Omit-empty is load-bearing for printerState too: a default would resurrect it after the designation $unset.
  assert.equal(doc.printerState, undefined);
});

test("PrintHost: printerState enum accepts connected/disconnected and rejects any other value", () => {
  const base = { key: "primary", deviceId: "d", label: "L", setBy: "S", setAt: new Date(), lastSeenAt: new Date() };
  for (const ok of ["connected", "disconnected"]) {
    assert.equal(new PrintHost({ ...base, printerState: ok }).validateSync(), undefined, `${ok} must validate`);
  }
  const err = new PrintHost({ ...base, printerState: "maybe" }).validateSync();
  assert.ok(err?.errors.printerState, "an unknown printerState must fail validation on the printerState path");
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

// ── Phase 1 lifecycle (plan 2026-10-02-phase-1-lifecycle.md, Task 3) ─────────

const MIN_JOB = { kind: "kot", payload: "{}", label: "KOT round 1 · T-4", queuedBy: "Staff" } as const;
const LIFECYCLE_PATHS = [
  "targetDeviceId", "originDeviceId", "copyIndex", "epoch", "lease", "attempts", "uncertainAttempts",
  "nextAttemptAt", "labels", "approvedAt", "printedAt", "printedBy", "lastError", "log",
] as const;

test("PrintJob: Phase 1 indexes — one device's line; no index nothing reads", () => {
  const keys = printJobSchema.indexes().map(([fields]) => JSON.stringify(fields));
  assert.ok(keys.includes(JSON.stringify({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 })), "the line index, in exactly that key order");
  // The Phase 1 final gate (m-1, deliberate change): the readback index served myRecentJobs, which the 1C gate
  // dropped; no query reads it, and on M0 it cost a write per insert and storage. Never deployed, so never built.
  assert.ok(!keys.some((k) => k.includes('"originDeviceId"')), "no originDeviceId index");
  // Phase 2 Session 2A (deliberate change): a fourth index, one printer's line (the next test).
  assert.equal(keys.length, 4, "exactly four PrintJob indexes: the feed/prune one, the job-key fence, the device line and the printer line");
  assert.ok(keys.includes(JSON.stringify({ status: 1, createdAt: 1, _id: 1 })), "landmark: the prune/feed index stays");
});

// ── Phase 2 (plan 2026-10-03-phase-2-routing.md, Task A2) ──────────────────

test("PrintJob: Phase 2's printer line index, in exactly that key order, partial on printerId", () => {
  const match = printJobSchema.indexes().find(([fields]) => fields.printerId === 1);
  assert.ok(match, "expected a printer line index");
  const [fields, options] = match as [Record<string, unknown>, Record<string, unknown>];
  assert.deepEqual(Object.keys(fields), ["printerId", "status", "createdAt", "_id"], "the head-of-line read: equality on printerId and status, then oldest first");
  // Partial: a simple-mode row (no printerId) never enters it, so it costs simple mode nothing on M0.
  assert.deepEqual(options.partialFilterExpression, { printerId: { $exists: true } });
  assert.equal(options.unique, undefined, "not unique: a printer's line holds many jobs");
});

test("PrintJob: printerId and copies stay absent on a simple-mode row; copies is 1–3", () => {
  const doc = new PrintJob({ ...MIN_JOB });
  assert.equal(doc.get("printerId"), undefined, "omit-empty: simple mode never writes it");
  assert.equal(doc.get("copies"), undefined, "omit-empty: absent means one copy");
  assert.equal(new PrintJob({ ...MIN_JOB, printerId: "64f000000000000000000001", copies: 3 }).validateSync(), undefined);
  assert.ok(new PrintJob({ ...MIN_JOB, copies: 0 }).validateSync()?.errors.copies, "no zero copies");
  assert.ok(new PrintJob({ ...MIN_JOB, copies: 4 }).validateSync()?.errors.copies, "at most three");
});

test("PrintJob: every Phase 1 lifecycle field is absent on a minimal doc (omit-empty, the arrays included)", () => {
  const doc = new PrintJob({ ...MIN_JOB });
  assert.equal(doc.validateSync(), undefined);
  for (const p of LIFECYCLE_PATHS) assert.equal(doc.get(p), undefined, `${p} must not default (a pre-Phase-1 row has none of them)`);
});

test("PrintJob: status accepts every Phase 1 state; labels, log events and the lease are validated", () => {
  for (const status of PRINT_JOB_STATUSES) {
    assert.equal(new PrintJob({ ...MIN_JOB, status }).validateSync(), undefined, status);
  }
  const badLabel = new PrintJob({ ...MIN_JOB, labels: ["REPRNT"] }).validateSync();
  assert.ok(Object.keys(badLabel?.errors ?? {}).some((k) => k.startsWith("labels")), "an unknown label is refused");
  const badEvent = new PrintJob({ ...MIN_JOB, log: [{ at: new Date(), event: "teleported" }] }).validateSync();
  assert.ok(Object.keys(badEvent?.errors ?? {}).some((k) => k.startsWith("log")), "an unknown log event is refused");
  const noExpiry = new PrintJob({ ...MIN_JOB, lease: { deviceId: "d", tabId: "t", epoch: 1 } }).validateSync();
  assert.ok(noExpiry?.errors["lease.expiresAt"], "a lease always carries its expiry");
  const full = new PrintJob({
    ...MIN_JOB,
    status: "leased",
    targetDeviceId: "dev-a",
    epoch: 1,
    attempts: 1,
    uncertainAttempts: 0,
    nextAttemptAt: new Date(),
    labels: ["REPRINT"],
    lease: { deviceId: "dev-a", tabId: "t", epoch: 1, expiresAt: new Date() },
    log: [{ at: new Date(), event: "leased", deviceId: "dev-a" }],
  });
  assert.equal(full.validateSync(), undefined, "a real leased row validates");
});

const BEAT_ROW = {
  deviceId: "dev-1",
  label: "Counter PC",
  shell: "windows",
  capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: true, webSerial: false, webBluetooth: false },
  lastSeenAt: new Date(),
} as const;

test("PrintDevice: a heartbeat row validates; appVersion and nativeProtocol stay absent unless sent", () => {
  const doc = new PrintDevice({ ...BEAT_ROW });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.get("appVersion"), undefined);
  assert.equal(doc.get("nativeProtocol"), undefined);
});

test("PrintDevice: deviceId is required and unique; shell is an enum; capabilities and lastSeenAt are required", () => {
  assert.equal(printDeviceSchema.path("deviceId").options.unique, true);
  const err = new PrintDevice({}).validateSync();
  for (const p of ["deviceId", "label", "shell", "capabilities", "lastSeenAt"]) assert.ok(err?.errors[p], `${p} is required`);
  assert.ok(new PrintDevice({ ...BEAT_ROW, shell: "ios" }).validateSync()?.errors.shell, "an unknown shell is refused");
});

test("assertSchemaTtlAllowed(PrintDevice) does not throw — there is no TTL index", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PrintDevice", printDeviceSchema));
  assert.ok(printDeviceSchema.indexes().every(([, options]) => options?.expireAfterSeconds === undefined));
});
