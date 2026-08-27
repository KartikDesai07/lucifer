import mongoose, { Schema, type Model } from "mongoose";

// CR2.2 SLICE 3 — storage for the public order rate limiter
// (lib/public-rate-limit.ts). One document per (bucket, fixed window): a
// diner's table publicToken, or the shared PARCEL_BUCKET_KEY
// (@pos/shared/public), against the window index that request's timestamp
// falls into. The atomic `$inc` in hitRateLimit is what makes this race-safe
// across concurrent hits from the same table with no read-then-write.
//
// Plain default-bound model, v1-grade like models/DuePayment.ts — never in
// the federated registry (this is ephemeral rate-limit bookkeeping, not
// tenant/order data), so it stays out of cluster-registry SCHEMAS entirely.
export interface IPublicRateLimit {
  // `${bucket}:${windowIndex}` — e.g. "8QK3M2N7P4WXYZ:2831277" or
  // "parcel:2831277". Composing bucket+window into the _id (rather than a
  // compound key) is what lets the upsert below be a single atomic op.
  _id: string;
  n: number; // hits counted against this bucket in this window so far
  at: Date; // when this window's row was first created — read by the prune below
}

export const publicRateLimitSchema = new Schema<IPublicRateLimit>(
  {
    _id: { type: String, required: true },
    n: { type: Number, required: true, default: 0 },
    at: { type: Date, required: true },
  },
  { versionKey: false },
);

// A PLAIN index, not a TTL one. ttl-guard's allowlist (@pos/shared/ttl-guard)
// admits exactly one registry TTL index platform-wide (Heartbeat) — this
// model was never a candidate for that list, so rows are reaped by the app
// instead (pruneRateWindows' best-effort deleteMany, called opportunistically
// from the hot path). The index still matters: without it that deleteMany's
// `{at: {$lt: ...}}` filter is a collection scan.
publicRateLimitSchema.index({ at: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const PublicRateLimit: Model<IPublicRateLimit> =
  (mongoose.models.PublicRateLimit as Model<IPublicRateLimit>) ??
  mongoose.model<IPublicRateLimit>("PublicRateLimit", publicRateLimitSchema);
