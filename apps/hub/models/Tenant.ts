import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Tenant — the registry document (F3.1 / phase-F3 §3.2). ONE doc per cafe: its
// hosting[] (active+standby), dbPool[] (clusters w/ role/usedPct + an ENCRYPTED
// URI *ref*), imagePool[], branding, domain, the routing shard-map the F2 runtime
// router mirrors, and idempotent provisioning state.
//
// Secrets are NEVER inlined here — pool docs hold `*Ref` ObjectIds into the
// `Secret` collection (the vault). The `Secret` model + the vault crypto are F3.2;
// F3.1 only defines the refs. Reading/listing the registry never touches ciphertext.
//
// Product-agnostic note (§3.2, the owner's future Fleet Hub): this Tenant IS the
// `clients`-row shape specialized for the one shipped product (cafe-POS). F3 ships
// ONLY the Tenant doc (build-rule #80: "F3 ships only the one-Tenant-doc") — NOT a
// generic products/clients/accounts fleet model. The P8 grouping lands as the
// additive block below + the Chain collection (see models/Chain.ts).
//
// Byte policy: this is a tiny one-doc-per-cafe collection (512MB is effectively
// infinite, §2 decision 1), so the aggressive omit-empty (#8) that governs the
// millions-of-rows Order ledger does NOT apply to the base registry fields — the
// pool arrays keep Mongoose's INTENDED auto-`[]` (friendlier to push/query; the
// opposite of the Order ledger's `default:undefined` suppression). Verified with a
// live raw-BSON probe: a minimal Tenant stores `hosting/dbPool/imagePool` as `[]`
// (`minimize` strips empty OBJECTS, not empty arrays). The P8 block below, and the
// genuinely-optional nested objects (branding/domain/routing/provisioning), ARE
// omit-empty: absent means a semantic default (absent chainClientId = standalone
// cafe), so those carry no `default:` and are dropped by `minimize` when unset.
// ─────────────────────────────────────────────────────────────────────────────

// Mongoose Int32 (8.12+) → a real BSON int32. Its TS SchemaDefinition typing isn't
// in the `number` union yet, so alias it for the generic; the runtime value is the
// unchanged real Int32 SchemaType. Used ONLY for the P8 royalty rate/paise fields.
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;

export interface IHostingAccount {
  provider: "vercel";
  accountLabel: string;
  vercelTeamId?: string;
  projectId?: string;
  deployUrl?: string;
  role: "active" | "standby";
  health?: { state?: string; lastPingAt?: Date };
}

export interface IDbCluster {
  provider: "atlas";
  accountLabel: string;
  orgId?: string;
  projectId?: string;
  clusterName: string;
  srvUriRef?: Types.ObjectId; // → Secret._id (NEVER the plaintext SRV URI). Vault = F3.2.
  role: "primary" | "orders-current" | "orders-archive";
  capacityBytes: number;
  usedBytes?: number;
  usedPct?: number; // the conservative (dataSize+indexSize)/512MB gauge (F2c §2)
  state?: "idle" | "paused" | "creating";
  lastStatAt?: Date;
}

export interface ICloudAccount {
  provider: "cloudinary" | "r2";
  accountLabel: string;
  cloudName?: string;
  bucket?: string;
  accountId?: string; // R2 only — the account hex in the S3 endpoint host (F3.6)
  publicBaseUrl?: string; // R2 only — NEXT_PUBLIC_R2_PUBLIC_BASE_URL (F3.6 env re-derivation)
  apiKeyRef?: Types.ObjectId; // → Secret._id
  apiSecretRef?: Types.ObjectId; // → Secret._id
  role: "active" | "full";
  usage?: { storagePct?: number; bandwidthPct?: number; creditsPct?: number };
  lastUsageAt?: Date;
}

export interface IOrderWindow {
  clusterName: string;
  fromDate: Date;
  toDate?: Date | null; // null / absent = the open-ended current window
}

