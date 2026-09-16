/// <reference types="@cloudflare/workers-types" />
//
// Failover controller Worker (F1.7) — CONTROLLER-ONLY skeleton.
//
// Polls each tenant's /api/health and, on sustained failure, swaps the tenant's
// Cloudflare-PROXIED DNS record to the warm-standby origin (and fails back when the
// active recovers). This is the ONE canonical failover mechanism (PLATFORM.md §4 /
// build-rule #25). It is the only #26-legal always-on periodic-compute trigger in
// the whole system (no cafe Vercel cron); P13-PUSH later rides this same cron.
//
// CRITICAL — controller-only (PLATFORM.md §4): a cron health-check + origin swap,
// dozens of invocations/day. NEVER a per-request reverse proxy (that would blow the
// free 100K-req/day cap on a busy cafe and make the Worker a SPOF that dies at the
// 00:00 UTC reset). Steady-state traffic rides the proxied DNS path with ZERO
// per-request Worker cost.
//
// Both Vercel deployments are addressed by their BARE *.vercel.app origins (no
// Vercel custom-domain attach on either) → no SSL re-issue window, no "domain linked
// to another account" conflict. Open spike before production wiring (PLATFORM.md §4):
// confirm a CF-proxied hostname → bare *.vercel.app origin serves without
// host-header/SNI/SSL errors (Vercel may need a Host rewrite at the edge).
//
// F1 ships the algorithm + KV shape only. F3's provisioner creates the KV namespace,
// seeds one TenantFailoverState per tenant, and sets the CF_API_TOKEN secret.
// `wrangler` + `@cloudflare/workers-types` are added in F3 (this dir is outside the
// npm workspace and is NOT part of any Next build).

export interface TenantFailoverState {
  zoneId: string; // Cloudflare zone holding the tenant's proxied hostname
  recordId: string; // the proxied DNS record to PATCH (the failover mechanism)
  activeOrigin: string; // bare https://<active>.vercel.app
  standbyOrigin: string; // bare https://<standby>.vercel.app
  current: string; // currently-served origin (activeOrigin | standbyOrigin)
  failCount: number; // consecutive current-origin failures
  recoverCount: number; // consecutive active-origin successes while on standby
  // ── F3.7 heartbeat forwarding (the F2.9 "parked Worker-poll", absorbed) ──
  statsToken?: string; // the tenant's HEALTH_STATS_TOKEN (x-stats-token on ?stats=1)
  lastStatsForwardAt?: number; // unix ms of the last Hub forward (15-min gate)
}

export interface Env {
  FAILOVER_STATE: KVNamespace; // key = TENANT SLUG → JSON TenantFailoverState
  // (the KV key IS Tenant.slug BY CONTRACT — the Hub ingest resolves the
  // forwarded `tenant` field by slug, and the runtime's TENANT_ID env is the
  // slug too, so all three parties agree; the provisioner seeds the KV.)
  CF_API_TOKEN: string; // scoped: edit ONLY the proxied DNS record
  HUB_NOTIFY_URL?: string; // optional: ping the Hub panel on a swap
  HUB_INGEST_URL?: string; // the Hub's /api/ingest/heartbeat (F3.7)
  HUB_INGEST_SECRET?: string; // HMAC key shared with the Hub (wrangler secret)
}

const N_FAIL = 3; // flip active→standby after this many consecutive misses
const M_RECOVER = 5; // flip back only after this many consecutive recoveries (no flap)
const HEALTH_TIMEOUT_MS = 4000;

