import mongoose, { Schema, type Model, type Types } from "mongoose";

// CB-4 — the diner ACCOUNT session. One document per signed-in diner device,
// keyed by the opaque token the `pos_diner` cookie carries.
//
// WHY a server-side row rather than a signed/stateless cookie: the entire
// forgotten-PIN recovery story for this feature is "staff reset it at the
// counter" (no OTP — the phase brief's cost decision). A reset MUST invalidate
// every live session for that mobile IMMEDIATELY, and a stateless token cannot
// be revoked before it expires — it would make the counter reset a lie. One
// `deleteMany({customerId})` here does revoke, instantly and completely.
//
// Plain default-bound model, v1-grade like models/PublicRateLimit.ts and
// models/DuePayment.ts — deliberately NOT in the federated cluster registry:
// this is ephemeral auth bookkeeping, not tenant/order/ledger data.
export interface IDinerSession {
  // The opaque token itself (DINER_SESSION_TOKEN_LENGTH chars over the shared
  // 32-symbol alphabet = 120 bits, minted by lib/public-token.ts's unbiased
  // crypto.randomInt draw). Used as the _id so resolving a cookie is a single
  // primary-key lookup with no secondary index.
  _id: string;
  customerId: Types.ObjectId;
  // Denormalised so the common "who is this?" read needs no Customer join.
  // A PIN reset does not change it; a mobile change would, but nothing in
  // this app edits a Customer's mobile in place today.
  mobile: string;
  // When this row was minted. Read by the opportunistic prune below — NOT a
  // TTL index (see the index comment).
  at: Date;
  // Hard expiry. Checked on every resolve, so a row that outlives the prune
  // (or a clock skew) still cannot authenticate anyone.
  expiresAt: Date;
}

export const dinerSessionSchema = new Schema<IDinerSession>(
  {
    _id: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    mobile: { type: String, required: true },
    at: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// PLAIN indexes, never TTL ones. @pos/shared/ttl-guard is default-DENY with
// exactly one allowlisted collection (heartbeats) and `assertTtlIndexesAllowed`
// THROWS at schema registration — a TTL index here would fail the suite, not
// merely be discouraged. Rows are reaped by the app instead
// (`pruneDinerSessions`, best-effort, called opportunistically off the login
// path — the same discipline as pruneRateWindows).
//
// `expiresAt` backs the prune's range filter (without it that deleteMany is a
// collection scan); `customerId` backs the revoke-on-PIN-reset deleteMany,
// which is the whole reason this collection exists.
dinerSessionSchema.index({ expiresAt: 1 });
dinerSessionSchema.index({ customerId: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const DinerSession: Model<IDinerSession> =
  (mongoose.models.DinerSession as Model<IDinerSession>) ??
  mongoose.model<IDinerSession>("DinerSession", dinerSessionSchema);
