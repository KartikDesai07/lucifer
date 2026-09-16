# pos-failover — controller-only failover Worker (F1.7)

> **Status:** skeleton (algorithm + KV shape). Wired to real tenants by **F3**'s
> provisioner. Outside the npm workspace; **not part of any Next build**.

The single canonical failover mechanism for the deploy-per-tenant model
([`../../docs/PLATFORM.md`](../../docs/PLATFORM.md) §4 / build-rule #25): a free
Cloudflare Worker that **health-polls** each tenant's `/api/health` and, on sustained
failure, **swaps the tenant's Cloudflare-proxied DNS record** to the warm-standby
`*.vercel.app` origin — and fails back when the active recovers.

## Why this shape
- **Controller-only.** A cron health-check + origin swap (dozens of invocations/day),
  **never** a per-request reverse proxy — that would blow the free **100K req/day** cap
  on a busy cafe and make the Worker a SPOF that dies at the 00:00 UTC reset.
- **Proxied origin swap, not a domain re-attach.** Both Vercel deploys are addressed by
  their **bare `*.vercel.app` origins** (no Vercel custom-domain attach on either) →
  **no SSL re-issue window**, no "domain linked to another account" conflict. The
  `removeDomain`/`addDomain` path is a slow manual fallback only.
- **The only `#26`-legal always-on periodic trigger** in the whole system (no cafe
  Vercel cron). **P13-PUSH** later rides this same cron.

## Algorithm (hysteresis, no flapping)
- Poll ~45–60s. Flip active→standby after `N_FAIL = 3` consecutive misses; flip back
  only after `M_RECOVER = 5` consecutive active recoveries.
- A tenant is **healthy** when `/api/health` returns HTTP 200 with the F1.5 contract
  `{ ok: true, db: "up" }`.
- `swapOrigin` = **one** Cloudflare API call (PATCH the proxied DNS record's content),
  effective at the edge in seconds.

## KV state (key = `tenantId`)
```jsonc
{ "zoneId", "recordId", "activeOrigin", "standbyOrigin", "current", "failCount", "recoverCount" }
```

## Open spike before production wiring (PLATFORM.md §4)
Confirm a CF-proxied hostname → bare `*.vercel.app` origin serves with **no
host-header/SNI/SSL errors** (Vercel may need a `Host` rewrite at the edge). If it
does, the whole failover is free.

## F3 wiring
1. `npm i -D wrangler @cloudflare/workers-types` (here).
2. Create the KV namespace; set `FAILOVER_STATE.id` in `wrangler.jsonc`.
3. `wrangler secret put CF_API_TOKEN` (scoped to edit the proxied DNS record only).
4. Seed one `TenantFailoverState` per tenant; `wrangler deploy`.
5. Local test: `wrangler dev`, then hit the Worker URL to run one poll; with a stubbed
   unhealthy active it swaps to standby after 3 misses (and back after 5), no per-request
   proxying, **no SSL re-issue**.

## Data-DR caveat
This covers **COMPUTE** only. Both active + standby point at the **same** data pool, so
it does NOT protect against an M0 fill / auto-pause / no-backup loss — that's **F2**
(sharding, nightly `mongodump`, keep-alive ping).
