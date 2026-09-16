import mongoose, { type Types } from "mongoose";

import { Task, type ITaskPayload, type ITaskRun, type ITaskRunTarget, type TaskStatus, type TaskType } from "@/models/Task";
import { Tenant, type IDbCluster } from "@/models/Tenant";
import { createMongooseRegistry, type TenantRouting } from "@/lib/provisioner-registry";
import { CLUSTER_REGISTRY_COLLECTION } from "@/lib/provisioner-plan";
import { HOTADD_DIAL_TIMEOUT_MS, type StoredRuntimeRegistryDoc } from "@/lib/hotadd-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F3.8 — the IO half of the HOT-ADD-DB-CLUSTER machine (lib/hotadd-plan.ts's pure
// half + the F3.6 provisioner-registry/ports precedent): the Task-doc CAS port
// (claim/lease/lease-fenced writes/close/dismiss — A1/A4/A5/A9), the runtime
// clusterRegistry doc port (a SHORT-LIVED conn to the tenant's OWN cluster, never
// the Hub registry — the F3.6 writeRuntimeClusterRegistry pattern), and the Hub
// Tenant-registry port (composes F3.6's createMongooseRegistry; adds the A6
// role-only positional $set demote). lib/hotadd.ts (the machine) is the only
// caller — no route/UI/test wiring here (slice C).
//
// No-console gate: SRV URIs flow through the runtime-doc port.
// ─────────────────────────────────────────────────────────────────────────────

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// ── HotAddTaskPort — every write is scoped to ONE task doc ──────────────────
export interface HotAddTaskView {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  tenantSlug: string;
  type: TaskType;
  status: TaskStatus;
  payload?: ITaskPayload;
  run?: ITaskRun;
}

export type HotAddCloseOpts = { kind: "claimed"; runId: string } | { kind: "unclaimed" };
export type HotAddDismissOutcome = "dismissed" | "run-in-flight" | "not-open";

export interface HotAddTaskPort {
  load(taskId: string): Promise<HotAddTaskView | null>;
  /** ONE CAS: open→in-progress + stamp run.target/approvedBy/approvedAt (A1). openKey untouched. */
  claim(taskId: string, target: ITaskRunTarget, approvedBy: Types.ObjectId, now: Date): Promise<boolean>;
  /** CAS: free/expired/ours (A4). */
  acquireLease(taskId: string, runId: string, until: Date, now: Date): Promise<boolean>;
  renewLease(taskId: string, runId: string, until: Date): Promise<void>;
  releaseLease(taskId: string, runId: string): Promise<void>;
  /** Lease-fenced (A4): filter always includes run.leaseToken===runId. */
  saveStep(taskId: string, runId: string, step: string): Promise<boolean>;
  stampProjectId(taskId: string, runId: string, projectId: string): Promise<boolean>;
  /** R2: stamped once, right after a successful createM0 (incl. 409-adopt) — lease-fenced like stampProjectId. */
  stampM0Created(taskId: string, runId: string): Promise<boolean>;
  saveError(taskId: string, runId: string, message: string): Promise<boolean>;
  /** R4: no lease exists pre-claim — filtered on status:'open' only (never lease-fenced) so a claim-path throw still surfaces on GET. */
  saveErrorUnclaimed(taskId: string, message: string): Promise<boolean>;
  /** Exactly-once close (A5): modified===1 ⇔ THIS call closed it. */
  close(taskId: string, opts: HotAddCloseOpts): Promise<boolean>;
  /** Step-up-gated, lease-fenced dismiss (A9). */
  dismiss(taskId: string, now: Date): Promise<HotAddDismissOutcome>;
}

