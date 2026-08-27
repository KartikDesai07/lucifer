import { PUBLIC_ORDER_RATE_WINDOW_MS } from "@pos/shared/public";
import { PublicRateLimit } from "@/models/PublicRateLimit";

// CR2.2 SLICE 3 — a fixed-window rate limiter over PublicRateLimit
// (models/PublicRateLimit.ts). "Fixed window" (not sliding/token-bucket): the
// timeline is cut into PUBLIC_ORDER_RATE_WINDOW_MS-wide slices and every hit
// in a slice counts against the SAME document, so one atomic `$inc` per hit
// is enough — no read-modify-write race between two diners' devices hitting
// the same table at once.
//
// The pure math (window index/key/decision) is kept separate from the DB
// call below so it is unit-testable without Mongo — see public-rate-limit.test.ts.

// Which fixed window a timestamp (epoch ms) falls into.
export function rateWindowIndex(now: number): number {
  return Math.floor(now / PUBLIC_ORDER_RATE_WINDOW_MS);
}

// The document _id one hit against `bucket` at time `now` lands on.
export function rateWindowKey(bucket: string, now: number): string {
  return `${bucket}:${rateWindowIndex(now)}`;
}

// Seconds remaining until the CURRENT window rolls over to the next one.
// Ceil'd and floored at 1: a caller handed `retryAfterSec: 0` at the very
// edge of a window would tell a diner's client to retry immediately, which
// just re-triggers the same 429 a moment later.
function secondsUntilWindowRolls(now: number): number {
  const windowEndMs = (rateWindowIndex(now) + 1) * PUBLIC_ORDER_RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((windowEndMs - now) / 1000));
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
  freshWindow: boolean;
}

// Pure: turns a POST-INCREMENT hit count into the decision the caller acts
// on. `n` is the counter's value AFTER the $inc that produced this hit (i.e.
// this call's own hit is included), so `n === 1` means this hit is what
// created the window's row.
export function rateLimitDecision(n: number, max: number, now: number): RateLimitDecision {
  return {
    allowed: n <= max,
    retryAfterSec: secondsUntilWindowRolls(now),
    freshWindow: n === 1,
  };
}

// Records one hit against `bucket` and reports whether it's within `max` for
// the window containing `now`. ONE atomic upsert — no separate read, so two
// concurrent hits against the same fresh bucket can never both observe n=0
// and both believe they created the row.
export async function hitRateLimit(
  bucket: string,
  max: number,
  now: number,
): Promise<RateLimitDecision> {
  const doc = await PublicRateLimit.findOneAndUpdate(
    { _id: rateWindowKey(bucket, now) },
    { $inc: { n: 1 }, $setOnInsert: { at: new Date(now) } },
    { upsert: true, new: true },
  ).lean();
  return rateLimitDecision(doc?.n ?? 1, max, now);
}

// Hands one hit back to `bucket`'s CURRENT window. CR2.2c: a mistyped promo
// code is a DETERMINISTIC 422 that stores nothing and creates nothing, yet it
// used to burn one of a table's 8 slots — eight typos locked every phone on
// that QR out of ordering for the rest of the window (review 2026-08-20).
// Safe where a compensating write normally is not (project lesson:
// never-revert-on-write-throw): this is only ever called on a path that is
// definitely returning a rejection, never on a throw or an unknown outcome.
// Floored at 0 by the filter so a refund can never mint budget.
export async function refundRateLimit(bucket: string, now: number): Promise<void> {
  try {
    await PublicRateLimit.updateOne(
      { _id: rateWindowKey(bucket, now), n: { $gt: 0 } },
      { $inc: { n: -1 } },
    );
  } catch {
    // Best-effort: failing to refund only costs the diner one slot — it must
    // never turn a clean 422 into a 500.
  }
}

// Read-only peek at `bucket`'s CURRENT window hit count — no $inc, no
// upsert, never increments. CR2.2 fix round (honeypot metering): the
// honeypot branch (app/api/public/order-request/route.ts) never calls
// hitRateLimit itself (a bot must not spend an honest diner's own budget),
// so without this peek a bot filling `hp` could rack up UNMETERED
// Table/Product/Settings reads (buildHoneypotResponse's own work) forever
// against a bucket a real diner is already capped on. Returns 0 for a bucket
// with no window row yet — indistinguishable from a genuinely untouched
// bucket, which is correct either way.
export async function peekRateLimit(bucket: string, now: number): Promise<number> {
  const doc = await PublicRateLimit.findById(rateWindowKey(bucket, now)).lean();
  return doc?.n ?? 0;
}

// Best-effort reap of windows old enough that nothing can still be counting
// against them (2 windows back, so the immediately-previous window's rows
// survive any clock-skew edge case). Called opportunistically from the hot
// path — never blocking, never retried — so a failure here (a transient
// Mongo hiccup) must not turn into a 500 for a diner placing an order; the
// error is swallowed rather than logged (no console.* in app/lib code).
export async function pruneRateWindows(now: number): Promise<void> {
  try {
    await PublicRateLimit.deleteMany({
      at: { $lt: new Date(now - 2 * PUBLIC_ORDER_RATE_WINDOW_MS) },
    });
  } catch {
    // best-effort — see comment above
  }
}
