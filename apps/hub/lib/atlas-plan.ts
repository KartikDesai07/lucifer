// ─────────────────────────────────────────────────────────────────────────────
// F3.5 — the PURE half of the Hub's Atlas Admin API client (the cafe's
// atlas-plan/atlas split precedent, apps/cafe/lib/provisioners/atlas-plan.ts):
// protocol constants, request bodies, and SRV credential injection. No IO here
// — lib/atlas.ts owns HTTP, the token cache, and polling.
//
// Differences from the cafe's plan module (deliberate):
//  - NO env-derived config: the Hub acts with each tenant's PASTED Service-
//    Account credentials, pulled from the vault by the F3.6 provisioner and
//    passed in per client — one Hub manages many Atlas accounts (§2 dec. 4/8).
//  - NO tag-derived resource names: deterministic per-tenant naming is the
//    F3.6 state machine's resumability key, so names arrive as parameters.
// The SA must be an ORG-scoped *Project Creator* — NEVER Org Owner (§2 dec. 4).
// ─────────────────────────────────────────────────────────────────────────────

import { RATE_LIMIT_MAX_RETRIES, RETRY_AFTER_MAX_MS } from "@/lib/provider-retry";

/** Atlas Admin API v2 base. Resource versions are pinned PER OPERATION (the
 *  July-2026 spec, re-verified against the vendor OpenAPI): groups / byName /
 *  databaseUsers / accessList are still CURRENT on 2023-01-01, but the
 *  clusters resource deprecated it (sunset 2027-07-01) — new code pins
 *  2024-10-23 for cluster writes and 2024-08-05 for cluster reads (the GET's
 *  newest media type). The cafe's F2.8 client predates this and still sends a
 *  single 2023-01-01 pin — fine until 2027, deliberately not refactored here. */
export const ATLAS_BASE_URL = "https://cloud.mongodb.com";
export const ATLAS_VERSION_CORE = "2023-01-01";
export const ATLAS_VERSION_CLUSTER_WRITE = "2024-10-23";
export const ATLAS_VERSION_CLUSTER_READ = "2024-08-05";
export function atlasMediaType(version: string): string {
  return `application/vnd.atlas.${version}+json`;
}

/** OAuth2 client-credentials grant (unversioned endpoint, Basic auth). Tokens
 *  live 3600s; refresh with slack so a token can never expire MID-request —
 *  "refresh fires before 3600s expiry" is a verify leg of this step. The slack
 *  must cover the WORST-CASE lifetime of one request, and a single request can
 *  legally stall RATE_LIMIT_MAX_RETRIES × RETRY_AFTER_MAX_MS (4 × 60s) in
 *  stacked 429 waits re-sending the SAME bearer (F3.5 review finding) — so:
 *  60s base margin + 240s of stacked waits = 300s. A token still serves ~55 of
 *  its 60 minutes. */
export const ATLAS_TOKEN_PATH = "/api/oauth/token";
export const TOKEN_TTL_FALLBACK_SECONDS = 3_600;
export const TOKEN_REFRESH_SLACK_MS =
  60_000 + RATE_LIMIT_MAX_RETRIES * RETRY_AFTER_MAX_MS;

/** M0 creation is minutes-scale: poll every 15s, give up after 60 polls (~15
 *  min). A timeout THROWS — the F3.6 machine persists its step and resumes. */
export const CLUSTER_POLL_INTERVAL_MS = 15_000;
export const CLUSTER_POLL_MAX_ATTEMPTS = 60;

/** Serverless egress has no stable IP (Vercel) — the documented M0 posture. */
export const OPEN_ACCESS_CIDR = "0.0.0.0/0";

// ── Inputs (from the vault / the F3.6 provisioner — never from Hub env) ──────
/** One tenant's Atlas Service-Account credentials + target org. */
export interface AtlasCredentials {
  clientId: string;
  clientSecret: string;
  orgId: string;
}

/** Where the M0 lands. Defaults mirror the cafe deployment (Mumbai on AWS). */
export interface AtlasClusterSpec {
  region: string;
  backingProvider: string;
}
export const DEFAULT_CLUSTER_SPEC: AtlasClusterSpec = {
  region: "AP_SOUTH_1",
  backingProvider: "AWS",
};

/** The scoped DB user the provisioner mints for one cluster. */
export interface DbUserSpec {
  username: string;
  password: string;
  /** The app database the user may readWrite (v1's `/pos` URI convention). */
  dbName: string;
}

// ── Response views ────────────────────────────────────────────────────────────
export interface ClusterView {
  id?: string;
  stateName?: string;
  connectionStrings?: { standardSrv?: string };
}

// ── Request bodies (pinned by fed-api-automation-boundary.json findings) ─────
/** POST /groups — create the project that will hold exactly one free M0. */
export function createProjectBody(orgId: string, name: string): Record<string, unknown> {
  return { name, orgId };
}

/** POST /groups/{id}/clusters — the M0 shape: `providerName: 'TENANT'` +
 *  `electableSpecs.instanceSize: 'M0'` (an M2/M5 size would create a PAID Flex
 *  cluster — M0 is the only free instanceSize). Create-or-leave: a free
 *  cluster can be CREATED but never MODIFIED via this API (§2 decision 7). */
export function createClusterBody(
  spec: AtlasClusterSpec,
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
            backingProviderName: spec.backingProvider,
            regionName: spec.region,
            priority: 7,
            electableSpecs: { instanceSize: "M0" },
          },
        ],
      },
    ],
  };
}

/** POST /groups/{id}/databaseUsers — scoped `readWrite` on the app db only
 *  (auth source `admin`), the spec's least-privilege posture. */
export function createUserBody(user: DbUserSpec): Record<string, unknown> {
  return {
    databaseName: "admin",
    username: user.username,
    password: user.password,
    roles: [{ roleName: "readWrite", databaseName: user.dbName }],
  };
}

/** POST /groups/{id}/accessList — the body is an ARRAY of entries. */
export function accessListBody(): Record<string, unknown>[] {
  return [
    { cidrBlock: OPEN_ACCESS_CIDR, comment: "pos federation — serverless egress" },
  ];
}

// ── SRV credential injection ──────────────────────────────────────────────────
/** Inject user/pass + the app db into the cluster's bare `standardSrv` string
 *  (`mongodb+srv://host`), matching the env-URI convention
 *  (`/pos?retryWrites=true&w=majority`). Credentials are URL-encoded. */
export function buildSrvUri(standardSrv: string, user: DbUserSpec): string {
  const m = /^mongodb\+srv:\/\/([^/?@]+)\/?$/.exec(standardSrv.trim());
  if (!m) {
    // Never echo the string back (defense against a cred-bearing SRV leaking
    // into logs) — the shape is all a diagnostic needs.
    throw new Error("[hub-atlas] unexpected standardSrv shape (want mongodb+srv://<host>)");
  }
  const username = encodeURIComponent(user.username);
  const password = encodeURIComponent(user.password);
  return `mongodb+srv://${username}:${password}@${m[1]}/${user.dbName}?retryWrites=true&w=majority`;
}
