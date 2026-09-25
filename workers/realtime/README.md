# `workers/realtime` — per-cafe realtime nudges (Durable Object room)

One Cloudflare Worker per cafe, holding **one Durable Object room** (`cafe:<TENANT_ID>`)
that every device in that cafe joins. When a write lands, the cafe runtime POSTs a
signed event here and the room fans it out over WebSockets; each device turns that
into an **early refetch** of a query it was already polling for.

## Ownership — the thing to get right

|                      | `workers/failover`                      | `workers/realtime` (this one)            |
| -------------------- | --------------------------------------- | ---------------------------------------- |
| Owned by             | **the vendor**                          | **the client**                           |
| Deployments          | one, cross-tenant                       | **one per cafe**                          |
| Account              | the vendor's Cloudflare account         | **the client's own Cloudflare account**   |
| Free tier            | shared across every tenant              | **the client's own, per cafe**            |
| Blast radius         | platform-wide                           | exactly one cafe                          |

This follows the model already shipped in `scripts/go-live/client.example.json`:
the client's Vercel account (line: `vercel.token`) and the client's Atlas M0
(`mongodbUri`) work the same way. **The client signs up and owns the account; the
vendor configures it with a client-issued scoped token.** Cloudflare's terms §2.3
explicitly contemplate an account holder giving an API token to a third party
("you do so at your sole risk") — the risk sits with the account holder, which is
the client. Never create a Cloudflare account under the vendor's identity.

Because each cafe uses its own account, **cafe count is irrelevant to capacity**:
one cafe's ~335 requests/day sit against its own 100,000/day allowance (~0.34%).
Offboarding needs no transfer — the account was always theirs; they revoke the
token and everything keeps running.

## Design constraints (each one is load-bearing)

- **Supplement, never a replacement.** Every listening surface keeps its poll
  exactly as shipped (`REFETCH_INTERVALS.KITCHEN` is still 10s). Worker down,
  rate-limited, or the env flag unset ⇒ **exactly today's behaviour, zero
  regression.** The poll remains the fallback and the source of truth.
- **Hibernation is mandatory.** `ctx.acceptWebSocket()`, never `ws.accept()`.
  A plain-accepted socket bills Durable Object *duration* for the whole
  connection — a wall display holding one all shift would bill idle time all day.
  Hibernated sockets stay open while the object is evicted from memory, so the
  class keeps **no in-memory roster**: `ctx.getWebSockets()` is the only roster
  that survives an eviction.
- **SQLite backend, mandatory.** The Workers Free plan supports *only*
  SQLite-backed Durable Objects, so the migration must use `new_sqlite_classes`.
  A `new_classes` (legacy-kv) migration is refused on Free outright (wrangler
  error 10097).
- **Nudges carry no data.** The envelope is `{ tenant, kind, at }` — no order, no
  money, no customer. Devices refetch their own authenticated queries, so this
  Worker is never in the trust path and never sees a bill.
- **The publish must be AWAITED under `after()`.** `publishCafeEvent` (the only
  entry point a route calls) hands the publish PROMISE to Next's `after()`, so
  the request is registered with the platform's `waitUntil` and survives the
  response being flushed. A fire-and-drop `void fetch(...)` would race the
  serverless freeze and lose the nudge much of the time. `publishCafeEvent` also
  wraps the `after()` call in try/catch, because `after()` throws SYNCHRONOUSLY
  when no `waitUntil` is available — and every call site sits inside its route's
  `catch { return serverError(...) }`, where an escaping throw would turn a
  COMMITTED write into a 500 (and a 500 on order-create invites a retry, i.e. a
  duplicate order). Both properties are pinned, including a runtime pin that
  calls `publishCafeEvent` outside a request scope and asserts it does not throw.
- **`/join` is capped at `MAX_ROOM_SOCKETS` (64).** Its URL ships in the client
  bundle, so it cannot be gated on a secret; without a cap anyone could open
  sockets until the CLIENT'S OWN free tier was exhausted. A refused device just
  polls, as shipped. Verified live: the 65th connection is refused.
- **One room per cafe.** Every device joins and filters by kind. Cheap because
  Cloudflare does **not** bill outgoing WebSocket messages, so broadcasting to N
  devices costs the same as addressing one.
- **The print lane gets an accelerator, never a mechanism** (slice 2). Its poll
  is *discovery only* and `lib/print-queue-claim.ts`'s CAS is what guarantees
  correctness — that does not change. What the `print-job` nudge buys is the
  right to relax that poll from 3s to **60s while the socket is PROVEN healthy**,
  cutting ~13,680 Vercel requests/day per host device (a 95% cut). The host
  re-reads `isRealtimeHealthy()` on **every** tick and snaps back to 3s the
  instant proof-of-life goes stale, so a dropped frame or a half-open socket
  costs at most one 60s tick — never a lost print.