export function createHotAddTaskPort(): HotAddTaskPort {
  return {
    async load(taskId) {
      const doc = await Task.findById(taskId)
        .select("tenantId tenantSlug type status payload run")
        .lean<HotAddTaskView | null>();
      return doc ?? null;
    },

    async claim(taskId, target, approvedBy, now) {
      const res = await Task.updateOne(
        { _id: taskId, status: "open", "run.target": { $exists: false } },
        {
          $set: {
            status: "in-progress",
            "run.target": target,
            "run.approvedBy": approvedBy,
            "run.approvedAt": now,
          },
        },
      );
      return res.modifiedCount === 1;
    },

    async acquireLease(taskId, runId, until, now) {
      const res = await Task.updateOne(
        {
          _id: taskId,
          status: "in-progress",
          $or: [
            { "run.leaseUntil": { $exists: false } },
            { "run.leaseUntil": { $lt: now } },
            { "run.leaseToken": runId }, // re-entrant: already ours
          ],
        },
        { $set: { "run.leaseToken": runId, "run.leaseUntil": until } },
      );
      return res.modifiedCount === 1 || res.matchedCount === 1;
    },

    async renewLease(taskId, runId, until) {
      await Task.updateOne(
        { _id: taskId, "run.leaseToken": runId },
        { $set: { "run.leaseUntil": until } },
      );
    },

    async releaseLease(taskId, runId) {
      await Task.updateOne(
        { _id: taskId, "run.leaseToken": runId },
        { $unset: { "run.leaseToken": "", "run.leaseUntil": "" } },
      );
    },

    async saveStep(taskId, runId, step) {
      const res = await Task.updateOne(
        { _id: taskId, "run.leaseToken": runId },
        { $set: { "run.step": step }, $unset: { "run.lastError": "" } },
      );
      return res.modifiedCount === 1;
    },

    async stampProjectId(taskId, runId, projectId) {
      const res = await Task.updateOne(
        { _id: taskId, "run.leaseToken": runId },
        { $set: { "run.target.projectId": projectId } },
      );
      return res.modifiedCount === 1;
    },

    async stampM0Created(taskId, runId) {
      const res = await Task.updateOne({ _id: taskId, "run.leaseToken": runId }, { $set: { "run.target.m0Created": true } });
      return res.modifiedCount === 1;
    },

    async saveError(taskId, runId, message) {
      const res = await Task.updateOne({ _id: taskId, "run.leaseToken": runId }, { $set: { "run.lastError": message } });
      return res.modifiedCount === 1;
    },

    async saveErrorUnclaimed(taskId, message) {
      const res = await Task.updateOne({ _id: taskId, status: "open" }, { $set: { "run.lastError": message } });
      return res.modifiedCount === 1;
    },

    async close(taskId, opts) {
      const filter =
        opts.kind === "claimed"
          ? { _id: taskId, status: "in-progress", "run.leaseToken": opts.runId }
          : { _id: taskId, status: "open" };
      const res = await Task.updateOne(filter, {
        $set: { status: "done", "run.step": "done" },
        $unset: { openKey: "" },
      });
      return res.modifiedCount === 1;
    },

    async dismiss(taskId, now) {
      const res = await Task.updateOne(
        {
          _id: taskId,
          status: { $in: ["open", "in-progress"] },
          $or: [{ "run.leaseUntil": { $exists: false } }, { "run.leaseUntil": { $lt: now } }],
        },
        { $set: { status: "dismissed" }, $unset: { openKey: "" } },
      );
      if (res.modifiedCount === 1) return "dismissed";
      // 0 matched: distinguish a live-leased run-in-flight from an already
      // done/dismissed task via a follow-up read (never blind-fail closed).
      const doc = await Task.findById(taskId).select("status run.leaseUntil").lean();
      const stillOpen = doc?.status === "open" || doc?.status === "in-progress";
      const liveLease = doc?.run?.leaseUntil !== undefined && doc.run.leaseUntil.getTime() >= now.getTime();
      return stillOpen && liveLease ? "run-in-flight" : "not-open";
    },
  };
}

