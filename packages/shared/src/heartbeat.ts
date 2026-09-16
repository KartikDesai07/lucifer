// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.9 + F3 Step F3.7 — the heartbeat CONTRACT, single-homed here (#31)
// because two apps must agree on it and neither may import the other:
//   • the cafe runtime EMITS it — `apps/cafe/lib/heartbeat.ts` gauges every
//     cluster (+ Cloudinary usage, F3.7) and `/api/health?stats=1` serves it;
//   • the Hub INGESTS it — F3.7's `/api/ingest/heartbeat` stores docs on the
//     TTL'd `heartbeats` collection and trips ADD_DB_CLUSTER at ≥75% `usedPct`.
// The runtime never POSTs (#26 — it has no scheduler): the always-on Cloudflare
// failover Worker polls `/api/health?stats=1` per tenant and forwards the body
// (HMAC-signed, the `HeartbeatIngest` envelope below) to the Hub — F3 §3.3.
// That poll's per-cluster `db.stats()` touch is also what supersedes the F2.9
// keep-alive workflow (F2 §4 Step F2.9) once the Worker deploys.
//
// The Worker CANNOT import this package (workers/failover sits outside the npm
// workspace) — it mirrors the header/scheme literals below, and a Hub parity
// test (apps/hub/lib/heartbeat-hmac.test.ts) reads the Worker source and pins
// them so the mirror can never silently drift.
//
// Field names follow the F3 §3.3/§3.7 ingest contract (`name`/`usedPct`/
// `state`); the F2 §4 F2.9 sketch's `clusterId`/`fillPct` map onto them.
// ─────────────────────────────────────────────────────────────────────────────

/** Hub-side collection the F3.7 ingest writes heartbeats to. */
export const HEARTBEATS_COLLECTION = "heartbeats";

/** Retention window — heartbeats are ephemeral gauge samples, never audit data
 *  (TTL-ALLOWED; contrast the TTL-FORBIDDEN financial ledgers, build-rule #23). */
export const HEARTBEAT_TTL_SECONDS = 7 * 86_400;

/** The single-field TTL date index (F2 §4 F2.9 / F3 §3.4) the Hub creates on
 *  `heartbeats`: `ts` is the Hub-stamped ingest `Date` (never the tenant's
 *  clock — a skewed tenant clock must not shorten/extend retention). */
export const HEARTBEAT_TTL_INDEX = {
  key: { ts: 1 },
  expireAfterSeconds: HEARTBEAT_TTL_SECONDS,
} as const;

/** `ok` = `db.stats()` answered with usable numbers; `error` = unreachable,
 *  timed out, or garbage stats. Deliberately NO raw driver message here: the
 *  F2.7 caveat — `statsError` strings are admin-only surface, and this payload
 *  crosses an unauthenticated-by-default endpoint and a third-party Worker. */
export type HeartbeatClusterState = "ok" | "error";

export interface HeartbeatCluster {
  /** Registry entry id (`core`, or the ledger/standby cluster id). */
  name: string;
  /** Ledger tag (`C` for CORE). Absent on a tagless manually-pasted standby. */
  tag?: string;
  role: "core" | "ledger" | "standby";
  /** Ledger role only: is this the single active write ledger? */
  active?: boolean;
  state: HeartbeatClusterState;
  /** The conservative fill gauge (F2c §2): `(dataSize + indexSize) / 512MB`,
   *  rounded to 4 dp — NEVER `dataSize` alone. The Hub trips at ≥ 0.75. */
  usedPct?: number;
  /** Raw `db.stats()` bytes backing `usedPct`, for the Hub's health view. */
  dataSize?: number;
  indexSize?: number;
  /** `serverStatus.connections.current` — omitted when the DB user lacks the
   *  privilege (F2.8-provisioned users are `readWrite`-only) or the probe fails. */
  conns?: number;
  /** Pass-through of the registry manifest's `paused` flag (Hub/Atlas-API
   *  truth is F3's); omitted when the manifest carries none. */
  paused?: boolean;
}

/** Image-store fill gauges as FRACTIONS (0..1, same convention as `usedPct` —
 *  Cloudinary's `used_percent` is /100 at the emitter). Free-plan Cloudinary
 *  meters CREDITS only (per-metric percentages exist on paid plans alone), so
 *  `creditsPct` is the field that actually moves on the ₹0 stack; the Hub trips
 *  ADD_CLOUD when ANY of the three reaches ≥75% (F3 §3.7). R2 tenants emit
 *  nothing — R2's free 10GB has no usage API to gauge (the honest boundary). */
