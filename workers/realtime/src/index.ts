/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from "cloudflare:workers";
//
// Realtime fan-out Worker (socket slice 1) — one Durable Object room per cafe.
//
// OWNERSHIP — read this before touching either Worker (socket-decision-v3 §4):
//   * workers/failover — VENDOR-owned. Platform-level, cross-tenant, KV keyed by
//     tenant, 1-min cron. One deployment serves every cafe.
//   * workers/realtime — CLIENT-owned. ONE deployment per cafe, living in THAT
//     cafe's own Cloudflare account (the client's email, the client's billing),
//     exactly like the client's Vercel account and Atlas M0 already documented
//     in scripts/go-live/client.example.json. Each cafe therefore gets its OWN
//     free tier: ~335 req/day against its own 100,000/day (~0.34%). Cafe count
//     is irrelevant and the blast radius of any failure is exactly one cafe.
//
// WHAT IT IS: a supplement to the cafe's existing polls, never a replacement.
// The cafe runtime POSTs an event here after a write lands; this Worker fans it
// out over WebSockets to every device in the room, and each device turns that
// into an EARLY refetch of a query it was already going to poll for anyway. If
// this Worker is down, rate-limited, or the cafe's env flag is off, behaviour is
// exactly today's shipped polling — zero regression, no data path through here.
//
// NOT here by design: the print lane (its poll is discovery-only and
// lib/print-queue-claim.ts's CAS is what guarantees correctness — a socket would
// make printing less reliable, not more), tables, and the orders summary.
//
// COST SHAPE: the Hibernation API (ctx.acceptWebSocket, NEVER ws.accept()) is
// mandatory here. A plain accept()'d socket bills Durable Object DURATION for
// the entire connection lifetime — a wall display holding a socket all shift
// would bill idle time all day. Hibernation evicts the DO from memory between
// messages while the sockets stay open, so an idle room costs nothing. Outgoing
// WebSocket messages are not billed at all (CF DO pricing), which is what makes
// the one-room-per-cafe fan-out cheap.
//
// The DO class MUST be registered with a `new_sqlite_classes` migration: the
// Workers Free plan supports ONLY the SQLite storage backend, and a `new_classes`
// (legacy-kv) migration is refused there outright (wrangler error code 10097).
//
// Outside the npm workspace (like workers/failover) — its deps/types are its
// own, and it is part of no Next build. It CANNOT import @pos/shared, so the
// HMAC scheme below MIRRORS apps/hub/lib/heartbeat-hmac.ts + @pos/shared/
// heartbeat; the cafe-side parity test reads THIS source and pins the literals.

export interface Env {
  CAFE_ROOM: DurableObjectNamespace;
  /** HMAC key shared with the cafe runtime's REALTIME_PUBLISH_SECRET
   *  (`wrangler secret put REALTIME_PUBLISH_SECRET`). UNSET = fail-closed:
   *  every publish is refused, and the cafes keep polling. */
  REALTIME_PUBLISH_SECRET?: string;
  /** This deployment's cafe. Set per client at provision time; a publish for
   *  any other tenant is refused, so one client's token can never fan out into
   *  another client's room even if two rooms shared an account. */
  TENANT_ID?: string;
}

// The publish HMAC. MIRRORS apps/hub/lib/heartbeat-hmac.ts exactly: lowercase-hex
// HMAC-SHA256 over `${ts}.${rawBody}`, ts = unix SECONDS, verified BEFORE
// JSON.parse over the exact bytes-as-text that were signed. Header names differ
// from the heartbeat's on purpose — a heartbeat signature must never be
// replayable as a publish, and vice versa.
const PUBLISH_SIG_HEADER = "x-realtime-signature";
const PUBLISH_TS_HEADER = "x-realtime-ts";
/** Replay window, seconds. Matches the heartbeat ingest's +/-300s. */
const PUBLISH_TS_TOLERANCE_S = 300;

/** Room key. ONE room per cafe (owner: "one room me sabhi ko join karo") —
 *  every device joins it and filters client-side by message kind. Cheap because
 *  Cloudflare does not bill OUTGOING WebSocket messages, so a single room
 *  broadcasting to N devices costs the same as addressing one. */
