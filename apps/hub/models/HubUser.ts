import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// HubUser — the owner auth store (F3.1 / phase-F3 §3.2), SEPARATE from any cafe's
// `Staff`. F3 is a SINGLE-owner store: `role:'owner'`, gated by WebAuthn passkey /
// TOTP (F3.4 builds the auth flow — TOTP is the v1 primary; the passkey lands when
// Auth.js's provider stabilizes). No password field — auth is passkey/TOTP.
//
// P8-G (build-rule #80) landed the additive franchise-principal fields below onto
// this store. Because F3's HubUser is single-owner and F3's invite flow is for
// CAFE owners, the NON-owner franchise principals (franchisor/areaManager/
// franchisee) need their own credential-provisioning + enrolment path — that path,
// and any widening of `role` beyond 'owner', is P8's job. F3.1 only carries the
// fields so P8 builds on a stable shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface IWebauthnCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  label?: string;
  createdAt?: Date;
}

/** F3.4 step-up freshness (§E-4). `at` = when the last 2FA was satisfied; `sid`
 * = the login-session id it belongs to (minted in the jwt callback at sign-in,
 * NOT client-supplied). A sensitive action requires `sid === token.sid` AND
 * `at` within STEP_UP_WINDOW_MS — so a step-up cannot be replayed across a
 * different (or forged) session. */
export interface IStepUp {
  at: Date;
  sid: string;
}

export interface IHubUser extends Document {
  email: string;
  role: "owner";
  webauthnCredentials: IWebauthnCredential[];
  totpSecretEnc?: string; // vault-encrypted TOTP secret (ciphertext, never plaintext)
  // F3.4 TOTP replay guard: the HOTP time-step of the last ACCEPTED code. A
  // login/step-up accepts a code only for a step STRICTLY GREATER than this, so
  // a code is single-use even within its ±1-step validity window.
  totpLastStep?: number;
  stepUp?: IStepUp; // F3.4 step-up freshness (omit-empty until first step-up)
  ipAllowlist: string[]; // IPs/CIDRs the panel accepts for this principal (F3.4)
  // ── P8-G additive franchise-principal fields (omit-empty; no defaults) ──
  franchiseRole?: "franchisor" | "areaManager" | "franchisee";
  chainClientId?: Types.ObjectId; // → Chain
  outletScope?: "all" | Types.ObjectId[]; // server-derived scope guard (#43); P8 validates
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const webauthnCredentialSchema = new Schema<IWebauthnCredential>(
  {
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: { type: [String], default: undefined },
    label: String,
    createdAt: { type: Date },
  },
  { _id: false },
);

const hubUserSchema = new Schema<IHubUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ["owner"], default: "owner" },
    webauthnCredentials: { type: [webauthnCredentialSchema], default: [] },
    // Never returned by default — opt in with .select('+totpSecretEnc') at the
    // (F3.4) verify boundary, decrypt just-in-time, zeroize.
    totpSecretEnc: { type: String, select: false },
    // F3.4 replay guard — the last accepted HOTP step (see IHubUser).
    totpLastStep: { type: Number },
    // F3.4 step-up freshness — subdoc, no own _id, omit-empty (no default) so an
    // owner who has never stepped up simply has no `stepUp` field.
    stepUp: {
      type: new Schema<IStepUp>(
        {
          at: { type: Date, required: true },
          sid: { type: String, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    ipAllowlist: { type: [String], default: [] },
    // ── P8-G additive block ──
    franchiseRole: {
      type: String,
      enum: ["franchisor", "areaManager", "franchisee"],
    },
    chainClientId: { type: Schema.Types.ObjectId, ref: "Chain" },
    // Union `'all' | ObjectId[]` — Mixed carries it faithfully; P8 owns validation
    // + the server-derived scope guard (#43). Never trust a client-supplied scope.
    outletScope: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, minimize: true },
);

// `{ email: 1 }` unique is created by the field-level `unique: true` above.

export const HubUser: Model<IHubUser> =
  (mongoose.models.HubUser as Model<IHubUser>) ??
  mongoose.model<IHubUser>("HubUser", hubUserSchema);

export { hubUserSchema, webauthnCredentialSchema };