// ── F3.7 heartbeat forward (mirrors @pos/shared/heartbeat — this dir sits
// outside the npm workspace and CANNOT import it; the Hub parity test
// apps/hub/lib/heartbeat-hmac.test.ts reads THIS source and pins the literals,
// so the mirror can never silently drift). Scheme: lowercase-hex
// HMAC-SHA256(HUB_INGEST_SECRET, `${ts}.${rawBody}`), ts = unix SECONDS. ──
const INGEST_SIG_HEADER = "x-ingest-signature";
const INGEST_TS_HEADER = "x-ingest-ts";
// Forward every ~15 min (the §3.3 cadence) — NOT every 1-min cron tick: the
// heartbeats collection is TTL-bounded by age, so the forward rate is what
// bounds its size. The per-cluster db.stats() touch of each forward is also
// the keep-alive that supersedes .github/workflows/db-keepalive.yml once this
// Worker deploys (delete the workflow then — its in-file note says the same).
const STATS_FORWARD_INTERVAL_MS = 15 * 60 * 1000;
// The ?stats=1 leg legally takes up to ~8s (the cafe's route budget: parallel
// 4s cluster probes + overhead) — it gets its OWN timeout, NOT the 4s liveness
// budget: gauging hostOk off a 4s-capped stats fetch marked slow-but-healthy
// origins dead and could raise a spurious dual-outage FAILOVER (review fix).
const STATS_TIMEOUT_MS = 10_000;
// The Hub POST is bounded too — an unresponsive Hub must cost at most this.
const HUB_POST_TIMEOUT_MS = 5_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What /api/health?stats=1 answers with (the F2.9 fold-in shape). */
interface HealthStatsBody {
  ok?: boolean;
  db?: string;
  stats?: "denied" | "error";
  bootstrap?: boolean;
  clusters?: unknown[];
  imageUsage?: Record<string, number>;
}

/**
 * Poll the served origin's ?stats=1 and forward the signed envelope to the Hub
 * ingest. Runs AFTER the origin-swap duty (see pollTenant) with every fetch
 * bounded (stats 10s · hostOk fallback 4s · Hub POST 5s), so a slow origin or
 * a hanging Hub can never stall a failover (review fix — the earlier shape
 * awaited an unbounded POST before the liveness poll). If the stats fetch
 * itself fails, hostOk falls back to the cheap PLAIN health probe — liveness
 * must never be gauged off the heavy stats leg. Non-2xx ingest responses are
 * logged (a persistent 404 = mis-seeded KV key; 401 = secret drift) —
 * `wrangler tail` is the operator surface.
 */
async function forwardHeartbeat(
  env: Env,
  tenantSlug: string,
  state: TenantFailoverState,
  now: number,
): Promise<void> {
  if (!env.HUB_INGEST_URL || !env.HUB_INGEST_SECRET) return;

  let hostOk = false;
  let body: HealthStatsBody = {};
  let statsFetchFailed = false;
  try {
    const res = await fetch(`${state.current}/api/health?stats=1`, {
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
      headers: {
        "user-agent": "pos-failover-worker",
        ...(state.statsToken ? { "x-stats-token": state.statsToken } : {}),
      },
    });
    if (res.status === 200) {
      body = (await res.json()) as HealthStatsBody;
      hostOk = body.ok === true && body.db === "up";
    }
    // Non-200 = the health contract's own down verdict (503 {ok:false}) —
    // hostOk stays false, no fallback needed.
  } catch {
    statsFetchFailed = true;
    // The stats leg died (timeout/network) — gauge LIVENESS with the plain
    // probe instead of declaring the host dead off the heavy leg.
    hostOk = await isHealthy(state.current);
  }

  const envelope = {
    tenant: tenantSlug,
    hostOk,
    at: new Date(now).toISOString(),
    servedOrigin: state.current === state.activeOrigin ? "active" : "standby",
    ...(Array.isArray(body.clusters)
      ? { stats: "ok", clusters: body.clusters }
      : body.stats === "denied" || body.stats === "error"
        ? { stats: body.stats }
        : statsFetchFailed && hostOk
          ? { stats: "error" } // alive but the stats leg was unusable — visible at the Hub
          : {}),
    ...(body.bootstrap === true ? { bootstrap: true } : {}),
    ...(body.imageUsage ? { imageUsage: body.imageUsage } : {}),
  };

  const raw = JSON.stringify(envelope);
  const ts = String(Math.floor(now / 1000));
  const sig = await hmacHex(env.HUB_INGEST_SECRET, `${ts}.${raw}`);
  try {
    const res = await fetch(env.HUB_INGEST_URL, {
      method: "POST",
      signal: AbortSignal.timeout(HUB_POST_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        [INGEST_TS_HEADER]: ts,
        [INGEST_SIG_HEADER]: sig,
      },
      body: raw,
    });
    if (!res.ok) {
      console.error(`[failover] heartbeat forward for ${tenantSlug} → HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[failover] heartbeat forward for ${tenantSlug} failed:`, err);
  }
}

/**
 * The 15-min forward gate. Runs after the swap duty on a FRESH state read; the
 * gate stamp is PUT BEFORE the slow fetches, so the KV read-modify-write window
 * stays at milliseconds (KV is last-write-wins — the F1.7 model) and a stalled
 * forward is never re-attempted by the next tick.
 */
async function maybeForwardStats(env: Env, tenantSlug: string): Promise<void> {
  if (!env.HUB_INGEST_URL || !env.HUB_INGEST_SECRET) return;
  const raw = await env.FAILOVER_STATE.get(tenantSlug);
  if (!raw) return;
  const state = JSON.parse(raw) as TenantFailoverState;
  const now = Date.now();
  if (now - (state.lastStatsForwardAt ?? 0) < STATS_FORWARD_INTERVAL_MS) return;
  await env.FAILOVER_STATE.put(
    tenantSlug,
    JSON.stringify({ ...state, lastStatsForwardAt: now }),
  );
  await forwardHeartbeat(env, tenantSlug, state, now);
}

// A healthy origin returns HTTP 200 with the F1.5 contract { ok:true, db:"up" }.
async function isHealthy(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      headers: { "user-agent": "pos-failover-worker" },
    });
    if (res.status !== 200) return false;
    const body = (await res.json()) as { ok?: boolean; db?: string };
    return body.ok === true && body.db === "up";
  } catch {
    return false;
  }
}

