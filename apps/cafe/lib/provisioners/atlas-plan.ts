// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.8 — the PURE half of the Atlas Admin API provisioner (the
// ledger-scale-plan / report-merge split precedent): env-config parsing,
// deterministic resource naming, request bodies, SRV-string credential
// injection, and 429 Retry-After math. No IO here — `atlas.ts` owns HTTP,
// polling, and the registry push.
//
// Deterministic names are the RESUMABILITY key: every Atlas resource is named
// from the minted ledger tag, and the tag mint (`mintNextStandbyTag`, F2.7's
// single mint path) is stable while the registry doc is unchanged — so a re-run
// after a mid-flow crash re-derives the same names and ADOPTS the half-created
// resources (409 → fetch-existing) instead of leaking duplicates.
// ─────────────────────────────────────────────────────────────────────────────

/** Atlas Admin API v2 base + the pinned version header (phase-F2 §4 F2.8 —
 *  every /api/atlas/v2 request sends this exact Accept). */
export const ATLAS_BASE_URL = "https://cloud.mongodb.com";
export const ATLAS_VERSIONED_JSON = "application/vnd.atlas.2023-01-01+json";

/** M0 creation is minutes-scale: poll every 15s, give up after 60 polls (~15
 *  min). A timeout THROWS — the flow is resumable, the next nudge re-polls.
 *  (On Vercel the invoking function may die sooner; same resume story.) */
export const CLUSTER_POLL_INTERVAL_MS = 15_000;
export const CLUSTER_POLL_MAX_ATTEMPTS = 60;

/** 429 handling (spec: honor Retry-After): bounded retries, clamped waits. */
export const RATE_LIMIT_MAX_RETRIES = 4;
export const RETRY_AFTER_DEFAULT_MS = 2_000;
export const RETRY_AFTER_MAX_MS = 60_000;

/** Serverless egress has no stable IP (Vercel) — the documented M0 posture. */
export const OPEN_ACCESS_CIDR = "0.0.0.0/0";

/** Parse a 429 `Retry-After` header (delta-seconds or HTTP-date) into a wait in
 *  ms, clamped to [0, RETRY_AFTER_MAX_MS]; absent/garbage → the default. */
export function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null || header.trim() === "") return RETRY_AFTER_DEFAULT_MS;
  const clamp = (ms: number) => Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS);
  if (/^\d+$/.test(header.trim())) return clamp(Number(header.trim()) * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? RETRY_AFTER_DEFAULT_MS : clamp(at - nowMs);
}

// ── The provisioner's result contract (consumed via `atlas.ts` re-exports) ────
export type EnsureStandbyStatus =
  | "pushed" // provisioned + armed: one warm empty standby now in the registry
  | "already-armed" // a standby is already warm — idempotent no-op
  | "raced" // CAS lost to a concurrent manifest writer (orphan logged)
  | "no-registry-doc" // bootstrap era — F3's paste-and-Connect creates the doc
  | "not-configured"; // no Service-Account env — manual flow stays primary

export interface EnsureStandbyResult {
  status: EnsureStandbyStatus;
  /** Pre-minted ledger tag / non-secret Atlas names, for the Hub surface. */
  tag?: string;
  projectId?: string;
  clusterName?: string;
}

// ── Config (per-cafe env — ONE Atlas org per cafe, §2.8/§2.12) ────────────────
export interface AtlasProvisionerConfig {
  /** OAuth2 Service Account client credentials (client-credentials grant).
   *  Least privilege = Org Project Creator (it must create projects; the
   *  creator becomes Project Owner of what it creates) — NEVER Org Owner. */
  clientId: string;
  clientSecret: string;
  orgId: string;
  region: string;
  backingProvider: string;
  /** Database segment of the pushed SRV URI (v1's env URI convention: `/pos`). */
  ledgerDb: string;
  /** Project-name prefix; defaults to the Tier-B TENANT_ID. */
  projectPrefix: string;
}

/** Read the provisioner config lazily from env (the `coreBootstrapUri` lazy
 *  pattern — importing this module must never crash a build with env unset).
 *  Returns null when the Service Account creds/org are absent: the manual
 *  paste-and-Connect prompt stays the default growth flow (F2 §2.12). */
