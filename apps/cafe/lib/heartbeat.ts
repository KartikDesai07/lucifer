import { createHash, timingSafeEqual } from "node:crypto";

import type {
  HeartbeatCluster,
  HeartbeatImageUsage,
  HeartbeatPayload,
} from "@pos/shared/heartbeat";
import { type ClusterRef } from "@/lib/cluster-registry";
import {
  core,
  decryptStoredUri,
  type StoredClusterRegistry,
} from "@/lib/cluster-router";
import { rawDbOf, readDbFillStats, readStoredRegistryDoc } from "@/lib/registry-io";
import {
  roundedFillPct,
  type LedgerFillStats,
} from "@/lib/ledger-scale-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.9 — the runtime heartbeat SOURCE: gauge every cluster this cafe
// owns (CORE + all ledgers + standby) via `db.stats()` and assemble the shared
// `HeartbeatPayload` (`@pos/shared/heartbeat`) that `/api/health?stats=1`
// serves. Delivery is PULL, never push (#26 — the runtime has no scheduler):
// F3's always-on Cloudflare Worker polls the endpoint and forwards the body to
// the Hub ingest (F3 §3.3/§3.7); the F2.9 sketch's "POST to the Hub" is that
// Worker leg, not a cafe-side call. The per-cluster `db.stats()` touch also
// makes the Worker poll double as the keep-alive — which is what supersedes
// `.github/workflows/db-keepalive.yml` once F3 deploys the Worker.
//
// The F2.7 caveat is enforced AT THE SOURCE: raw driver error strings
// (`statsError`) are admin-only surface — a failed probe becomes `state:
// "error"` (logged server-side), NEVER a message in the payload, because this
// payload crosses an unauthenticated-by-default endpoint and a third-party
// Worker.
//
// Seams (the F2.7/F2.8 per-module precedent): `__setHeartbeatDepsForTests`
// (registry-doc read + the two probes) and a probe-timeout override, so the
// assembly logic is provable DB-free; the live gauge rides the seeded-M0 F2
// integration pass.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-cluster probe budget — same rationale as F2.6/F2.7: a hung dial would
 *  ride `serverSelectionTimeoutMS` (5s); the stats leg must stay far inside
 *  the locked ≤8s route rule (probes run in parallel, so the whole heartbeat
 *  is bounded by ONE probe budget, not their sum). */
export const HEARTBEAT_PROBE_TIMEOUT_MS = 4_000;

// ── Injectable DB collaborators ───────────────────────────────────────────────
interface HeartbeatDeps {
  readRegistryDoc: () => Promise<StoredClusterRegistry | null>;
  readStats: (ref: ClusterRef) => Promise<LedgerFillStats>;
  /** Best-effort `serverStatus.connections.current`. Throws/`undefined` are
   *  both fine — the F2.8-provisioned `readWrite` users lack the privilege. */
  readConns: (ref: ClusterRef) => Promise<number | undefined>;
  /** F3.7 — the §3.3 `imageUsage` leg: Cloudinary `GET /usage` via the admin
   *  API, as FRACTIONS (0..1). `null` = nothing to gauge (R2 tenants — no free
   *  usage API — or Cloudinary env unset). Throws/timeouts degrade to omission. */
  readImageUsage: () => Promise<HeartbeatImageUsage | null>;
}

/** Map a Cloudinary `GET /usage` response onto the shared fractions. Free plan
 *  meters CREDITS only (`credits.used_percent`); per-metric `used_percent`
 *  exists on paid plans (the F3.5 research, both shapes live-probed). A
 *  percent-less response yields null — an honest omission, never a fake 0. */
export function imageUsageFromCloudinary(res: unknown): HeartbeatImageUsage | null {
  const r = res as {
    credits?: { used_percent?: unknown };
    storage?: { used_percent?: unknown };
    bandwidth?: { used_percent?: unknown };
  };
  const pct = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 10_000 : undefined;
  };
  const out: HeartbeatImageUsage = {
    ...(pct(r?.credits?.used_percent) === undefined ? {} : { creditsPct: pct(r.credits!.used_percent) }),
    ...(pct(r?.storage?.used_percent) === undefined ? {} : { storagePct: pct(r.storage!.used_percent) }),
    ...(pct(r?.bandwidth?.used_percent) === undefined ? {} : { bandwidthPct: pct(r.bandwidth!.used_percent) }),
  };
  return Object.keys(out).length > 0 ? out : null;
}