export interface HeartbeatImageUsage {
  storagePct?: number;
  bandwidthPct?: number;
  creditsPct?: number;
}

export interface HeartbeatPayload {
  tenant: string;
  /** Emitter timestamp (ISO). Informational — the Hub stamps its own `ts`. */
  at: string;
  /** True = no registry doc yet (single-cluster era): CORE doubles as the one
   *  ledger, so the lone `core` row's fill IS the order-ledger fill. */
  bootstrap?: boolean;
  clusters: HeartbeatCluster[];
  /** Cloudinary-tenant usage (F3.7 — the §3.3 `imageUsage` leg); absent on R2
   *  tenants and when the usage probe fails (probe errors never degrade stats). */
  imageUsage?: HeartbeatImageUsage;
}

// ─────────────────────────────────────────────────────────────────────────────
// F3.7 — the Worker→Hub ingest ENVELOPE + HMAC scheme. The Worker polls
// `/api/health?stats=1` per tenant, wraps what came back (or didn't) in this
// envelope, signs it, and POSTs it to the Hub `/api/ingest/heartbeat`.
// ─────────────────────────────────────────────────────────────────────────────

/** Header carrying the lowercase-hex HMAC-SHA256 signature. */
export const INGEST_SIG_HEADER = "x-ingest-signature";
/** Header carrying the signer's unix-SECONDS timestamp (decimal string). */
export const INGEST_TS_HEADER = "x-ingest-ts";
/** Replay tolerance: the Hub rejects |now − ts| > this many seconds. */
export const INGEST_TS_TOLERANCE_S = 300;

/** The signed message is `${ts}.${rawBody}` — binding the timestamp into the
 *  signature so a captured request cannot be replayed with a fresh header. Key
 *  = the platform-wide `HUB_INGEST_SECRET` (Hub env + a Worker secret); the
 *  Worker is ONE trusted platform component, so per-tenant keys would add vault
 *  round-trips it cannot make while the tenant identity already rides the
 *  signed body. Verification is fail-closed: no secret configured ⇒ 503. */
export function ingestMessageToSign(tsSeconds: string, rawBody: string): string {
  return `${tsSeconds}.${rawBody}`;
}

/** The stats-leg outcome the Worker observed on `/api/health?stats=1`:
 *  `ok` = a `clusters` block came back; `denied` = the health body's own
 *  wrong/unset-stats-token flag; `error` = the stats leg was unusable while
 *  the host was ALIVE (the body's own error flag, or the Worker's stats fetch
 *  timed out/failed and the plain liveness probe still passed). Absent when
 *  the host itself was unreachable. Persisted so a mis-seeded stats token or a
 *  chronically slow stats leg is VISIBLE at the Hub instead of silently
 *  disabling fill monitoring. */
export type HeartbeatStatsState = "ok" | "denied" | "error";

/** The Worker→Hub ingest body (F3 §3.7 `{tenant, clusters, imageUsage, hostOk}`).
 *  `tenant` is the Worker's KV key for this tenant — BY CONTRACT the Tenant
 *  slug (the provisioner seeds the KV keyed by slug; `TENANT_ID` env = slug,
 *  so the runtime's self-report agrees by construction). */
export interface HeartbeatIngest {
  tenant: string;
  /** This forward's health verdict on the CURRENTLY-SERVED origin. */
  hostOk: boolean;
  /** The Worker's forward time (ISO, its own clock — the health body carries no
   *  emitter `at`). Informational; the Hub stamps its own `ts` at ingest. */
  at: string;
  /** Which origin the Worker is serving right now. `standby` = it has ALREADY
   *  swapped (F1.7's origin flip) — the Hub enqueues FAILOVER bookkeeping
   *  (F3.10: registry role swap + alert) off this, not off ping-counting. */
  servedOrigin?: "active" | "standby";
  stats?: HeartbeatStatsState;
  bootstrap?: boolean;
  /** Absent when the host was unreachable or the stats leg was denied/errored. */
  clusters?: HeartbeatCluster[];
  imageUsage?: HeartbeatImageUsage;
}