// One Cloudflare API call: PATCH the proxied DNS record's content → target origin.
// Effective at the edge in seconds, no resolver-TTL wait, no SSL re-issue.
async function swapOrigin(
  env: Env,
  tenantId: string,
  state: TenantFailoverState,
  target: string,
): Promise<void> {
  await fetch(
    `https://api.cloudflare.com/client/v4/zones/${state.zoneId}/dns_records/${state.recordId}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: target, proxied: true }),
    },
  );
  const next: TenantFailoverState = {
    ...state,
    current: target,
    failCount: 0,
    recoverCount: 0,
  };
  await env.FAILOVER_STATE.put(tenantId, JSON.stringify(next));
  if (env.HUB_NOTIFY_URL) {
    // Best-effort notify; never block or fail the swap on the Hub being down.
    await fetch(env.HUB_NOTIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "failover", tenantId, to: target, at: Date.now() }),
    }).catch(() => {});
  }
}

async function pollTenant(env: Env, tenantId: string): Promise<void> {
  // The origin-swap duty runs FIRST and never waits on the F3.7 forward (which
  // follows on its own fresh state read — see maybeForwardStats).
  await runFailoverPoll(env, tenantId);
  await maybeForwardStats(env, tenantId);
}

async function runFailoverPoll(env: Env, tenantId: string): Promise<void> {
  const raw = await env.FAILOVER_STATE.get(tenantId);
  if (!raw) return;
  const state = JSON.parse(raw) as TenantFailoverState;

  if (await isHealthy(state.current)) {
    // Currently-served origin is healthy.
    if (state.current === state.standbyOrigin) {
      // We're on standby — probe whether the active origin has recovered.
      const activeOk = await isHealthy(state.activeOrigin);
      const recoverCount = activeOk ? state.recoverCount + 1 : 0;
      if (activeOk && recoverCount >= M_RECOVER) {
        await swapOrigin(env, tenantId, state, state.activeOrigin); // fail back
        return;
      }
      await env.FAILOVER_STATE.put(
        tenantId,
        JSON.stringify({ ...state, failCount: 0, recoverCount }),
      );
    } else if (state.failCount !== 0) {
      await env.FAILOVER_STATE.put(tenantId, JSON.stringify({ ...state, failCount: 0 }));
    }
    return;
  }

  // Currently-served origin is unhealthy.
  const failCount = state.failCount + 1;
  if (failCount >= N_FAIL && state.current === state.activeOrigin) {
    await swapOrigin(env, tenantId, state, state.standbyOrigin); // fail over
    return;
  }
  await env.FAILOVER_STATE.put(tenantId, JSON.stringify({ ...state, failCount }));
}

async function runOnce(env: Env): Promise<void> {
  const list = await env.FAILOVER_STATE.list();
  // Each tenant is independent; poll them concurrently (a handful of tenants/worker).
  await Promise.allSettled(list.keys.map((k) => pollTenant(env, k.name)));
}

export default {
  // The cron trigger (wrangler.jsonc) drives steady-state failover.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runOnce(env));
  },
  // Manual trigger for `wrangler dev` testing only — still controller-only, NOT a proxy.
  async fetch(_req: Request, env: Env): Promise<Response> {
    await runOnce(env);
    return new Response("failover poll ran\n", { status: 200 });
  },
};
