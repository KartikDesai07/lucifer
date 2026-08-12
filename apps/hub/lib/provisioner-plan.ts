// ─────────────────────────────────────────────────────────────────────────────
// F3.6 — the PURE half of the PROVISION-NEW-TENANT state machine (the cafe's
// plan/IO split precedent): the step order, deterministic resource names, the
// secret-identity catalogue, the runtime env map, the runtime clusterRegistry
// doc builders, and the intake/slug guards. NO IO — lib/provisioner-steps.ts +
// lib/provisioner-registry.ts own the mutations; lib/provisioner.ts owns the loop.
//
// Determinism is the resumability key: every project/cluster/user/domain name is
// a pure function of the tenant slug + role, so a re-run ADOPTS the resources a
// crashed run created (createProject 409→byName, createM0 create-or-leave,
// createDbUser 409→PATCH) instead of minting duplicates.
//
// No-console gate (eslint override + scan test): SRV URIs with passwords and
// NEXTAUTH/token values flow through buildTenantEnv / the doc builders.
// ─────────────────────────────────────────────────────────────────────────────

import type { SecretClassification, SecretProvider } from "@/models/Secret";
import type { VercelEnvVar } from "@/lib/vercel";

// ── The step machine ─────────────────────────────────────────────────────────
/** The ordered provisioning steps. `provisioning.step` records the LAST COMPLETED
 *  step; a resume runs `stepsAfter(step)`. A THROWN step does NOT advance the
 *  pointer, so the failed step re-runs from the top on the next attempt — every
 *  sub-op is individually check-then-create so that re-run is a no-op-or-adopt. */
export const STEP_ORDER = [
  "db.primary",
  "db.orders",
  "image",
  "host.active",
  "host.standby",
  "domain",
  "seed",
  "invite",
] as const;
export type StepName = (typeof STEP_ORDER)[number];

/** The pointer value before any step has completed, and the terminal value. */
export const STEP_START = "intake";
export const STEP_DONE = "done";

/** The steps still to run after `last` completed. `STEP_START`/unknown ⇒ all;
 *  `STEP_DONE` ⇒ none. */
export function stepsAfter(last: string | undefined): StepName[] {
  if (last === STEP_DONE) return [];
  const idx = STEP_ORDER.indexOf(last as StepName);
  // -1 (intake / unknown) ⇒ slice(0) ⇒ every step.
  return STEP_ORDER.slice(idx + 1);
}

// ── Deterministic resource names ──────────────────────────────────────────────
/** Atlas project holding exactly one free M0, per role. One project per M0 (the
 *  free-tier 1-M0-per-project limit). */
export function atlasProjectName(slug: string, role: DbRole): string {
  return role === "primary" ? `pos-${slug}-core` : `pos-${slug}-orders-a`;
}
/** Cluster name within its project (project-scoped, so no slug needed). */
export function atlasClusterName(role: DbRole): string {
  return role === "primary" ? "pos-core" : "pos-orders-a";
}
/** The scoped DB user minted per cluster (least-priv readWrite on the app db). */
export const DB_USERNAME = "pos_app";
/** The app database the runtime uses (v1's `/pos` URI convention). */
export const APP_DB_NAME = "pos";
/** The A-series ledger tag the day-one orders cluster carries (F2 BOOTSTRAP_LEDGER_TAG). */
export const ORDERS_LEDGER_TAG = "A";
/** The Vercel project name (same on the active + standby accounts — separate namespaces). */
export function vercelProjectName(slug: string): string {
  return `pos-${slug}`;
}
/** The platform subdomain a cafe is reachable on (§6 Cloudflare-owned domain). */
export function domainFor(slug: string, rootDomain: string): string {
  return `${slug}.${rootDomain}`;
}

export type DbRole = "primary" | "orders";
export type HostRole = "active" | "standby";

// ── Slug guard (R6 — reserved-subdomain reachability contract) ───────────────
/** Subdomains the cafe runtime REFUSES to resolve to a tenant
 *  (apps/cafe/lib/platform.ts RESERVED_SUBDOMAINS). DUPLICATED here because the
 *  Hub is a separate workspace that cannot import the cafe app; a parity test
 *  (provisioner-plan.test.ts) reads the cafe source and asserts the two lists are
 *  identical so this can never silently drift. Hoisting to @pos/shared is the
 *  ideal fix, deferred to avoid editing shipped-and-verified F2 code mid-F3. */
export const RESERVED_SUBDOMAINS: readonly string[] = ["www", "app", "api", "admin", "hub"];

/** The subdomain charset the cafe router accepts (`[a-z0-9-]+`). */
const SLUG_CHARSET = /^[a-z0-9-]+$/;

/** Fail-fast at intake, BEFORE any Tenant doc or provider resource is created, so
 *  an unreachable slug never leaves orphaned infrastructure. A slug in the
 *  reserved set (or off the router charset) would 404 the cafe on its own
 *  subdomain even though slug-uniqueness passes. */