export function atlasConfigFromEnv(): AtlasProvisionerConfig | null {
  const clientId = process.env.ATLAS_SA_CLIENT_ID;
  const clientSecret = process.env.ATLAS_SA_CLIENT_SECRET;
  const orgId = process.env.ATLAS_ORG_ID;
  if (!clientId || !clientSecret || !orgId) return null;
  return {
    clientId,
    clientSecret,
    orgId,
    region: process.env.ATLAS_REGION ?? "AP_SOUTH_1",
    backingProvider: process.env.ATLAS_BACKING_PROVIDER ?? "AWS",
    ledgerDb: process.env.ATLAS_LEDGER_DB ?? "pos",
    projectPrefix:
      process.env.ATLAS_PROJECT_PREFIX ?? process.env.TENANT_ID ?? "pos",
  };
}

// ── Deterministic resource names (keyed by the minted tag) ────────────────────
export function projectNameFor(cfg: AtlasProvisionerConfig, tag: string): string {
  return `${cfg.projectPrefix}-ledger-${tag.toLowerCase()}`;
}
export function clusterNameFor(tag: string): string {
  return `ledger-${tag.toLowerCase()}`;
}
export function dbUsernameFor(tag: string): string {
  return `ledger_${tag.toLowerCase()}`;
}

// ── Request bodies (pinned by fed-api-automation-boundary.json / §2.8) ────────
/** POST /groups — create the project that will hold exactly one free M0. */
export function createProjectBody(
  cfg: AtlasProvisionerConfig,
  name: string,
): Record<string, unknown> {
  return { name, orgId: cfg.orgId };
}

/** POST /groups/{id}/clusters — the M0 shape: `providerName: 'TENANT'` +
 *  `electableSpecs.instanceSize: 'M0'` (an M2/M5 size would create a PAID Flex
 *  cluster — M0 is the only free instanceSize). */
export function createClusterBody(
  cfg: AtlasProvisionerConfig,
  name: string,
): Record<string, unknown> {
  return {
    name,
    clusterType: "REPLICASET",
    replicationSpecs: [
      {
        regionConfigs: [
          {
            providerName: "TENANT",
            backingProviderName: cfg.backingProvider,
            regionName: cfg.region,
            priority: 7,
            electableSpecs: { instanceSize: "M0" },
          },
        ],
      },
    ],
  };
}

/** POST /groups/{id}/databaseUsers — scoped `readWrite` on the ledger db only
 *  (auth source `admin`), mirroring the spec's least-privilege posture. */
export function createUserBody(
  cfg: AtlasProvisionerConfig,
  username: string,
  password: string,
): Record<string, unknown> {
  return {
    databaseName: "admin",
    username,
    password,
    roles: [{ roleName: "readWrite", databaseName: cfg.ledgerDb }],
  };
}

/** POST /groups/{id}/accessList — the body is an ARRAY of entries. */
export function accessListBody(): Record<string, unknown>[] {
  return [
    { cidrBlock: OPEN_ACCESS_CIDR, comment: "pos federation — serverless egress" },
  ];
}

// ── SRV credential injection ──────────────────────────────────────────────────
/** Inject user/pass + the ledger db into the cluster's bare `standardSrv`
 *  string (`mongodb+srv://host`), matching the env-URI convention
 *  (`/pos?retryWrites=true&w=majority`). Credentials are URL-encoded. */
export function buildLedgerUri(
  standardSrv: string,
  username: string,
  password: string,
  dbName: string,
): string {
  const m = /^mongodb\+srv:\/\/([^/?@]+)\/?$/.exec(standardSrv.trim());
  if (!m) {
    // Never echo the string back (defense against a cred-bearing SRV leaking
    // into logs) — the shape is all a diagnostic needs.
    throw new Error(
      "[atlas-provisioner] unexpected standardSrv shape (want mongodb+srv://<host>)",
    );
  }
  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  return `mongodb+srv://${user}:${pass}@${m[1]}/${dbName}?retryWrites=true&w=majority`;
}