function roomName(tenantId: string): string {
  return `cafe:${tenantId}`;
}

/** The event kinds slice 1 carries. A device subscribes to the whole room and
 *  ignores kinds it does not care about — adding a kind needs no room change. */
const EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed", "self-order"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

/** Publish envelope — deliberately CARRIES NO ORDER DATA. It is a nudge, not a
 *  feed: the device refetches its own authenticated query and the server stays
 *  the single source of truth. That is what keeps this Worker out of the trust
 *  path entirely — it never sees a price, a customer, or a bill. */
interface PublishEnvelope {
  tenant: string;
  kind: EventKind;
  at: string;
}

/** Bound the signed body. `content-length` is only a hint (it is absent on a
 *  chunked request and can be malformed), so the authoritative check is the
 *  post-read one below; this just rejects the honest oversized case early.
 *  The envelope is ~100 bytes, so 4KB is generous either way. */
const MAX_PUBLISH_BYTES = 4096;

/** Hard cap on sockets in one room. A cafe runs a counter PC, a tablet or two
 *  and a wall display; 64 is far above that and far below a level that could
 *  dent the client's own 100,000/day allowance. See the /join note below. */
const MAX_ROOM_SOCKETS = 64;

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

/** Constant-time compare of two lowercase-hex digests. Both sides here are our
 *  own SHA-256 hex output, so the length check is a guard, not the comparison
 *  (mirrors heartbeat-hmac.ts's hash-then-compare intent). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Strict unix-seconds parse: decimal digits only (no floats, hex, signs). */
function parseTsSeconds(ts: string): number | null {
  if (!/^\d{1,12}$/.test(ts)) return null;
  return Number(ts);
}

/**
 * The per-cafe room. One instance per cafe (id derived from `cafe:<TENANT_ID>`),
 * holding every device's WebSocket.
 *
 * HIBERNATION: sockets are adopted with `ctx.acceptWebSocket()` and handled by
 * the `webSocketMessage`/`webSocketClose`/`webSocketError` HANDLERS below —
 * never by an in-memory `addEventListener` on an `accept()`'d socket. Between
 * messages the runtime may evict this object from memory entirely while the
 * sockets stay open; it is reconstructed on the next event. Consequently this
 * class holds NO in-memory connection list — `ctx.getWebSockets()` is the only
 * roster that survives an eviction, and every handler re-reads it.
 */
export class CafeRoom extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Device joins the room.
    if (url.pathname === "/join") {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      // /join is PUBLIC by construction — its URL ships in the client bundle
      // (NEXT_PUBLIC_REALTIME_URL), so it cannot be gated on a secret. Cap the
      // room instead: a cafe has a counter, a couple of tablets and a wall
      // display, so MAX_ROOM_SOCKETS is far above any real device count but far
      // below what would matter. Without it, anyone who reads the bundle could
      // open sockets until the CLIENT'S OWN free tier is exhausted for the day.
      // Refusing is safe: a device that cannot join simply polls, as shipped.
      if (this.ctx.getWebSockets().length >= MAX_ROOM_SOCKETS) {
        return new Response("room full", { status: 503 });
      }
      const pair = new WebSocketPair();
      // acceptWebSocket (NOT client.accept()) is what makes the connection
      // hibernatable — see the cost note at the top of this file.
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // The cafe runtime publishes an event into the room. Authentication already
    // happened at the Worker entrypoint (the HMAC is verified over the raw body
    // before this object is ever addressed), so the body reaching here is
    // trusted and its tenant is this room's own.
    if (url.pathname === "/publish" && req.method === "POST") {
      const payload = await req.text();
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload);
          delivered++;
        } catch {
          // A socket that died between the roster read and the send must not
          // stop the fan-out to the rest of the room. The runtime reaps it.
        }
      }
      return Response.json({ ok: true, delivered });
    }

    return new Response("not found", { status: 404 });
  }

  /**
   * Devices are LISTENERS, not writers — the only client message the room
   * honours is a liveness ping, answered so a device can prove the socket is
   * still usable without a reconnect. Anything else is ignored rather than
   * errored: an unknown frame from a stale client tab must not tear down a
   * connection a cook's wall display depends on.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      try {
        ws.send("pong");
      } catch {
        // Closed mid-flight; the runtime reaps it.
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // No roster to prune (ctx.getWebSockets is the roster). Close our side so the
    // connection does not linger half-open. 1005 = "no status received", which
    // is NOT a legal code to send back — normalise it to 1000.
    try {
      ws.close(code === 1005 ? 1000 : code, "room closing");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Nothing to clean up (no in-memory roster); the runtime drops the socket.
  }
}

/** Verify the publish HMAC. FAIL-CLOSED in the same order as the heartbeat
 *  ingest — secret presence, header presence, timestamp window, signature — so
 *  a caller learns nothing beyond "unauthorized". */
