// ─────────────────────────────────────────────────────────────────────────────
// F3.5 — the ONE rate-limit-aware HTTP retry layer behind all three Hub
// provider clients (lib/atlas.ts / lib/vercel.ts / lib/imagestore.ts). Mirrors
// the cafe's proven 429 handling (apps/cafe/lib/provisioners/atlas.ts) and
// extends it per the step spec: besides honoring `Retry-After` on a 429, it is
// RateLimit-Remaining-AWARE — when a provider says the bucket is empty
// (`RateLimit-Remaining: 0` + a reset hint) the NEXT call proactively waits out
// the reset instead of burning an attempt on a guaranteed 429.
//
// Header dialects covered (one parser, three providers):
//   Atlas       RateLimit-Limit/-Remaining/-Reset (IETF draft: Reset = delta s)
//               + Retry-After on the 429 itself
//   Vercel      X-RateLimit-Remaining/-Reset (Reset = epoch) + Retry-After
//   Cloudinary  X-FeatureRateLimit-Remaining/-Reset (Reset = HTTP date); its
//               rate-limit STATUS is 420, so the status set is configurable
//
// No secrets flow through this module by design (URLs/labels only — request
// bodies and auth headers are opaque pass-throughs and are never read or
// logged), but it sits on the credential path, so it obeys the same
// no-console gate as the vault (eslint override + source-scan test).
// ─────────────────────────────────────────────────────────────────────────────

/** 429/420 handling (spec: honor Retry-After): bounded retries, clamped waits —
 *  the cafe provisioner's exact constants (apps/cafe .. atlas-plan.ts). */
export const RATE_LIMIT_MAX_RETRIES = 4;
export const RETRY_AFTER_DEFAULT_MS = 2_000;
export const RETRY_AFTER_MAX_MS = 60_000;

const clampWait = (ms: number) => Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS);

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into a wait in ms,
 *  clamped to [0, RETRY_AFTER_MAX_MS]; absent/garbage → the default. */
export function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null || header.trim() === "") return RETRY_AFTER_DEFAULT_MS;
  const value = header.trim();
  if (/^\d+$/.test(value)) return clampWait(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? RETRY_AFTER_DEFAULT_MS : clampWait(at - nowMs);
}

/** The three dialects' header names, in the order we trust them. */
const REMAINING_HEADERS = [
  "RateLimit-Remaining",
  "X-RateLimit-Remaining",
  "X-FeatureRateLimit-Remaining",
] as const;
const RESET_HEADERS = [
  "RateLimit-Reset",
  "X-RateLimit-Reset",
  "X-FeatureRateLimit-Reset",
] as const;

function firstHeader(headers: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null && value.trim() !== "") return value.trim();
  }
  return null;
}

/** Tokens left in the provider's bucket, from whichever dialect is present;
 *  null when no (parseable) remaining header exists. */
export function rateLimitRemaining(headers: Headers): number | null {
  const value = firstHeader(headers, REMAINING_HEADERS);
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** Numeric-reset shape thresholds: a value past ~2001-09-09 read as epoch
 *  SECONDS (1e9) must be absolute, and past the same instant read as epoch
 *  MILLISECONDS (1e12) it must be epoch-ms — real delta-seconds are always
 *  tiny (≤ minutes), so the bands cannot collide. */
const EPOCH_MS_MIN = 1e12;
const EPOCH_SECONDS_MIN = 1e9;

/** Parse a reset header value into a wait-from-now in ms, clamped. Handles all
 *  three dialects by shape: absolute epochs (Vercel epoch s / epoch ms), small
 *  numbers as IETF delta-seconds (Atlas), and non-numbers as HTTP dates
 *  (Cloudinary). null = no usable hint. */
export function resetWaitMs(value: string | null, nowMs: number): number | null {
  if (value === null || value.trim() === "") return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (n > EPOCH_MS_MIN) return clampWait(n - nowMs); // epoch milliseconds
    if (n > EPOCH_SECONDS_MIN) return clampWait(n * 1000 - nowMs); // epoch seconds
    return clampWait(n * 1000); // delta seconds (IETF draft)
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : clampWait(at - nowMs);
}

// ── The retrying fetch ────────────────────────────────────────────────────────
/** Injectable collaborators (the F2.8/F3.4 test-seam precedent): real fetch,
 *  real timers in production; fakes with a virtual clock in tests. */
export interface RetryDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function resolveRetryDeps(overrides?: Partial<RetryDeps>): RetryDeps {
  return {
    fetchImpl: (...args) => fetch(...args),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    ...overrides,
  };
}

export interface RetryingFetchOptions {
  /** Error-message prefix, e.g. "hub-atlas". Never put secrets in it. */
  label: string;
  /** Statuses treated as rate-limited. Default [429]; Cloudinary adds 420. */
  rateLimitStatuses?: readonly number[];
  maxRetries?: number;
}

export type RetryingFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Wrap fetch with bounded, header-honoring rate-limit handling:
 *  - a rate-limited status waits the EXACT `Retry-After` (fallback: the reset
 *    header, then the default), then retries, at most `maxRetries` times;
 *  - a SUCCESSFUL response that reports an empty bucket (`…Remaining: 0` + a
 *    reset hint) arms a proactive not-before gate so the next call through
 *    this client waits out the reset instead of provoking the 429.
 * State (the gate) is per returned function — i.e. per client instance.
 */
export function createRetryingFetch(
  deps: RetryDeps,
  opts: RetryingFetchOptions,
): RetryingFetch {
  const statuses = opts.rateLimitStatuses ?? [429];
  const maxRetries = opts.maxRetries ?? RATE_LIMIT_MAX_RETRIES;
  let notBeforeMs = 0;

  return async (url, init) => {
    for (let attempt = 0; ; attempt += 1) {
      const holdMs = notBeforeMs - deps.now();
      if (holdMs > 0) await deps.sleep(clampWait(holdMs));

      const res = await deps.fetchImpl(url, init);

      if (!statuses.includes(res.status)) {
        // Proactive throttle: remember an empty bucket so the NEXT call waits.
        if (rateLimitRemaining(res.headers) === 0) {
          const wait = resetWaitMs(firstHeader(res.headers, RESET_HEADERS), deps.now());
          if (wait !== null && wait > 0) notBeforeMs = deps.now() + wait;
        }
        return res;
      }

      if (attempt >= maxRetries) {
        throw new Error(
          `[${opts.label}] still rate-limited (HTTP ${res.status}) after ${attempt + 1} attempts`,
        );
      }
      const header = res.headers.get("Retry-After");
      const wait =
        header !== null && header.trim() !== ""
          ? retryAfterMs(header, deps.now())
          : (resetWaitMs(firstHeader(res.headers, RESET_HEADERS), deps.now()) ??
            RETRY_AFTER_DEFAULT_MS);
      notBeforeMs = 0; // this sleep IS the backoff — never double-wait
      await deps.sleep(wait);
    }
  };
}

// ── Serialization (spec: "serializes org/project creation") ──────────────────
/**
 * A promise-chain mutex: tasks run strictly one-at-a-time in submission order,
 * a rejection doesn't wedge the queue, and each caller gets its own task's
 * result. lib/atlas.ts holds a module-level instance so project creation is
 * serialized across ALL Atlas clients in this process — the token bucket the
 * cap-10/refill-5-per-60s Atlas limit meters is per-org endpoint, and bursty
 * parallel creates are exactly what half-provisions a tenant (§2 decision 7).
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
