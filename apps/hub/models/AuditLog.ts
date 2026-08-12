import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// AuditLog — append-only Hub audit trail (F3.1 / phase-F3 §3.1). One row per
// security-relevant action: every secret reveal, provision, and rotate (F3.4
// writes them). TTL-FREE — the audit is RETAINED (the only TTL in the registry is
// the F3.7 Heartbeat collection, §3.4). Append-only is enforced at the app layer
// (F3.4 only ever inserts); this schema never carries an updatedAt.
// ─────────────────────────────────────────────────────────────────────────────

export interface IAuditLog extends Document {
  actorId: Types.ObjectId; // → HubUser (the acting owner/principal)
  action: string; // e.g. 'secret.reveal' | 'tenant.provision' | 'kek.rotate'
  targetTenantId?: Types.ObjectId; // → Tenant (absent for fleet-wide actions)
  secretId?: Types.ObjectId; // → Secret (present when the action touched a secret)
  ip: string; // the request IP (the panel's IP-allowlist context, F3.4)
  ts: Date; // the event time (IS the created-at; see timestamps below)
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "HubUser", required: true },
    action: { type: String, required: true },
    targetTenantId: { type: Schema.Types.ObjectId, ref: "Tenant" },
    secretId: { type: Schema.Types.ObjectId, ref: "Secret" },
    ip: { type: String, required: true },
  },
  {
    // `ts` IS the creation timestamp; no updatedAt (append-only, never mutated).
    timestamps: { createdAt: "ts", updatedAt: false },
    minimize: true,
  },
);

// phase-F3 §3.4: newest-first scan, and per-tenant history.
auditLogSchema.index({ ts: -1 });
auditLogSchema.index({ targetTenantId: 1, ts: -1 });

export const AuditLog: Model<IAuditLog> =
  (mongoose.models.AuditLog as Model<IAuditLog>) ??
  mongoose.model<IAuditLog>("AuditLog", auditLogSchema);

export { auditLogSchema };
