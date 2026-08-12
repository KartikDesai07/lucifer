import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HEARTBEATS_COLLECTION,
  HEARTBEAT_TTL_INDEX,
  HEARTBEAT_TTL_SECONDS,
} from "@pos/shared/heartbeat";
import { assertTtlIndexesAllowed } from "@pos/shared/ttl-guard";

import { Heartbeat, heartbeatSchema, heartbeatClusterSchema } from "./Heartbeat";
import { AuditLog } from "./AuditLog";
import { Chain } from "./Chain";
import { HubUser } from "./HubUser";
import { Secret } from "./Secret";
import { Task } from "./Task";
import { Tenant } from "./Tenant";

// DB-free schema guards for the F3.7 gauge-sample store — THE ONLY REGISTRY TTL.

test("Heartbeat: collection name is pinned to the shared contract", () => {
  assert.equal(heartbeatSchema.get("collection"), HEARTBEATS_COLLECTION);
});

test("Heartbeat: the TTL index is EXACTLY the shared 7-day spec on ts", () => {
  const ttl = heartbeatSchema
    .indexes()
    .filter(([, opts]) => opts?.expireAfterSeconds !== undefined);
  assert.equal(ttl.length, 1, "exactly one TTL index");
  const [key, opts] = ttl[0];
  assert.deepEqual(key, HEARTBEAT_TTL_INDEX.key);
  assert.equal(opts.expireAfterSeconds, HEARTBEAT_TTL_SECONDS);
});

test("Heartbeat: ts is the Hub-stamped created-at (no updatedAt — samples never mutate)", () => {
  const stamps = heartbeatSchema.get("timestamps") as { createdAt?: string; updatedAt?: boolean };
  assert.equal(stamps.createdAt, "ts");
  assert.equal(stamps.updatedAt, false);
});

test("Heartbeat: {tenant:1, ts:-1} serves the FAILOVER prior-misses read + health view", () => {
  const hit = heartbeatSchema.indexes().find(([k]) => k.tenant === 1 && k.ts === -1);
  assert.ok(hit, "{tenant:1, ts:-1} index present");
});

test("Heartbeat: tenant + hostOk required; cluster rows are _id-free subdocs", () => {
  const err = new Heartbeat({}).validateSync();
  assert.ok(err?.errors.tenant, "tenant required");
  assert.ok(err?.errors.hostOk, "hostOk required");

  const hb = new Heartbeat({
    tenant: "verify-cafe",
    hostOk: true,
    clusters: [{ name: "pos-orders-a", role: "ledger", active: true, state: "ok", usedPct: 0.5 }],
  });
  assert.equal(hb.validateSync(), undefined, "a minimal sample validates");
  assert.equal(heartbeatClusterSchema.path("_id"), undefined, "cluster subdoc carries no _id");
});

test("Heartbeat: a cluster-less down-ping stays omit-empty (no [] materialized)", () => {
  const hb = new Heartbeat({ tenant: "verify-cafe", hostOk: false });
  assert.equal(hb.validateSync(), undefined);
  const obj = hb.toObject({ minimize: true }) as unknown as Record<string, unknown>;
  assert.ok(!("clusters" in obj) || obj.clusters === undefined, "clusters absent when unset");
});

test("Heartbeat: servedOrigin/stats enums reject unknown values", () => {
  const bad = new Heartbeat({
    tenant: "x",
    hostOk: true,
    servedOrigin: "both",
    stats: "maybe",
  }).validateSync();
  assert.ok(bad?.errors.servedOrigin, "servedOrigin enum enforced");
  assert.ok(bad?.errors.stats, "stats enum enforced");
});

// Build-rule #23, materialized Hub-side (the ttl-guard header assigns F3.7 the
// consult): walk EVERY hub model with the shared guard — heartbeats is the one
// allowlisted TTL; a TTL sneaking onto any other registry collection (the
// TTL-free AuditLog, the vault, Tenant, Task…) fails this test AND (for
// Heartbeat itself) module load.
test("ttl-guard: every hub collection passes the shared allowlist (heartbeats is the ONLY TTL)", () => {
  const models = [Tenant, AuditLog, HubUser, Chain, Secret, Heartbeat, Task];
  let ttlCount = 0;
  for (const model of models) {
    const declared = model.schema
      .indexes()
      .map(([key, options]) => ({ key, options })) as Parameters<typeof assertTtlIndexesAllowed>[1];
    assertTtlIndexesAllowed(model.collection.collectionName, declared);
    ttlCount += declared.filter((ix) => ix.options?.expireAfterSeconds !== undefined).length;
  }
  assert.equal(ttlCount, 1, "exactly ONE TTL index across the entire registry");
});