// P8-G (build-rule #80): royalty is a RATE in BASIS POINTS (600 = 6.00%, ÷10000) —
// EXEMPT from the paise `$type` sweep but its own Int32 assertion (#40/#61).
export interface ITenantRoyalty {
  rateBp: number;
  basis: "netOfGst" | "netOfDiscount" | "gross";
  minPaise?: number;
  sinceYmd?: string;
}

export interface ITenant extends Document {
  slug: string;
  status: "provisioning" | "active" | "suspended" | "failover" | "archived";
  plan: "free";
  ownerEmail: string; // the CLIENT's email — accounts sit under the client
  businessType: "cafe" | "qsr" | "bar"; // single qualifying question → starter-menu branch
  branding?: {
    name?: string;
    tagline?: string;
    logoPublicId?: string;
    primaryColor?: string;
  };
  domain?: {
    primary?: string;
    vercelDomainId?: string;
    dnsMode?: "cname" | "vercel-ns";
    sslState?: string;
  };
  hosting: IHostingAccount[]; // [0]=active, [1]=standby
  dbPool: IDbCluster[]; // app-sharded pool, >=1 once provisioned
  imagePool: ICloudAccount[]; // image clouds, >=1 active once provisioned
  routing?: {
    reference?: string;
    counters?: string;
    orders?: string;
    orderWindows?: IOrderWindow[];
  };
  provisioning?: {
    step?: string;
    lastError?: string;
    idempotencyKey?: string;
    // F3.6 single-flight lease (omit-empty): a per-tenant CAS lock serializing two
    // overlapping same-key provision runs so a step's password-reset + secret store +
    // runtime-doc write cannot interleave. TTL-bounded so a crashed holder frees for resume.
    leaseToken?: string;
    leaseUntil?: Date;
    updatedAt?: Date;
  };
  lastBackupAt?: Date;
  // ── P8-G additive grouping block (omit-empty #8, behind `chv`) ──
  chainClientId?: Types.ObjectId; // FK → Chain; ABSENT ⇒ standalone cafe
  ownershipType?: "company" | "franchise"; // ABSENT ⇒ 'company'
  consolidation?: { optIn: boolean; displayName?: string; lastSummaryAsOf?: Date };
  royalty?: ITenantRoyalty;
  gstinDisplay?: string; // DISPLAY-ONLY copy — authority is the outlet's own Settings
  chv?: number; // P8 grouping schema-version (lazy migrate-on-read, #10)
  createdAt: Date;
  updatedAt: Date;
}

const hostingAccountSchema = new Schema<IHostingAccount>(
  {
    provider: { type: String, enum: ["vercel"], default: "vercel" },
    accountLabel: { type: String, required: true },
    vercelTeamId: String,
    projectId: String,
    deployUrl: String,
    role: { type: String, enum: ["active", "standby"], required: true },
    health: { state: String, lastPingAt: Date },
  },
  { _id: false, minimize: true },
);

const dbClusterSchema = new Schema<IDbCluster>(
  {
    provider: { type: String, enum: ["atlas"], default: "atlas" },
    accountLabel: { type: String, required: true },
    orgId: String,
    projectId: String,
    clusterName: { type: String, required: true },
    srvUriRef: { type: Schema.Types.ObjectId, ref: "Secret" },
    role: {
      type: String,
      enum: ["primary", "orders-current", "orders-archive"],
      required: true,
    },
    capacityBytes: { type: Number, default: 536870912 },
    usedBytes: Number,
    usedPct: Number,
    state: { type: String, enum: ["idle", "paused", "creating"] },
    lastStatAt: Date,
  },
  { _id: false, minimize: true },
);

const cloudAccountSchema = new Schema<ICloudAccount>(
  {
    provider: { type: String, enum: ["cloudinary", "r2"], required: true },
    accountLabel: { type: String, required: true },
    cloudName: String,
    bucket: String,
    accountId: String,
    publicBaseUrl: String,
    apiKeyRef: { type: Schema.Types.ObjectId, ref: "Secret" },
    apiSecretRef: { type: Schema.Types.ObjectId, ref: "Secret" },
    role: { type: String, enum: ["active", "full"], required: true },
    usage: { storagePct: Number, bandwidthPct: Number, creditsPct: Number },
    lastUsageAt: Date,
  },
  { _id: false, minimize: true },
);

