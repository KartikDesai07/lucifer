import mongoose, { Schema, type Document, type Model } from "mongoose";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B1) — the ONE
// designated Windows PC that drains apps/cafe/models/PrintJob.ts's queue and
// prints silently under --kiosk-printing. A singleton doc keyed by
// PRINT_HOST_KEY ("primary"): designating a new host overwrites whichever
// device currently holds this key.
//
// Deliberately NOT in the federated registry — a plain default-bound model,
// v1-grade like models/OrderRequest.ts. This is operational config (which PC
// prints), not money or tenant data, so it never needs the ledger's
// paise/sharding discipline.

export interface IPrintHost extends Document {
  key: string; // always PRINT_HOST_KEY ("primary") — unique creates the index
  deviceId: string;
  label: string;
  setBy: string; // staff name from session
  setAt: Date;
  lastSeenAt: Date;
  // Omit-empty is load-bearing here: designating a host $unsets both silent
  // fields (PH-3), and a `default:` would resurrect them on the very next
  // write that touches this doc.
  silentMode?: boolean;
  silentProbeMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA (not only the default-bound model), matching the
// codebase's schemas-not-models convention (models/OrderRequest.ts).
export const printHostSchema = new Schema<IPrintHost>(
  {
    // unique:true creates the index — no separate index() needed, mirroring
    // OrderRequest's shortCode.
    key: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    label: { type: String, required: true },
    setBy: { type: String, required: true },
    setAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    silentMode: { type: Boolean },
    silentProbeMs: { type: Number },
  },
  { timestamps: true },
);

// NO TTL index: this is a long-lived singleton config row, not an event —
// see models/PrintJob.ts's file-level comment for the ttl-guard rationale
// this mirrors.

// Reuse the compiled model across hot reloads / serverless invocations.
export const PrintHost: Model<IPrintHost> =
  (mongoose.models.PrintHost as Model<IPrintHost>) ??
  mongoose.model<IPrintHost>("PrintHost", printHostSchema);
