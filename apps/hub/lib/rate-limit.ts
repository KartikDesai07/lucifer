import { AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter (F3.4 / §E-5: "rate-limit auth like the existing app does for
// /api/auth" — v1's rule is 5 attempts / IP / minute). In-memory fixed window,
// injectable clock for tests.
//
// HONEST SCOPE: this is PER-ISOLATE (each serverless instance has its own map),
// exactly like v1's node-cache-backed limiter — a distributed attacker across
// many warm isolates gets more than 5/min. That is an ACCEPTED tradeoff on the
// ₹0 stack: the real walls on the Hub panel are TOTP (a 6-digit code with a
// monotonic replay guard) + the per-user IP allowlist + the append-only audit,
// not this counter. The counter stops casual online guessing and log spam.
// ─────────────────────────────────────────────────────────────────────────────

interface Window {
  count: number;
  resetAt: number; // unix ms when this window expires
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number; // 0 when allowed
}

export interface RateLimitOptions {
  max?: number;
  windowMs?: number;
  now?: number; // injectable clock (tests); defaults to Date.now()
}

const store = new Map<string, Window>();

/**
 * Consume one hit for `key`. Returns whether it is allowed plus how long until
 * the window resets. Sweeps expired windows opportunistically so the map cannot
 * grow without bound on a low-traffic owner panel.
 */
export function rateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const max = options.max ?? AUTH_RATE_LIMIT_MAX;
  const windowMs = options.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
  const now = options.now ?? Date.now();

  sweep(now);

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count, retryAfterMs: 0 };
}

/** Drop windows that have already reset. O(n) but n is tiny (one owner). */
function sweep(now: number): void {
  for (const [key, window] of store) {
    if (window.resetAt <= now) store.delete(key);
  }
}

/** Test-only: clear all windows between cases. */
export function _resetRateLimit(): void {
  store.clear();
}
