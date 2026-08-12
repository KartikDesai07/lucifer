import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog, auditLogSchema } from "./AuditLog";

// DB-free schema guards for the append-only Hub audit (phase-F3 §3.1/§3.4).

test("AuditLog: actorId, action, ip are required", () => {
  const err = new AuditLog({}).validateSync();
  assert.ok(err, "expected a ValidationError");
  assert.ok(err.errors.actorId, "actorId required");
  assert.ok(err.errors.action, "action required");
  assert.ok(err.errors.ip, "ip required");
});

test("AuditLog: `ts` IS the created-at; no createdAt/updatedAt path", () => {
  assert.equal(auditLogSchema.path("ts")?.instance, "Date", "ts is a Date path");
  assert.equal(auditLogSchema.path("createdAt"), undefined, "createdAt aliased to ts");
  assert.equal(auditLogSchema.path("updatedAt"), undefined, "append-only: no updatedAt");
});

test("AuditLog: refs are ObjectId (actorId/targetTenantId/secretId)", () => {
  assert.equal(auditLogSchema.path("actorId").instance, "ObjectId");
  assert.equal(auditLogSchema.path("targetTenantId").instance, "ObjectId");
  assert.equal(auditLogSchema.path("secretId").instance, "ObjectId");
});

test("AuditLog: indexes are {ts:-1} and {targetTenantId:1, ts:-1}", () => {
  const indexes = auditLogSchema.indexes();
  const tsOnly = indexes.find(([k]) => k.ts === -1 && Object.keys(k).length === 1);
  assert.ok(tsOnly, "{ts:-1} index");
  const perTenant = indexes.find(([k]) => k.targetTenantId === 1 && k.ts === -1);
  assert.ok(perTenant, "{targetTenantId:1, ts:-1} index");
});

test("AuditLog: the audit is TTL-FREE (no index carries expireAfterSeconds)", () => {
  for (const [, opts] of auditLogSchema.indexes()) {
    assert.equal(
      (opts as { expireAfterSeconds?: number })?.expireAfterSeconds,
      undefined,
      "audit must be retained — no TTL (§3.1)",
    );
  }
});