- **Health is PROVED, not assumed.** A device pings the room every 3 minutes and
  requires a pong; any inbound frame also counts as proof. A socket can sit at
  `readyState === OPEN` long after a NAT or proxy silently dropped it, firing no
  close event — a missing pong is the only thing that catches that, which is why
  the room's pong handler is load-bearing and why `isRealtimeHealthy()` fails
  closed on every uncertain case.

## Auth

`POST /publish` is HMAC-authenticated, **mirroring** `apps/hub/lib/heartbeat-hmac.ts`:
lowercase-hex HMAC-SHA256 over `` `${ts}.${rawBody}` ``, ts in unix **seconds**,
verified over the raw body *before* any parse, ±300s replay window, fail-closed on
an unset secret. The header names differ from the heartbeat's
(`x-realtime-signature` / `x-realtime-ts`) so a heartbeat signature can never be
replayed as a publish. This Worker sits outside the npm workspace and cannot
import `@pos/shared`, so it mirrors the literals — `apps/cafe/lib/realtime-paths.test.ts`
reads this source and pins them, the same way the hub pins the failover Worker.

`/join` is a public read-only subscribe. The room is keyed off the deployment's own
`TENANT_ID`, never off the query string, so a device cannot ask to join another
cafe's room; a validly-signed envelope naming a different tenant is refused 403.

## Verification status

**KAAM 0 (the gate) — PASSED locally, 15/15** (re-run green after the hardening
above; the socket cap was separately verified live at exactly 64), against the real `workerd` runtime
via `wrangler dev --local`: two devices joined one room, an HMAC-signed publish
reached both, the hibernation `webSocketMessage` handler answered a ping, every
auth failure (bad signature / stale ts / missing headers / wrong tenant / unknown
kind) was refused **and reached no device**, and a departing device did not break
the fan-out to the rest. The local DO materialised under
`.wrangler/state/v3/do/pos-realtime-CafeRoom/*.sqlite` — the SQLite backend.

**KAAM 0 ON A REAL FREE-PLAN ACCOUNT — PASSED, 11/11 (2026-09-25).** Deployed to
the first client's own Cloudflare account and driven over the public internet:
two devices joined `cafe:lucifer007`, an HMAC publish reached both, the
hibernation handler answered a ping, and bad-signature / stale-ts / wrong-tenant
were each refused **and reached no device**. The composition-inference below is
therefore now a MEASURED fact, not an inference:

> **Free plan + Durable Object + hibernated WebSocket works.** No single
> Cloudflare doc sentence states it; this deployment does.

**Token scope — the measured answer (replaces the open question):**

A token carrying **`Workers Scripts: Edit` + `Account Settings: Read`**, scoped to
the one client account, **successfully created the Worker AND ran the
`new_sqlite_classes` Durable Object migration on the first deploy.** Admin was
NOT required. `wrangler secret put` worked with the same token. So the
Editor/Admin worry does not apply to a token with Workers Scripts:Edit — the
role tiers describe dashboard *member roles*, not API token scopes, and there is
no Durable-Object-specific token permission (DOs ride the general Workers Scripts
scope). **This is what `go-live` should ask a client to create.**

**Still unverified:**

1. "100,000 requests/day" is stated without the literal words "per account".
   Cloudflare bills and plans per account, so this is structurally sound, but it
   is inference, not a quote.

## Deploying into a client's account

```sh
# In the CLIENT's account: My Profile -> API Tokens -> Create.
# See "Still unverified" #2 above before choosing the scope.
export CLOUDFLARE_API_TOKEN=<the client's token>

cd workers/realtime
# Name it per cafe so two clients never collide.
npx wrangler deploy --name pos-realtime-<slug> --var TENANT_ID:<slug>
npx wrangler secret put REALTIME_PUBLISH_SECRET   # must equal the cafe's env var
```

Then set the cafe's three env vars (`apps/cafe/.env.example` documents them):
`REALTIME_PUBLISH_URL`, `REALTIME_PUBLISH_SECRET`, `NEXT_PUBLIC_REALTIME_URL`.
Leaving them unset is the supported default — the cafe simply polls.

**Deploy status: LIVE for the first cafe** (`pos-realtime-lucifer007`, in that
client's own account, 2026-09-25). Nothing in the cafe runtime depends on this
Worker existing — unset the three env vars and the cafe goes back to polling.
