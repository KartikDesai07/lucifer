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
- **The print lane is deliberately excluded.** Its poll is *discovery only* and
  `lib/print-queue-claim.ts`'s CAS is what guarantees correctness. A socket there
  would make printing less reliable, not more.

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

**Still unverified — needs a real Free-plan account, which this machine has no
credentials for:**

1. **Free-plan entitlement for DO WebSockets.** Confirmed only *by composition*:
   SQLite DOs are Free-eligible (quoted on the DO pricing page and the 2026-07-09
   changelog) and DOs support WebSockets (quoted on the DO concept page) — but
   **no single Cloudflare sentence states both together.** The code path is
   proven; the plan entitlement is not. Deploy the throwaway room to a real Free
   account and connect a browser before relying on this.
2. **The Editor-vs-Admin token boundary.** Cloudflare documents *"Editor: can
   read, update, deploy, and rename existing Workers… cannot create or delete"*
   vs *"Admin: full control… including creating"*. So the **first** deploy — which
   creates the Worker **and** runs the DO migration — likely needs Admin, while
   later code-only updates fit Editor. **Whether adding a new DO class to an
   existing Worker needs Admin is not stated in the docs.** There is also no
   Durable-Object-specific token permission in Cloudflare's permissions reference;
   DOs appear to deploy under the general Workers Scripts scope. **Test this with
   a real scoped token and write the measured answer here and in DEPLOY.md before
   the provisioner scripts it.**
3. "100,000 requests/day" is stated without the literal words "per account".
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

**Deploy status: UNDEPLOYED** (owner-gated, and blocked on KAAM 0 against a real
Free-plan account). Nothing in the cafe runtime depends on this Worker existing.
