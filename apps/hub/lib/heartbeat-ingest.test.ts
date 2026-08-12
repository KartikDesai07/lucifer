import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import type { HeartbeatIngest } from "@pos/shared/heartbeat";

import {
  ingestHeartbeat,
  type EnqueueOutcome,
  type HeartbeatIngestPorts,
  type TenantView,
} from "./heartbeat-ingest";
import type { PriorPing } from "./heartbeat-triggers";
import { FAILOVER_CONSECUTIVE_MISSES, TASK_REOPEN_SNOOZE_MS } from "./constants";

const NOW = new Date("2026-07-14T12:00:00.000Z");
const TENANT_ID = new Types.ObjectId();

function body(overrides: Partial<HeartbeatIngest> = {}): HeartbeatIngest {
  return { tenant: "verify-cafe", hostOk: true, at: NOW.toISOString(), ...overrides };
}

const HOT = body({
  clusters: [{ name: "pos-orders-a", role: "ledger", active: true, state: "ok", usedPct: 0.8 }],
});

interface FakeOptions {
  tenant?: TenantView | null;
  priors?: PriorPing[];
  openOutcome?: "enqueued" | "already-open";
  recentlyClosed?: boolean;
}

function fakePorts(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const record = {
    inserted: [] as Array<HeartbeatIngest & { triggered?: string[] }>,
    mirrors: [] as Array<{ tenantId: unknown; set: Record<string, unknown>; arrayFilters: Record<string, unknown>[] }>,
    opened: [] as Array<{ type: string; reason: string }>,
    priorLimit: 0,
    snoozeSince: null as Date | null,
  };
  const ports: HeartbeatIngestPorts = {
    async findTenant(slug) {
      calls.push(`findTenant:${slug}`);
      return opts.tenant === undefined
        ? { _id: TENANT_ID, status: "active" }
        : opts.tenant;
    },
    async priorPings(_slug, limit) {
      calls.push("priorPings");
      record.priorLimit = limit;
      return opts.priors ?? [];
    },
    async insertHeartbeat(doc) {
      calls.push("insert");
      record.inserted.push(doc);
    },
    async applyMirror(tenantId, set, arrayFilters) {
      calls.push("mirror");
      record.mirrors.push({ tenantId, set, arrayFilters });
    },
    async recentlyClosedTask(_tenantId, _type, since) {
      calls.push("snoozeCheck");
      record.snoozeSince = since;
      return opts.recentlyClosed ?? false;
    },
    async openTask(_tenantId, _slug, d) {
      calls.push(`openTask:${d.type}`);
      record.opened.push({ type: d.type, reason: d.reason });
      return opts.openOutcome ?? "enqueued";
    },
  };
  return { ports, calls, record };
}

test("ingest: unknown tenant → nothing stored, nothing mirrored, nothing enqueued", async () => {
  const { ports, calls } = fakePorts({ tenant: null });
  const res = await ingestHeartbeat(body(), ports, NOW);
  assert.deepEqual(res, { status: "unknown-tenant" });
  assert.deepEqual(calls, ["findTenant:verify-cafe"]);
});

test("ingest: a tripping heartbeat stores the sample (with triggered), mirrors, then enqueues", async () => {
  const { ports, calls, record } = fakePorts();
  const res = await ingestHeartbeat(HOT, ports, NOW);
  assert.deepEqual(res, {
    status: "stored",
    triggers: [{ type: "ADD_DB_CLUSTER", outcome: "enqueued" as EnqueueOutcome }],
  });
  // Order matters: the sample is stored BEFORE any task write (a task failure
  // must not lose the gauge history the failover counter reads).
  assert.deepEqual(calls, [
    "findTenant:verify-cafe",
    "priorPings",
    "insert",
    "mirror",
    "snoozeCheck",
    "openTask:ADD_DB_CLUSTER",
  ]);
  assert.deepEqual(record.inserted[0].triggered, ["ADD_DB_CLUSTER"]);
  assert.equal(record.priorLimit, FAILOVER_CONSECUTIVE_MISSES - 1);
  assert.equal(record.mirrors[0].tenantId, TENANT_ID);
  assert.equal(record.mirrors[0].set["dbPool.$[c0].usedPct"], 0.8);
  assert.equal(record.snoozeSince!.getTime(), NOW.getTime() - TASK_REOPEN_SNOOZE_MS);
});

test("ingest: a quiet heartbeat stores WITHOUT triggered and skips the task path entirely", async () => {
  const { ports, calls, record } = fakePorts();
  const res = await ingestHeartbeat(body(), ports, NOW);
  assert.deepEqual(res, { status: "stored", triggers: [] });
  assert.ok(!calls.includes("snoozeCheck") && !calls.some((c) => c.startsWith("openTask")));
  assert.equal(record.inserted[0].triggered, undefined, "no empty triggered array stored");
});

test("ingest: an already-open task dedupes; a recently-closed one snoozes (openTask never called)", async () => {
  const dup = fakePorts({ openOutcome: "already-open" });
  const r1 = await ingestHeartbeat(HOT, dup.ports, NOW);
  assert.deepEqual(r1.status === "stored" && r1.triggers[0].outcome, "already-open");

  const snoozed = fakePorts({ recentlyClosed: true });
  const r2 = await ingestHeartbeat(HOT, snoozed.ports, NOW);
  assert.deepEqual(r2.status === "stored" && r2.triggers[0].outcome, "snoozed");
  assert.ok(!snoozed.calls.some((c) => c.startsWith("openTask")), "openTask skipped when snoozed");
});

test("ingest: a non-active tenant still stores + mirrors (gauges are truth) but never enqueues", async () => {
  const { ports, calls, record } = fakePorts({ tenant: { _id: TENANT_ID, status: "suspended" } });
  const res = await ingestHeartbeat(HOT, ports, NOW);
  assert.deepEqual(res, { status: "stored", triggers: [] });
  assert.ok(calls.includes("insert") && calls.includes("mirror"));
  assert.ok(!calls.some((c) => c.startsWith("openTask")));
  assert.equal(record.inserted[0].triggered, undefined);
});

test("ingest: the failover streak counts across stored priors (3rd consecutive miss enqueues)", async () => {
  const priors: PriorPing[] = [
    { hostOk: false, ts: new Date(NOW.getTime() - 15 * 60_000) },
    { hostOk: false, ts: new Date(NOW.getTime() - 30 * 60_000) },
  ];
  const { ports, record } = fakePorts({ priors });
  const res = await ingestHeartbeat(body({ hostOk: false }), ports, NOW);
  assert.deepEqual(res.status === "stored" && res.triggers, [
    { type: "FAILOVER", outcome: "enqueued" },
  ]);
  assert.match(record.opened[0].reason, /consecutive failed host pings/);
});
