import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import { Task, taskSchema, taskPayloadSchema, taskOpenKey, TASK_TYPES } from "./Task";

// DB-free schema guards for the F3.7 trigger queue.

test("Task: tenantId/tenantSlug/type/reason required; status defaults to open", () => {
  const err = new Task({}).validateSync();
  assert.ok(err?.errors.tenantId, "tenantId required");
  assert.ok(err?.errors.tenantSlug, "tenantSlug required");
  assert.ok(err?.errors.type, "type required");
  assert.ok(err?.errors.reason, "reason required");

  const t = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "verify-cafe",
    type: "ADD_DB_CLUSTER",
    reason: "ledger at 76%",
  });
  assert.equal(t.status, "open");
  assert.equal(t.validateSync(), undefined, "a minimal task validates");
});

test("Task: type + status + payload.via enums reject unknown values", () => {
  const bad = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "x",
    type: "REBOOT_UNIVERSE",
    status: "paused",
    reason: "r",
    payload: { via: "carrier-pigeon" },
  }).validateSync();
  assert.ok(bad?.errors.type, "type enum enforced");
  assert.ok(bad?.errors.status, "status enum enforced");
  assert.ok(bad?.errors["payload.via"], "payload.via enum enforced");
  assert.deepEqual(TASK_TYPES, ["ADD_DB_CLUSTER", "ADD_CLOUD", "FAILOVER"]);
});

test("Task: openKey dedupe index is PARTIAL unique over $exists (the domain_primary_unique precedent, never sparse)", () => {
  const hit = taskSchema.indexes().find(([k]) => k.openKey === 1);
  assert.ok(hit, "{openKey:1} index present");
  const [, opts] = hit!;
  assert.equal(opts.unique, true, "unique");
  assert.equal(opts.sparse, undefined, "NOT sparse");
  assert.deepEqual(opts.partialFilterExpression, { openKey: { $exists: true } });
  assert.equal(opts.name, "task_open_unique");
});

test("Task: panel-queue + reopen-snooze indexes present", () => {
  const ix = taskSchema.indexes();
  assert.ok(ix.find(([k]) => k.status === 1 && k.createdAt === -1), "{status, createdAt}");
  assert.ok(
    ix.find(([k]) => k.tenantId === 1 && k.type === 1 && k.updatedAt === -1),
    "{tenantId, type, updatedAt}",
  );
});

test("taskOpenKey: `${tenantId}|${type}` — stable for the upsert filter", () => {
  const id = new Types.ObjectId();
  assert.equal(taskOpenKey(id, "FAILOVER"), `${id.toHexString()}|FAILOVER`);
  assert.equal(taskOpenKey(String(id), "FAILOVER"), taskOpenKey(id, "FAILOVER"));
});

test("Task: payload is an _id-free subdoc; timestamps on (createdAt/updatedAt)", () => {
  const t = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "verify-cafe",
    type: "FAILOVER",
    reason: "worker swapped",
    payload: { via: "swap" },
  });
  assert.equal(t.validateSync(), undefined);
  assert.equal(taskPayloadSchema.path("_id"), undefined, "payload subdoc carries no _id");
  assert.equal(taskSchema.get("timestamps"), true);
});

// ── F3.8 hot-add run block (additive, omit-empty) ────────────────────────────

test("Task.run: accepts a full target subdoc + approvedBy ObjectId, validates clean", () => {
  const approvedBy = new Types.ObjectId();
  const t = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "verify-cafe",
    type: "ADD_DB_CLUSTER",
    reason: "ledger pos-orders-a at 76%",
    run: {
      step: "cluster",
      leaseToken: "lease-1",
      leaseUntil: new Date(),
      approvedBy,
      approvedAt: new Date(),
      target: {
        mode: "mint",
        tag: "A2",
        clusterId: "pos-orders-a2",
        projectName: "pos-acme-orders-a2",
        oldActiveId: "pos-orders-a",
      },
    },
  });
  assert.equal(t.validateSync(), undefined, "a full run block validates");
  assert.equal(t.run?.approvedBy?.toString(), approvedBy.toString());
  assert.equal(t.run?.target?.mode, "mint");
  assert.equal(t.run?.target?.clusterId, "pos-orders-a2");
});

test("Task.run.target.mode enum rejects unknown values", () => {
  const bad = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "x",
    type: "ADD_DB_CLUSTER",
    reason: "r",
    run: { target: { mode: "duplicate", tag: "A2", clusterId: "pos-orders-a2", oldActiveId: "core" } },
  }).validateSync();
  assert.ok(bad?.errors["run.target.mode"], "run.target.mode enum enforced");
});

test("Task.run is omit-empty: absent on a doc created without it", () => {
  const t = new Task({
    tenantId: new Types.ObjectId(),
    tenantSlug: "verify-cafe",
    type: "ADD_DB_CLUSTER",
    reason: "ledger pos-orders-a at 76%",
  });
  assert.equal(t.validateSync(), undefined);
  const obj = t.toObject({ minimize: true });
  assert.equal(obj.run, undefined, "run block omitted when never set on the doc");
});
