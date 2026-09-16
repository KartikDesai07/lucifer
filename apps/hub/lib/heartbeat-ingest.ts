import type { Types } from "mongoose";

import type { HeartbeatIngest } from "@pos/shared/heartbeat";
import { Heartbeat } from "@/models/Heartbeat";
import { Task, taskOpenKey, type TaskType } from "@/models/Task";
import { Tenant } from "@/models/Tenant";
import {
  buildMirrorUpdate,
  evaluateTriggers,
  type PriorPing,
  type TriggerDecision,
} from "@/lib/heartbeat-triggers";
import {
  FAILOVER_CONSECUTIVE_MISSES,
  TASK_REOPEN_SNOOZE_MS,
} from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// F3.7 — the ingest orchestrator, behind IO ports (the provisioner RegistryPort
// precedent) so the DB-free tests drive it with in-memory fakes and the route +
// live leg use the Mongoose ports below. Per heartbeat: resolve tenant → read
// the prior pings → evaluate triggers (pure) → store the sample (with what it
// tripped) → mirror the gauges onto the Tenant doc → enqueue tasks idempotently.
//
// NO AuditLog rows: actorId is schema-REQUIRED and the Worker is not a
// principal — the heartbeats collection + the Task docs ARE the machine record
// (audit rows stay reserved for owner/principal actions, the F3.4 contract).
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantView {
  _id: Types.ObjectId | string;
  status: string;
}

export type EnqueueOutcome = "enqueued" | "already-open" | "snoozed";

export interface HeartbeatIngestPorts {
  findTenant(slug: string): Promise<TenantView | null>;
  /** The `limit` most recent PRIOR heartbeats for the tenant, newest-first. */
  priorPings(slug: string, limit: number): Promise<PriorPing[]>;
  insertHeartbeat(doc: HeartbeatIngest & { triggered?: string[] }): Promise<void>;
  applyMirror(
    tenantId: TenantView["_id"],
    set: Record<string, unknown>,
    arrayFilters: Record<string, unknown>[],
  ): Promise<void>;
  /** True when a done/dismissed task of this (tenant, type) closed at/after
   *  `since` — the reopen-snooze (a persistent condition must not re-mint a
   *  task every 15min onto the TTL-free collection). */
  recentlyClosedTask(tenantId: TenantView["_id"], type: TaskType, since: Date): Promise<boolean>;
  /** Race-safe open-task upsert keyed on openKey. */
  openTask(tenantId: TenantView["_id"], slug: string, d: TriggerDecision): Promise<"enqueued" | "already-open">;
}

export type IngestResult =
  | { status: "unknown-tenant" }
  | { status: "stored"; triggers: Array<{ type: TaskType; outcome: EnqueueOutcome }> };

export async function ingestHeartbeat(
  body: HeartbeatIngest,
  ports: HeartbeatIngestPorts,
  now: Date = new Date(),
): Promise<IngestResult> {
  const tenant = await ports.findTenant(body.tenant);
  // Unknown tenant: nothing stored — a heartbeat for a slug the registry does
  // not know is a mis-seeded Worker KV, and storing it would let a valid-key
  // holder grow the M0 under arbitrary names. The 404 is the Worker's signal.
  if (!tenant) return { status: "unknown-tenant" };

  const priors = await ports.priorPings(body.tenant, FAILOVER_CONSECUTIVE_MISSES - 1);
  const decisions = evaluateTriggers({
    body,
    tenantStatus: tenant.status,
    priorPings: priors,
    now,
  });

  // Store the sample BEFORE enqueueing (a task-write failure must not lose the
  // gauge history the next FAILOVER evaluation counts on).
  await ports.insertHeartbeat({
    ...body,
    ...(decisions.length > 0 ? { triggered: decisions.map((d) => d.type) } : {}),
  });

  const mirror = buildMirrorUpdate(body, now);
  await ports.applyMirror(tenant._id, mirror.set, mirror.arrayFilters);

  const triggers: Array<{ type: TaskType; outcome: EnqueueOutcome }> = [];
  for (const d of decisions) {
    const snoozed = await ports.recentlyClosedTask(
      tenant._id,
      d.type,
      new Date(now.getTime() - TASK_REOPEN_SNOOZE_MS),
    );
    const outcome: EnqueueOutcome = snoozed
      ? "snoozed"
      : await ports.openTask(tenant._id, body.tenant, d);
    triggers.push({ type: d.type, outcome });
  }
  return { status: "stored", triggers };
}

// ── Mongoose-backed ports (the route + the live leg) ─────────────────────────

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000
  );
}

export function realIngestPorts(): HeartbeatIngestPorts {
  return {
    async findTenant(slug) {
      return Tenant.findOne({ slug }).select("_id status").lean<TenantView | null>();
    },

    async priorPings(slug, limit) {
      const rows = await Heartbeat.find({ tenant: slug })
        .sort({ ts: -1 })
        .limit(limit)
        .select("hostOk ts")
        .lean<Array<{ hostOk: boolean; ts: Date }>>();
      return rows.map((r) => ({ hostOk: r.hostOk === true, ts: r.ts }));
    },

    async insertHeartbeat(doc) {
      await Heartbeat.create(doc);
    },

    async applyMirror(tenantId, set, arrayFilters) {
      await Tenant.updateOne({ _id: tenantId }, { $set: set }, { arrayFilters });
    },

    async recentlyClosedTask(tenantId, type, since) {
      const hit = await Task.exists({
        tenantId,
        type,
        status: { $in: ["done", "dismissed"] },
        updatedAt: { $gte: since },
      });
      return hit !== null;
    },

    async openTask(tenantId, slug, d) {
      // Upsert on the openKey: an existing open/in-progress task matches (no
      // insert); otherwise the equality filter seeds openKey on the new doc.
      // A concurrent duplicate loses on the partial-unique index (E11000).
      try {
        const res = await Task.updateOne(
          { openKey: taskOpenKey(tenantId, d.type) },
          {
            $setOnInsert: {
              tenantId,
              tenantSlug: slug,
              type: d.type,
              status: "open",
              reason: d.reason,
              payload: d.payload,
            },
          },
          { upsert: true },
        );
        return res.upsertedCount > 0 ? "enqueued" : "already-open";
      } catch (err) {
        if (isDuplicateKey(err)) return "already-open";
        throw err;
      }
    },
  };
}