const orderWindowSchema = new Schema<IOrderWindow>(
  {
    clusterName: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, default: null },
  },
  { _id: false },
);

const tenantRoyaltySchema = new Schema<ITenantRoyalty>(
  {
    rateBp: { type: Int32, required: true },
    basis: {
      type: String,
      enum: ["netOfGst", "netOfDiscount", "gross"],
      required: true,
    },
    minPaise: { type: Int32 },
    sinceYmd: { type: String },
  },
  { _id: false, minimize: true },
);

const tenantSchema = new Schema<ITenant>(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["provisioning", "active", "suspended", "failover", "archived"],
      required: true,
      default: "provisioning",
    },
    plan: { type: String, enum: ["free"], default: "free" },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true },
    businessType: {
      type: String,
      enum: ["cafe", "qsr", "bar"],
      required: true,
    },
    branding: {
      name: String,
      tagline: String,
      logoPublicId: String,
      primaryColor: String,
    },
    domain: {
      primary: String,
      vercelDomainId: String,
      dnsMode: { type: String, enum: ["cname", "vercel-ns"] },
      sslState: String,
    },
    hosting: { type: [hostingAccountSchema] },
    dbPool: { type: [dbClusterSchema] },
    imagePool: { type: [cloudAccountSchema] },
    routing: {
      reference: String,
      counters: String,
      orders: String,
      // default:undefined so an untouched `routing` stays omit-empty (absent on a
      // fresh provisioning tenant) rather than materializing as {orderWindows:[]}.
      orderWindows: { type: [orderWindowSchema], default: undefined },
    },
    provisioning: {
      step: String,
      lastError: String,
      idempotencyKey: String,
      leaseToken: String,
      leaseUntil: Date,
      updatedAt: Date,
    },
    lastBackupAt: Date,
    // ── P8-G additive grouping block (omit-empty; no defaults) ──
    chainClientId: { type: Schema.Types.ObjectId, ref: "Chain" },
    ownershipType: { type: String, enum: ["company", "franchise"] },
    consolidation: {
      optIn: { type: Boolean },
      displayName: String,
      lastSummaryAsOf: Date,
    },
    royalty: { type: tenantRoyaltySchema },
    gstinDisplay: String,
    chv: { type: Int32 },
  },
  { timestamps: true, minimize: true },
);

// ── Indexes (phase-F3 §3.4 + P8-G) ──────────────────────────────────────────
// `{ slug: 1 }` unique is created by the field-level `unique: true` above; do not
// re-declare it (mongoose warns on duplicate index definitions).
tenantSchema.index({ status: 1 });

// `domain.primary` is OPTIONAL — a provisioning tenant has no domain yet. §3.4
// specs a plain `unique` index, but that would collide across the many domain-less
// provisioning tenants (missing == null, and a plain unique index allows only ONE
// null). REFINED to a PARTIAL unique index over docs that actually HAVE a domain
// (the order.ledger.ts partial-index precedent). This is a correctness fix, not a
// scope change — uniqueness is still enforced on every real domain.
tenantSchema.index(
  { "domain.primary": 1 },
  {
    unique: true,
    partialFilterExpression: { "domain.primary": { $exists: true } },
    name: "domain_primary_unique",
  },
);

// P8-G consolidation fan-out lookup (build-rule #80): chain + opt-in.
tenantSchema.index({ chainClientId: 1, "consolidation.optIn": 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Tenant: Model<ITenant> =
  (mongoose.models.Tenant as Model<ITenant>) ??
  mongoose.model<ITenant>("Tenant", tenantSchema);

export {
  tenantSchema,
  hostingAccountSchema,
  dbClusterSchema,
  cloudAccountSchema,
  orderWindowSchema,
  tenantRoyaltySchema,
};
