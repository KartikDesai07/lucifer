import mongoose, { Schema, type Document, type Model } from "mongoose";

import {
  HEARTBEATS_COLLECTION,
  HEARTBEAT_TTL_INDEX,
  type HeartbeatCluster,
  type HeartbeatImageUsage,
  type HeartbeatStatsState,
} from "@pos/shared/heartbeat";
import { assertTtlIndexesAllowed } from "@pos/shared/ttl-guard";

// ─────────────────────────────────────────────────────────────────────────────
// Heartbeat — the F3.7 ingest's gauge-sample store: one doc per Worker forward.
// THE ONLY TTL IN THE REGISTRY (phase-F3 §3.4): heartbeats are ephemeral samples,
// never audit/financial data, so they expire on the shared 7-day spec
// (`@pos/shared/heartbeat` owns the index; `@pos/shared/ttl-guard` allowlists
// the collection — consulted at registration below, build-rule #23).
//
// `ts` is HUB-STAMPED at ingest (timestamps createdAt — the AuditLog precedent):
// a skewed tenant/Worker clock must never shorten or extend retention. The
// envelope's `at` (the Worker's own forward time) is kept as informational data.
// ─────────────────────────────────────────────────────────────────────────────

export interface IHeartbeat extends Document {
  tenant: string; // Tenant slug (the Worker's KV key — see the shared envelope)
  hostOk: boolean;
  at?: string; // the Worker's forward time (its clock; informational)
  servedOrigin?: "active" | "standby";
  stats?: HeartbeatStatsState; // 'denied' surfaces a mis-seeded stats token
  bootstrap?: boolean;
  clusters?: HeartbeatCluster[];
  imageUsage?: HeartbeatImageUsage;
  /** Trigger types this sample TRIPPED (evaluated, whether or not a task was
   *  newly enqueued — dedupe outcome lives on the Task) — observability. */
  triggered?: string[];
  ts: Date; // Hub ingest time (IS the created-at; the TTL field)
}

const heartbeatClusterSchema = new Schema<HeartbeatCluster>(
  {
    name: { type: String, required: true },
    tag: String,
    role: { type: String, enum: ["core", "ledger", "standby"], required: true },
    active: Boolean,
    state: { type: String, enum: ["ok", "error"], required: true },
    usedPct: Number,
    dataSize: Number,
    indexSize: Number,
    conns: Number,
    paused: Boolean,
  },
  { _id: false, minimize: true },
);

const heartbeatSchema = new Schema<IHeartbeat>(
  {
    tenant: { type: String, required: true, trim: true },
    hostOk: { type: Boolean, required: true },
    at: String,
    servedOrigin: { type: String, enum: ["active", "standby"] },
    stats: { type: String, enum: ["ok", "denied", "error"] },
    bootstrap: Boolean,
    // default:undefined — a cluster-less down-ping stays omit-empty (absent),
    // matching the envelope (the Tenant.routing.orderWindows precedent).
    clusters: { type: [heartbeatClusterSchema], default: undefined },
    imageUsage: { storagePct: Number, bandwidthPct: Number, creditsPct: Number },
    triggered: { type: [String], default: undefined },
  },
  {
    // `ts` IS the creation timestamp; no updatedAt (samples are never mutated).
    timestamps: { createdAt: "ts", updatedAt: false },
    minimize: true,
    collection: HEARTBEATS_COLLECTION, // pinned — pluralization must never fork it
  },
);

// The shared 7-day TTL spec, verbatim (F2.9 shipped the contract; F3.7
// materializes the index). Mutable copies — mongoose mutates its args.
heartbeatSchema.index({ ...HEARTBEAT_TTL_INDEX.key }, {
  expireAfterSeconds: HEARTBEAT_TTL_INDEX.expireAfterSeconds,
});
// Per-tenant newest-first: the FAILOVER prior-misses read + the health view.
heartbeatSchema.index({ tenant: 1, ts: -1 });

// Build-rule #23 at the ONE site that creates a registry TTL: fail schema
// registration (every boot + every test run) if this collection ever leaves the
// shared allowlist or the index spec goes compound/invalid. A test walks ALL
// hub schemas with the same guard (models/Heartbeat.test.ts).
assertTtlIndexesAllowed(
  HEARTBEATS_COLLECTION,
  heartbeatSchema.indexes().map(([key, options]) => ({ key, options })),
);

export const Heartbeat: Model<IHeartbeat> =
  (mongoose.models.Heartbeat as Model<IHeartbeat>) ??
  mongoose.model<IHeartbeat>("Heartbeat", heartbeatSchema);

export { heartbeatSchema, heartbeatClusterSchema };
