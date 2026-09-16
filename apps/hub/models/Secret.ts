import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Secret — the vault record (F3.2 / phase-F3 §3.2 + fed-secrets-vault.json §A).
// One row per stored tenant cloud credential (Atlas SRV URI, image-store API
// key/secret, Vercel token). Every field the crypto produces is base64 text;
// the record NEVER holds plaintext or an unwrapped DEK — the payload is
// AES-256-GCM under a per-record DEK, and the DEK is stored ONLY wrapped under
// the env KEK (`HUB_KEK`, never in this DB). lib/vault.ts is the ONLY reader/
// writer of the crypto fields; the rest of the Hub passes `Secret._id` refs
// (Tenant.dbPool.srvUriRef / imagePool.apiKeyRef / apiSecretRef).
//
// AAD binding: `aad` is the base64 of utf8("tenantId|provider|accountLabel")
// captured at encrypt time. The vault re-derives it from this doc's own identity
// fields on every read and GCM-authenticates it, so a record (or any one field)
// cannot be swapped between tenants/providers without decrypt throwing.
// ─────────────────────────────────────────────────────────────────────────────

export const SECRET_PROVIDERS = ["atlas", "vercel", "cloudinary", "r2"] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

// What KIND of credential the ciphertext holds (storeSecret's `classification`).
export const SECRET_CLASSIFICATIONS = ["dbUri", "apiKey", "apiSecret", "token"] as const;
export type SecretClassification = (typeof SECRET_CLASSIFICATIONS)[number];

// F3.3 rotateCred lifecycle (fed-secrets-vault.json §D): 'active' = in use;
// 'retired' = superseded by a rotation but provider revocation UNCONFIRMED
// (retry/revoke by hand); 'revoked' = provider key revoked — the ciphertext is
// KEPT for audit, never deleted. Legacy F3.2 rows lack the field (≡ active).
export const SECRET_STATUSES = ["active", "retired", "revoked"] as const;
export type SecretStatus = (typeof SECRET_STATUSES)[number];

export interface ISecret extends Document {
  tenantId: Types.ObjectId; // → Tenant (accounts sit under the client)
  provider: SecretProvider;
  accountLabel: string; // which of the tenant's accounts (e.g. "atlas-1")
  classification: SecretClassification;
  status: SecretStatus; // F3.3 rotateCred lifecycle (see SECRET_STATUSES)
  scope?: string; // provider scope note (e.g. "project:abc123"), display-only
  ciphertext: string; // b64 — AES-256-GCM(payload) under the per-record DEK
  iv: string; // b64 — 12-byte GCM nonce for the payload
  tag: string; // b64 — 16-byte GCM auth tag for the payload
  aad: string; // b64 — utf8("tenantId|provider|accountLabel") bound at encrypt
  wrappedDek: string; // b64 — AES-256-GCM(DEK) under the env KEK
  wrapIv: string; // b64 — 12-byte GCM nonce for the wrap
  wrapTag: string; // b64 — 16-byte GCM auth tag for the wrap
  keyVersion: number; // which KEK wrapped the DEK (F3.3 rotation key map)
  rotatedAt?: Date; // set by F3.3 rotateKEK when the DEK is re-wrapped
  lastUsedAt?: Date | null; // stamped by every getSecret (§B step 4)
  createdAt: Date;
  updatedAt: Date;
}

const secretSchema = new Schema<ISecret>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    provider: { type: String, enum: SECRET_PROVIDERS, required: true },
    accountLabel: { type: String, required: true, trim: true },
    classification: { type: String, enum: SECRET_CLASSIFICATIONS, required: true },
    status: { type: String, enum: SECRET_STATUSES, default: "active" },
    scope: String,
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    aad: { type: String, required: true },
    wrappedDek: { type: String, required: true },
    wrapIv: { type: String, required: true },
    wrapTag: { type: String, required: true },
    keyVersion: { type: Number, required: true },
    rotatedAt: Date,
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: true },
);

// phase-F3 §3.4: the registry lookup path (list a tenant's stored creds).
secretSchema.index({ tenantId: 1, provider: 1, accountLabel: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Secret: Model<ISecret> =
  (mongoose.models.Secret as Model<ISecret>) ??
  mongoose.model<ISecret>("Secret", secretSchema);

export { secretSchema };