const realDeps: HeartbeatDeps = {
  readRegistryDoc: readStoredRegistryDoc,
  readStats: readDbFillStats,
  readConns: async (ref) => {
    const res = (await (await rawDbOf(ref)).command({ serverStatus: 1 })) as {
      connections?: { current?: unknown };
    };
    const current = Number(res.connections?.current);
    return Number.isFinite(current) && current >= 0 ? current : undefined;
  },
  readImageUsage: async () => {
    // Only a Cloudinary tenant has a meter to read (IMAGE_STORE default is r2).
    if ((process.env.IMAGE_STORE ?? "r2") !== "cloudinary") return null;
    if (!process.env.CLOUDINARY_API_SECRET) return null;
    // Lazy import — the plain /api/health path must never pay the SDK load.
    const { default: cloudinary } = await import("@/lib/cloudinary");
    return imageUsageFromCloudinary(await cloudinary.api.usage());
  },
};
let deps: HeartbeatDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores. */
export function __setHeartbeatDepsForTests(
  overrides: Partial<HeartbeatDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

let probeTimeoutMs = HEARTBEAT_PROBE_TIMEOUT_MS;
/** TEST SEAM — shrink the probe timeout so hang tests run in ms; `null` restores. */
export function __setHeartbeatProbeTimeoutForTests(ms: number | null): void {
  probeTimeoutMs = ms ?? HEARTBEAT_PROBE_TIMEOUT_MS;
}

async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bomb = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[heartbeat] ${label} timed out after ${probeTimeoutMs}ms`));
    }, probeTimeoutMs);
  });
  try {
    return await Promise.race([p, bomb]);
  } finally {
    clearTimeout(timer);
  }
}

// ── Row assembly ──────────────────────────────────────────────────────────────
type RowBase = Omit<HeartbeatCluster, "state" | "usedPct" | "dataSize" | "indexSize" | "conns">;

/** Every cluster this cafe owns, as (payload row base, dialable ref) pairs.
 *  CORE is env-authoritative (its URI never passes the doc decryptor — the
 *  F2.7 discipline); doc URIs dial via the single-homed vault seam. */
function enumerate(doc: StoredClusterRegistry | null): Array<{
  base: RowBase;
  ref: ClusterRef;
}> {
  const c = core();
  const out: Array<{ base: RowBase; ref: ClusterRef }> = [
    { base: { name: c.id, tag: c.tag, role: "core" }, ref: c },
  ];
  if (!doc) return out; // bootstrap: CORE doubles as the one ledger (F2.2)
  for (const l of doc.ledgers) {
    out.push({
      base: {
        name: l.id,
        tag: l.tag,
        role: "ledger",
        active: l.active === true,
        ...(l.paused === undefined ? {} : { paused: l.paused === true }),
      },
      ref: { id: l.id, uri: decryptStoredUri(l.uri) },
    });
  }
  for (const s of doc.standby ?? []) {
    out.push({
      base: { name: s.id, ...(s.tag === undefined ? {} : { tag: s.tag }), role: "standby" },
      ref: { id: s.id, uri: decryptStoredUri(s.uri) },
    });
  }
  return out;
}

async function gaugeRow(base: RowBase, ref: ClusterRef): Promise<HeartbeatCluster> {
  // Both probes race the same budget IN PARALLEL (sequential probes would sum
  // to 8s on a dead cluster and breach the route rule).
  const [stats, conns] = await Promise.all([
    withTimeout(deps.readStats(ref), `stats ${ref.id}`).then(
      (s) => ({ ok: true as const, s }),
      (err) => {
        // Logged for the operator; the payload carries only `state` (F2.7 caveat).
        console.error(`[heartbeat] db.stats failed on ${ref.id}:`, err);
        return { ok: false as const };
      },
    ),
    withTimeout(deps.readConns(ref), `conns ${ref.id}`).catch(() => undefined),
  ]);
  if (!stats.ok) {
    return { ...base, state: "error", ...(conns === undefined ? {} : { conns }) };
  }
  return {
    ...base,
    state: "ok",
    usedPct: roundedFillPct(stats.s),
    dataSize: stats.s.dataSize,
    indexSize: stats.s.indexSize,
    ...(conns === undefined ? {} : { conns }),
  };
}

/** Gauge every cluster and assemble the shared heartbeat payload. A registry
 *  READ ERROR propagates (the #19 discipline: error ≠ absent — a bootstrap-
 *  shaped heartbeat off a failed read would tell the Hub a multi-cluster cafe
 *  is single-cluster); the caller (`/api/health`) degrades it honestly. The
 *  read carries the same probe budget as the gauges — a hung CORE dial would
 *  otherwise ride `serverSelectionTimeoutMS` and stack onto the probe budget,
 *  pushing the stats leg past the ≤8s route rule. */
export async function buildHeartbeat(): Promise<HeartbeatPayload> {
  const doc = await withTimeout(deps.readRegistryDoc(), "registry read");
  const rows = enumerate(doc);
  // The image-usage probe rides the SAME parallel wave + budget as the cluster
  // gauges; its failure degrades to omission (never a fake 0, never a stats
  // error) — the F2.7 caveat: raw provider errors stay server-side.
  const [clusters, imageUsage] = await Promise.all([
    Promise.all(rows.map(({ base, ref }) => gaugeRow(base, ref))),
    withTimeout(deps.readImageUsage(), "image usage").catch((err) => {
      console.error("[heartbeat] image usage probe failed:", err);
      return null;
    }),
  ]);
  return {
    tenant: process.env.TENANT_ID ?? "dev",
    at: new Date().toISOString(),
    ...(doc ? {} : { bootstrap: true }),
    clusters,
    ...(imageUsage ? { imageUsage } : {}),
  };
}

// ── Stats-token gate (used by /api/health) ────────────────────────────────────
/** Constant-time match of the presented stats token against the configured
 *  one. No token configured → open (the bootstrap/dev default; F3 sets
 *  `HEALTH_STATS_TOKEN` and hands it to the Worker). Hashing first makes
 *  `timingSafeEqual` length-safe. */
export function statsTokenMatches(
  presented: string | null | undefined,
  required: string | undefined,
): boolean {
  if (!required) return true;
  const a = createHash("sha256").update(presented ?? "").digest();
  const b = createHash("sha256").update(required).digest();
  return timingSafeEqual(a, b);
}