export function assertProvisionableSlug(slug: string): void {
  if (!SLUG_CHARSET.test(slug)) {
    throw new Error(`[provisioner] slug "${slug}" is not a valid subdomain ([a-z0-9-]+)`);
  }
  if (RESERVED_SUBDOMAINS.includes(slug)) {
    throw new Error(`[provisioner] slug "${slug}" is reserved (${RESERVED_SUBDOMAINS.join("/")}) — choose another`);
  }
}

// ── Secret identity catalogue ─────────────────────────────────────────────────
/** The (provider, accountLabel, classification) tuple that keys a vault Secret.
 *  accountLabel is part of the AES-GCM AAD, so encoding the cluster into the
 *  dbUri label ("atlas-1/pos-core") cryptographically BINDS the URI to its
 *  cluster — a leaked-DB attacker cannot re-point it at another cluster. */
export interface SecretIdentityKey {
  provider: SecretProvider;
  accountLabel: string;
  classification: SecretClassification;
}

/** The pasted org-scoped Atlas Service-Account (stored as ONE JSON secret). */
export const ATLAS_SA: SecretIdentityKey = {
  provider: "atlas",
  accountLabel: "atlas-1",
  classification: "token",
};
/** The pasted Vercel token for the active / standby hosting account. */
export function vercelTokenId(role: HostRole): SecretIdentityKey {
  return { provider: "vercel", accountLabel: role === "active" ? "vercel-1" : "vercel-2", classification: "token" };
}
/** The per-cluster SRV URI (with the DB password) the provisioner mints + stores. */
export function dbUriId(role: DbRole): SecretIdentityKey {
  return { provider: "atlas", accountLabel: `atlas-1/${atlasClusterName(role)}`, classification: "dbUri" };
}
/** The image store's api key / secret rows (→ imagePool.apiKeyRef / apiSecretRef). */
export function imageSecretId(store: ImageStore, kind: "apiKey" | "apiSecret"): SecretIdentityKey {
  return { provider: store, accountLabel: store === "r2" ? "r2-1" : "cloudinary-1", classification: kind };
}
/** App-level minted secrets that live in the Vercel deployment env. provider
 *  'vercel' groups them with the deployment; distinct accountLabels keep each
 *  one's AAD unique. Minted once (randomHex), identical across active+standby so
 *  JWT sessions survive failover. */
export type AppSecretKind = "auth" | "healthStats";
export function appSecretId(kind: AppSecretKind): SecretIdentityKey {
  return { provider: "vercel", accountLabel: `app-${kind}`, classification: "token" };
}

// ── Intake / config shapes (from the wizard; creds are vault-fed) ────────────
export type ImageStore = "cloudinary" | "r2";

export interface AtlasSaCreds {
  clientId: string;
  clientSecret: string;
  orgId: string;
}
export interface CloudinaryPaste {
  store: "cloudinary";
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}
export interface R2Paste {
  store: "r2";
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}
export type ImagePaste = CloudinaryPaste | R2Paste;

export interface PastedCreds {
  atlas: AtlasSaCreds;
  vercelActive: string;
  vercelStandby: string;
  image: ImagePaste;
}

export interface ProvisionIntake {
  slug: string;
  ownerEmail: string;
  businessType: "cafe" | "qsr" | "bar";
  branding?: { name?: string; tagline?: string; logoPublicId?: string; primaryColor?: string };
  idempotencyKey: string;
  /** PRESENT on first run + on an explicit re-paste (the wrong-paste heal);
   *  ABSENT on a plain resume (creds read from the vault). */
  creds?: PastedCreds;
}

export interface ProvisionConfig {
  /** The Cloudflare-owned platform domain (§6). REQUIRED — a cafe on a bare
   *  *.vercel.app host 404s every page (R2). */
  rootDomain: string;
  /** How host deploys reach the app repo (monorepo root = apps/cafe). */
  deploySource: {
    repoId: number | string;
    ref: string;
    /** GitHub "owner/repo" for createProject's git connection. */
    repo?: string;
    rootDirectory?: string;
  };
}

// ── Runtime env map (buildTenantEnv — R2 + R10 + IMAGE_STORE fix) ─────────────
/** The plaintext inputs buildTenantEnv needs — all revealed JIT from the vault by
 *  the host step, held only for the upsertEnv call. */
export interface TenantEnvInput {
  slug: string;
  rootDomain: string;
  /** The PRIMARY (core) cluster SRV — the runtime's CORE bootstrap. The ORDERS
   *  URI is NEVER an env var: the runtime reads it from the CORE clusterRegistry
   *  doc, which is what makes F3.8 hot-add "no redeploy" true. */
  coreSrv: string;
  authSecret: string;
  healthStatsToken: string;
  image:
    | { store: "cloudinary"; cloudName: string; apiKey: string; apiSecret: string }
    | { store: "r2"; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string };
}

const SENSITIVE = "sensitive" as const;
const PLAIN = "plain" as const;

/** Build the tenant runtime's Vercel env. Sensitive values (SRV, keys, secrets)
 *  are marked `sensitive`; non-secret selectors are `plain`. NEVER emits
 *  ATLAS_SA_* (§2 decision 4 forbids an org-scoped key in a tenant app) nor a
 *  ledger MONGODB_URI (the orders URI rides the CORE doc, not env). The image
 *  block MUST set IMAGE_STORE — the cafe silently defaults to 'r2' and 500s
 *  every upload for a Cloudinary tenant without it (the confirmed IMAGE_STORE gap). */