async function verifyPublish(
  env: Env,
  req: Request,
  rawBody: string,
  nowMs: number,
): Promise<boolean> {
  if (!env.REALTIME_PUBLISH_SECRET) return false;
  const tsHeader = req.headers.get(PUBLISH_TS_HEADER);
  const sigHeader = req.headers.get(PUBLISH_SIG_HEADER);
  if (!tsHeader || !sigHeader) return false;

  const ts = parseTsSeconds(tsHeader);
  if (ts === null || Math.abs(nowMs / 1000 - ts) > PUBLISH_TS_TOLERANCE_S) return false;

  const expected = await hmacHex(env.REALTIME_PUBLISH_SECRET, `${tsHeader}.${rawBody}`);
  return safeEqualHex(expected, sigHeader.toLowerCase());
}

/** The tenant this deployment serves. Configured per client; a publish naming
 *  any other tenant is refused. */
function configuredTenant(env: Env): string | null {
  const tenant = (env.TENANT_ID ?? "").trim();
  return tenant.length > 0 ? tenant : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // /join — a device opens its ONE socket for the whole device. The tenant is
    // this deployment's own (client-owned account, one cafe per Worker), so the
    // room key is never taken from the query string: a device cannot ask to
    // join another cafe's room.
    if (url.pathname === "/join") {
      const tenant = configuredTenant(env);
      if (!tenant) return new Response("not configured", { status: 503 });
      const id = env.CAFE_ROOM.idFromName(roomName(tenant));
      return env.CAFE_ROOM.get(id).fetch(req);
    }

    // /publish — the cafe runtime, HMAC-authenticated.
    if (url.pathname === "/publish" && req.method === "POST") {
      const tenant = configuredTenant(env);
      if (!tenant) return new Response("not configured", { status: 503 });

      const contentLength = Number(req.headers.get("content-length") ?? "0");
      if (contentLength > MAX_PUBLISH_BYTES) {
        return new Response("payload too large", { status: 413 });
      }
      // Read the EXACT bytes-as-text the signature covers, before any parse.
      const rawBody = await req.text();
      if (rawBody.length > MAX_PUBLISH_BYTES) {
        return new Response("payload too large", { status: 413 });
      }
      if (!(await verifyPublish(env, req, rawBody, Date.now()))) {
        return new Response("unauthorized", { status: 401 });
      }

      let envelope: PublishEnvelope;
      try {
        envelope = JSON.parse(rawBody) as PublishEnvelope;
      } catch {
        return new Response("bad request", { status: 400 });
      }
      if (!isEventKind(envelope.kind)) return new Response("bad request", { status: 400 });
      // A validly-signed envelope for a DIFFERENT tenant is still refused: the
      // signature proves the sender holds this deployment's secret, not that
      // the named cafe is this one.
      if (envelope.tenant !== tenant) return new Response("forbidden", { status: 403 });

      const id = env.CAFE_ROOM.idFromName(roomName(tenant));
      return env.CAFE_ROOM.get(id).fetch(
        new Request("https://room/publish", { method: "POST", body: rawBody }),
      );
    }

    return new Response("not found", { status: 404 });
  },
};
