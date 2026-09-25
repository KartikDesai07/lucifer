import { createHmac } from "node:crypto";
import { after } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Realtime publish (socket slice 1) — the cafe runtime's ONE way to nudge its
// devices that something changed. SERVER-ONLY (node:crypto + a secret).
//
// WHAT THIS IS NOT: a data feed. The envelope carries a KIND and nothing else —
// no order, no money, no customer. A device that receives one refetches its own
// authenticated query, so the server stays the single source of truth and the
// Worker never sees a bill. See workers/realtime/src/index.ts.
//
// SUPPLEMENT, NEVER A REPLACEMENT. Every surface that listens keeps its poll
// exactly as shipped (REFETCH_INTERVALS.KITCHEN stays 10s); the socket only
// triggers an EARLY refresh. Therefore:
//   * REALTIME_PUBLISH_URL unset  => publishing is off, cafes poll. Default.
//   * the Worker down / rate-limited / slow => the throw is swallowed here.
// In every one of those cases behaviour is exactly today's shipped polling.
//
// FIRE-AND-FORGET IS A CORRECTNESS REQUIREMENT, not an optimisation: a publish
// failure must NEVER fail (or delay) the order write that triggered it. Losing a
// nudge costs a cook at most one poll interval; failing the write costs money.
// `publishCafeEvent` is the ONLY entry point a route uses: it hands the promise
// to after() (so the request survives the response flush) and swallows after()'s
// own synchronous throw. See the guard tests in realtime-paths.test.ts.
//
// The print lane DOES get a nudge ("print-job", slice 2) — but only as an
// accelerator, never as the mechanism. Its poll is DISCOVERY-ONLY and
// lib/print-queue-claim.ts's CAS is what guarantees correctness, so the nudge
// merely lets the host relax that poll from 3s to 60s while the socket is
// PROVEN healthy (use-print-host-wake.ts re-reads isRealtimeHealthy() every
// tick). The poll is never removed and the CAS never moves: a lost print-job
// frame costs at most one 60s tick, never a lost print.
// ─────────────────────────────────────────────────────────────────────────────

/** The kinds the room carries. MIRRORED in workers/realtime/src/index.ts
 *  (EVENT_KINDS) — that Worker sits outside the npm workspace and cannot import
 *  this file, so realtime-paths.test.ts parity-pins both lists together. */
export const CAFE_EVENT_KINDS = [
  "kot-fired", // a round fired to the kitchen  → Kitchen board
  "kot-ticked", // a cook ticked a line off     → Kitchen board
  "order-changed", // created / settled / voided → POS pulse + board
  "self-order", // a QR self-order arrived      → POS pulse
  // Socket slice 2. The print host listens for this so it can drop its
  // discovery poll from 3s to 60s. It is a NUDGE ONLY — the poll stays as the
  // safety net and print-queue-claim.ts's CAS stays the correctness guarantee,
  // so a lost print-job frame costs at most one 60s tick, never a lost print.
  "print-job",
] as const;
export type CafeEventKind = (typeof CAFE_EVENT_KINDS)[number];

/** Header + scheme literals. MIRROR of apps/hub/lib/heartbeat-hmac.ts's scheme
 *  (lowercase-hex HMAC-SHA256 over `${ts}.${rawBody}`, ts = unix SECONDS), with
 *  its OWN header names so a heartbeat signature can never be replayed as a
 *  publish. The Worker mirrors these literals; the parity test pins them. */
export const REALTIME_SIG_HEADER = "x-realtime-signature";
export const REALTIME_TS_HEADER = "x-realtime-ts";

/** How long a publish may take before it is abandoned. A Vercel route's budget
 *  is <8s and this call is NOT part of the write's critical path, so it gets a
 *  deliberately tight budget. It runs under after(), i.e. AFTER the response is
 *  flushed, so it never eats the route's own budget — but it does hold the
 *  invocation open, and this bounds that to ~2s even against a black-holed
 *  Worker. */
const PUBLISH_TIMEOUT_MS = 2000;

/** The signed envelope. Deliberately minimal — see the file header. */
export interface CafeEventEnvelope {
  tenant: string;
  kind: CafeEventKind;
  at: string;
}