// ── RuntimeDocPort — dials the TENANT'S OWN primary cluster, never the Hub ──
export interface RuntimeDocApplyUpdate {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

export interface RuntimeDocPort {
  readDoc(uri: string): Promise<StoredRuntimeRegistryDoc | null>;
  insertDoc(uri: string, doc: StoredRuntimeRegistryDoc): Promise<"inserted" | "exists">;
  applyUpdate(uri: string, op: RuntimeDocApplyUpdate): Promise<number>;
  ping(uri: string): Promise<void>;
}

export interface RuntimeDocDeps {
  openConn: (uri: string) => Promise<mongoose.Connection>;
}

function defaultOpenConn(uri: string): Promise<mongoose.Connection> {
  const conn = mongoose.createConnection(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    bufferCommands: false,
    serverSelectionTimeoutMS: HOTADD_DIAL_TIMEOUT_MS,
  });
  return conn.asPromise();
}

export function createRuntimeDocPort(deps: Partial<RuntimeDocDeps> = {}): RuntimeDocPort {
  const openConn = deps.openConn ?? defaultOpenConn;

  // Connect errors are sanitized AT SOURCE to the error class name (A8, the
  // F3.6 writeRuntimeClusterRegistry pattern) — a driver connect/parse failure
  // can otherwise echo the credential-bearing SRV into run.lastError.
  async function withConn<T>(uri: string, fn: (conn: mongoose.Connection) => Promise<T>): Promise<T> {
    let conn: mongoose.Connection;
    try {
      conn = await openConn(uri);
    } catch (err) {
      throw new Error(`[hotadd] runtime dial failed (${(err as { name?: string })?.name ?? "Error"})`);
    }
    try {
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }

  return {
    readDoc(uri) {
      return withConn(uri, (conn) =>
        conn.db!.collection<StoredRuntimeRegistryDoc>(CLUSTER_REGISTRY_COLLECTION).findOne({}),
      );
    },

    insertDoc(uri, doc) {
      return withConn(uri, async (conn) => {
        try {
          await conn.db!.collection<StoredRuntimeRegistryDoc>(CLUSTER_REGISTRY_COLLECTION).insertOne(doc);
          return "inserted";
        } catch (err) {
          if (isDuplicateKey(err)) return "exists";
          throw err;
        }
      });
    },

    applyUpdate(uri, { filter, update }) {
      // Untyped collection handle: filter/update arrive as the pure plan
      // module's Record<string, unknown> CAS shapes (buildHotAddFlipUpdate) —
      // a typed<StoredRuntimeRegistryDoc> handle would reject their operator
      // shape at the type level even though it is a valid Mongo update doc.
      return withConn(uri, async (conn) => {
        const res = await conn.db!.collection(CLUSTER_REGISTRY_COLLECTION).updateOne(filter, update);
        return res.matchedCount;
      });
    },

    async ping(uri) {
      await withConn(uri, async (conn) => {
        await conn.db!.command({ ping: 1 });
      });
    },
  };
}

// ── HubTenantPort — the Hub registry, COMPOSING F3.6's RegistryPort ─────────
export interface HubTenantView {
  _id: Types.ObjectId;
  status: string;
  dbPool: Array<{ clusterName: string; role: IDbCluster["role"] }>;
}

export interface HubTenantPort {
  findTenant(slug: string): Promise<HubTenantView | null>;
  upsertDbCluster(slug: string, entry: IDbCluster): Promise<void>;
  setRouting(slug: string, routing: TenantRouting): Promise<void>;
  /** A6: role-only positional $set — NEVER a whole-element replace (that would
   *  strip srvUriRef and orphan the archive from F3.11 backups). */
  setDbClusterRole(slug: string, clusterName: string, role: IDbCluster["role"]): Promise<void>;
}

export function createHubTenantPort(): HubTenantPort {
  const registry = createMongooseRegistry();
  return {
    async findTenant(slug) {
      const doc = await Tenant.findOne({ slug })
        .select("_id status dbPool.clusterName dbPool.role")
        .lean<HubTenantView | null>();
      return doc ?? null;
    },
    upsertDbCluster: (slug, entry) => registry.upsertDbCluster(slug, entry),
    setRouting: (slug, routing) => registry.setRouting(slug, routing),
    setDbClusterRole(slug, clusterName, role) {
      return Tenant.updateOne(
        { slug, "dbPool.clusterName": clusterName },
        { $set: { "dbPool.$.role": role } },
      ).then(() => undefined);
    },
  };
}