export function buildTenantEnv(input: TenantEnvInput): VercelEnvVar[] {
  const env: VercelEnvVar[] = [
    { key: "CORE_MONGODB_URI", value: input.coreSrv, type: SENSITIVE },
    // v1 fallback name (cluster-router reads CORE_MONGODB_URI ?? MONGODB_URI).
    { key: "MONGODB_URI", value: input.coreSrv, type: SENSITIVE },
    { key: "TENANT_ID", value: input.slug, type: PLAIN },
    { key: "ROOT_DOMAIN", value: input.rootDomain, type: PLAIN },
    { key: "HOSTING_TIER", value: "B", type: PLAIN },
    // Auth.js v5 reads AUTH_SECRET ?? NEXTAUTH_SECRET — set both to the one value.
    { key: "AUTH_SECRET", value: input.authSecret, type: SENSITIVE },
    { key: "NEXTAUTH_SECRET", value: input.authSecret, type: SENSITIVE },
    { key: "HEALTH_STATS_TOKEN", value: input.healthStatsToken, type: SENSITIVE },
    { key: "IMAGE_STORE", value: input.image.store, type: PLAIN },
  ];
  if (input.image.store === "cloudinary") {
    env.push(
      { key: "CLOUDINARY_CLOUD_NAME", value: input.image.cloudName, type: PLAIN },
      { key: "CLOUDINARY_API_KEY", value: input.image.apiKey, type: SENSITIVE },
      { key: "CLOUDINARY_API_SECRET", value: input.image.apiSecret, type: SENSITIVE },
      // Client-side, baked at BUILD time — must be set before deploy.
      { key: "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", value: input.image.cloudName, type: PLAIN },
    );
  } else {
    env.push(
      { key: "R2_ACCOUNT_ID", value: input.image.accountId, type: SENSITIVE },
      { key: "R2_ACCESS_KEY_ID", value: input.image.accessKeyId, type: SENSITIVE },
      { key: "R2_SECRET_ACCESS_KEY", value: input.image.secretAccessKey, type: SENSITIVE },
      { key: "R2_BUCKET", value: input.image.bucket, type: PLAIN },
      { key: "NEXT_PUBLIC_R2_PUBLIC_BASE_URL", value: input.image.publicBaseUrl, type: PLAIN },
    );
  }
  return env;
}

// ── Runtime clusterRegistry doc (R1 + R8 — the cross-app contract) ───────────
/** The runtime `clusterRegistry` singleton, re-declared from the shipped cafe
 *  contract (apps/cafe/lib/cluster-router.ts). A parity test pins these against
 *  the cafe source; drift silently misroutes day-one orders. */
export const CLUSTER_REGISTRY_ID = "cluster-registry";
export const CLUSTER_REGISTRY_COLLECTION = "clusterRegistry";
export const CORE_TAG = "C";

export interface RuntimeLedgerEntry {
  id: string;
  uri: string;
  tag: string;
  from: string | null;
  to: string | null;
  active: boolean;
}
export interface RuntimeClusterRegistryDoc {
  _id: string;
  core: { id: string; uri: string; tag: string };
  ledgers: RuntimeLedgerEntry[];
  standby: Array<{ id: string; uri: string; tag?: string; empty?: boolean }>;
}

/** Seal a URI for storage in the runtime doc. IDENTITY today (the cafe's
 *  decryptStoredUri is identity — plaintext is REQUIRED and correct now); the
 *  seam is where F3.8's per-tenant doc-crypto lands, matching the cafe's
 *  encryptUriForStore contract without importing across workspaces. */
export function sealDocUri(uri: string): string {
  return uri;
}

/** The day-one orders ledger entry (the single ACTIVE ledger; reads/writes of
 *  Orders route here, everything else to CORE). */
export function buildOrdersLedgerEntry(clusterName: string, ordersSrv: string): RuntimeLedgerEntry {
  return {
    id: clusterName,
    uri: sealDocUri(ordersSrv),
    tag: ORDERS_LEDGER_TAG,
    from: null,
    to: null,
    active: true,
  };
}

/** The informational `core` mirror (the router reads CORE from env, never this). */
export function buildCoreMirror(coreClusterName: string, coreSrv: string): RuntimeClusterRegistryDoc["core"] {
  return { id: coreClusterName, uri: sealDocUri(coreSrv), tag: CORE_TAG };
}

/** The full doc for the initial (absent-doc) insert. On resume the writer instead
 *  RECONCILES only the orders ledger's uri (R1), preserving F3.8 additions. */
export function buildClusterRegistryDoc(
  ordersEntry: RuntimeLedgerEntry,
  core: RuntimeClusterRegistryDoc["core"],
): RuntimeClusterRegistryDoc {
  return { _id: CLUSTER_REGISTRY_ID, core, ledgers: [ordersEntry], standby: [] };
}