/** Lowercase-hex HMAC-SHA256 over the timestamp-bound message. Exported for the
 *  tests (the Worker has its own crypto.subtle mirror of this). */
export function signRealtime(secret: string, tsSeconds: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${tsSeconds}.${rawBody}`).digest("hex");
}

/** Build the exact bytes-as-text that get signed AND sent. One function so the
 *  signature can never cover different bytes than the body (the F3.7 lesson:
 *  verify over the raw body, before any parse — so sign over it too). */
export function buildRealtimeRequest(
  secret: string,
  envelope: CafeEventEnvelope,
  nowMs: number,
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(envelope);
  const ts = String(Math.floor(nowMs / 1000));
  return {
    body,
    headers: {
      "content-type": "application/json",
      [REALTIME_TS_HEADER]: ts,
      [REALTIME_SIG_HEADER]: signRealtime(secret, ts, body),
    },
  };
}

/** Is publishing configured AND on? Both the URL and the secret are required:
 *  a half-configured cafe publishes nothing rather than sending unsigned bodies
 *  (fail-closed, matching the Worker's own unset-secret behaviour). */
export function realtimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REALTIME_PUBLISH_URL && env.REALTIME_PUBLISH_SECRET);
}

/**
 * Nudge every device in this cafe's room. Returns a promise that ALWAYS
 * resolves — it never rejects, whatever the network or the Worker does.
 *
 * It is `async` and AWAITABLE on purpose, and callers must hand the returned
 * promise to `after()` (see `publishCafeEvent` below). A serverless runtime is
 * free to freeze the invocation once the response is flushed and all work
 * registered with `waitUntil` has settled; a promise that was never registered
 * has no claim on that lifetime, so a fire-and-drop `void fetch(...)` would
 * race the freeze and lose the nudge a large share of the time. Next's
 * `after()` awaits the callback and holds the invocation open for it
 * (next/dist/server/after/after-context.js — the queue is drained under
 * `waitUntil`), which is what actually gets the request out the door.
 *
 * It still cannot hurt the write: every failure is swallowed here, the timeout
 * is tight, and it only ever runs AFTER the response has been sent.
 */
export async function broadcastCafeEvent(
  kind: CafeEventKind,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const url = process.env.REALTIME_PUBLISH_URL;
    const secret = process.env.REALTIME_PUBLISH_SECRET;
    // Unset => the flag is off for this cafe. Silent by design: an unconfigured
    // cafe is the DEFAULT state, not an error worth logging on every write.
    if (!url || !secret) return;

    const tenant = process.env.TENANT_ID ?? "dev";
    const { body, headers } = buildRealtimeRequest(
      secret,
      { tenant, kind, at: new Date(nowMs).toISOString() },
      nowMs,
    );

    await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      // A nudge is never worth a retry or a cache entry.
      cache: "no-store",
    });
  } catch {
    // Every failure is swallowed: a timeout, a DNS miss, a 401 from a drifted
    // secret, a synchronous throw from a malformed URL. No console.* either —
    // this runs on every order write, and a down Worker must not flood the
    // logs with one line per sale. Losing a nudge costs one poll interval.
  }
}

/**
 * The ONE way a route publishes. Call it INSTEAD of `after(() =>
 * broadcastCafeEvent(...))` — it owns both halves of the safety contract:
 *
 *  1. It passes the PROMISE to `after()`, so the request is registered with the
 *     platform's `waitUntil` and actually survives the response being flushed.
 *  2. It wraps the `after()` call itself in try/catch. `after()` throws
 *     SYNCHRONOUSLY when no `waitUntil` is available in the current runtime
 *     ("if something is wrong, throw synchronously, bubbling up to the `after`
 *     callsite" — after-context.js). Every call site sits inside its route's
 *     `try { ... } catch { return serverError(...) }`, so an unguarded throw
 *     here would turn a COMMITTED write into a 500 — and a 500 on a create
 *     invites a retry, i.e. a duplicate order. The nudge must never be able to
 *     do that, so the throw dies here and the write still reports success.
 */
export function publishCafeEvent(kind: CafeEventKind): void {
  try {
    after(broadcastCafeEvent(kind));
  } catch {
    // No `after()` in this runtime — skip the nudge, keep the write. Devices
    // poll, which is the shipped behaviour and the source of truth anyway.
  }
}
