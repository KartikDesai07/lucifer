// ─────────────────────────────────────────────────────────────────────────────
// Hub constants (F3.4). Named values only — no magic numbers in the panel gate,
// auth wiring, or rate limiter (CLAUDE.md §5). The Hub is the crown-jewel target
// (owner session theft = total platform compromise, fed-secrets-vault.json
// risks), so sessions are SHORT and step-up is required before any reveal.
// ─────────────────────────────────────────────────────────────────────────────

/** Owner session lifetime. Short by design (§E "short session lifetimes"): a
 * stolen Hub JWT is usable for at most this long. 8h = one working day. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** §E-4: a getSecret/reveal/provision needs a step-up (fresh 2FA) no older than
 * this. A stale step-up is re-prompted. */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

/** §E-5 / spec "rate-limit auth like the existing app does for /api/auth":
 * v1's rule is 5 attempts per IP per minute. Applied per-IP AND per-identity. */
export const AUTH_RATE_LIMIT_MAX = 5;
export const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** TOTP (RFC 6238) parameters — see lib/totp.ts. 6 digits / 30s step / ±1 step
 * drift window is the near-universal authenticator-app default. */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DRIFT_STEPS = 1;

// ── F3.7 heartbeat ingest + triggers ─────────────────────────────────────────

/** The DB hard-trip (F3 §3.7): active write ledger ≥75% full ⇒ ADD_DB_CLUSTER.
 * The SECOND half of the staged event whose first half is the runtime's ~70%
 * roll-forward prompt (F2 §2.7 SCALE_PROMPT_FILL_PCT) — deliberately above it,
 * below the runtime's 85% critical alarm. */
export const FILL_TRIP_PCT = 0.75;

/** Image-store trip (F3 §3.7): any of storage/bandwidth/credits ≥75% ⇒
 * ADD_CLOUD (manual-signup-gated — F3.9 owns the checklist + paste flow). */
export const IMAGE_TRIP_PCT = 0.75;

/** FAILOVER via ping-counting: this many CONSECUTIVE hostOk:false heartbeats.
 * NOTE this is the DUAL-outage alarm (both origins dark ≈45min at the 15-min
 * forward cadence): a real single-origin failover surfaces via the envelope's
 * `servedOrigin:'standby'` (the Worker already swapped) — see heartbeat-triggers. */
export const FAILOVER_CONSECUTIVE_MISSES = 3;

/** Ping-counting consecutiveness is time-bounded: prior misses older than this
 * (a suspension gap, a long Worker outage) don't count toward the streak. */
export const FAILOVER_WINDOW_MS = 2 * 60 * 60 * 1000;

/** A closed (done/dismissed) task suppresses re-enqueue of the same
 * (tenant, type) for this long — a persistent condition (a still-standby-served
 * host, a dismissed nuisance) must not re-mint a task every 15 minutes onto the
 * TTL-free Task collection. */
export const TASK_REOPEN_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Ingest rate limits: per-IP BEFORE the HMAC (bounds signature-check compute)
 * and per-TENANT after it (bounds registry-M0 growth to ~8× the Worker's
 * nominal one-per-15-min cadence even under a valid-key retry storm). Both
 * per-isolate best-effort, like the auth limiter (lib/rate-limit.ts). */
export const INGEST_IP_RATE_LIMIT_MAX = 120;
export const INGEST_IP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const INGEST_TENANT_RATE_LIMIT_MAX = 8;
export const INGEST_TENANT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
