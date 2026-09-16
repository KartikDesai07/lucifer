# PLATFORM.md — POS Software v2: the honest free-tier verdict, topology, hosting & failover

> The durable platform artifact (Phase **F1**). It records — in writing, so no one later
> markets literal "lifetime-free" or silently relies on a violated ToS — the economics/ToS
> verdict, the three-plane topology, the chosen hosting tier and its failover mechanics, the
> per-tenant provisioning contract, and the owner-review flags. Decisions are grounded in
> `00-architecture-decisions.md` (§1–§11) + the F1 phase file + `SCOPE-v2.1-web-only-free.md`.
> Structure/monorepo lives in [`STRUCTURE.md`](STRUCTURE.md).

---

## 1. The honest economics / ToS verdict (READ FIRST)

**"Lifetime-free for many _paying_ cafes" is NOT literally achievable.** Three independent
provider ToS legs were red-teamed against live 2026 terms; each is an express, named
restriction, not a gray area. We keep the **storage-bound layers genuinely ₹0** and accept
that **compute hosting** is the one place "free + commercial-OK + Mongoose-compatible +
always-on" cannot all hold at once. Market it as **"free to start, a tiny fee only if it
grows"** — never literal lifetime-free. ₹0 is **to the OWNER** (the client owns the free
accounts); the client can still hit suspension / credit / fill walls.

| Leg | The hard truth (cited verbatim) | Verdict |
|-----|---------------------------------|---------|
| **Vercel Hobby** | *"Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan,"* and commercial usage includes *"any method of requesting or processing payment from visitors"* **and** *"receiving payment to create, update, or host the site,"* counting *"a paid employee or consultant writing the code."* Vercel may suspend *"with or without notice."* ([fair-use-guidelines](https://vercel.com/docs/limits/fair-use-guidelines)) | A paid cafe POS triggers it **three** ways (POS processes payments / owner paid to host / paid coder built it). Owner-accepted **soft** leg; mitigated by client-owned accounts + disclosure. Confirmed standing on docs last-updated **2026-06-16**. |
| **Cloudinary multi-account** | AUP §4.1: *"opening multiple accounts to … gain additional storage or usage across a number of accounts is … prohibited;"* §7.2: on suspension *"all associated data and content may be permanently deleted."* ([Cloudinary AUP](https://cloudinary.com/trust/aup)) | **No compliant pooling path; real data-deletion risk to a live cafe.** Use **R2** (or ONE Cloudinary per cafe), never pool. |
| **Atlas M0 multi-cluster** | One org holds **250 projects × one free M0 each** ([atlas-limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)) — structurally within per-project limits, fully API-creatable. Soft residual: MSA §7(b)(iii) *"intent to avoid incurring fees,"* blunted by a **data-lifecycle** (not fee-evasion) framing. ([MongoDB Cloud ToS](https://www.mongodb.com/legal/terms-and-conditions/cloud)) | **Most defensible leg; viable.** |

**Re-validated 2026 (the nuance, not a softening):** Cloudflare's `mongodb` driver now
*connects* on Workers (`nodejs_compat`) but **still cannot reuse the TCP socket cross-request**
(the v1 *"Cannot perform I/O on behalf of a different request"* blocker is architectural). A
reused connection would need a self-built Durable-Object Mongo pool + a full `lib/db.ts`
rewrite + a sub-3 MiB OpenNext bundle — **NOT viable under free-for-life today.** Hyperdrive
excludes MongoDB; the Atlas Data API was **EOL'd 30 Sep 2025**. → **Stay on Vercel.**

**Owner's commercial model:** one-time **~₹10–15k per client**, everything under the client's
own free-tier accounts (their email) → **₹0 ongoing infra to the owner** + 3 months free
support. **Operational honesty:** the federation needs a **perpetual owner-run Hub**
(paste-and-Connect cluster adds, by-hand failover fallback, fill migrations) — "₹15k then ₹0"
is true on **cash**, not on **ops**. Decide unpaid-ops vs a small maintenance fee **before
selling** (owner flag, §7).

---

## 2. The three-plane topology

```
                       ┌────────────────────────────────────────────┐
   OWNER ONLY  ───────▶│  CONTROL PLANE ("Hub")  apps/hub (F3)        │
   (super-admin)       │  own Vercel + own free M0 "registry" cluster │
                       │  • Tenant/Chain/HubUser registry + vault     │
                       │  • Provisioner (Atlas/Vercel/CF APIs)        │
                       │  • Monitoring (self-report heartbeats)       │
                       │  • Hot-add cluster / failover / backup orch. │
                       └───────────────┬────────────────────────────┘
                          resolves config, NEVER in a cafe request path
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                               ▼
   TENANT RUNTIME (per cafe)      DATA POOL (per cafe)            IMAGE POOL (per cafe)
   apps/cafe (Next.js POS)        Atlas org under client email    Cloudflare R2 bucket
   resolves host→tenant,          • CORE cluster (reference/CRM)  • tenant/<id>/ prefix
   connects via ClusterRouter     • LEDGER cluster(s) (orders,    • commercial-OK, no
   (lib/db.ts seam, F2)             time-sharded, add via Hub)      transform-credit meter
```

- **Hub is DECOUPLED from the request path** — a Hub outage must never stop a cafe billing;
  each runtime carries its resolved config in env. Detection of an outage is **active edge
  polling** (decision 5), not Hub-pushed events: Vercel deployment **webhooks are lossy**
  (*"retries webhooks 5 times over approximately 6 hours, but after retries are exhausted,
  events are permanently lost"* — [Vercel Webhooks API](https://vercel.com/docs/webhooks/webhooks-api)).
- **Physical isolation = no `tenantId` inside a cafe's data** (cross-tenant leak is impossible
  by construction; build-rule #30). The whole cluster pool IS that cafe.

---

## 3. Hosting decision — **Tier B** (primary), Tier A = documented escape only

Under the free-for-life rule the product **ships Tier B**. Tier A is a documented escape
**only — not built, not marketed.** `DATA + images stay ₹0 in both tiers`; the runtime is
built **tier-agnostic** (middleware resolves `x-tenant-id` identically) so the escape needs
no rewrite.

### Tier B — deploy-per-tenant (the shipped model)
Each cafe on its **own** free Vercel account (under the cafe's email) — **active + warm
standby** ("2 servers, 1 backup"), with **free Cloudflare-proxied edge-origin-swap failover**.
Hobby per-account capacity is ample for one cafe (*"200 projects, 100 deployments/day, 50
custom domains/project, 1000 env vars / 64 KB"* — [Vercel Limits](https://vercel.com/docs/limits)),
and the **real Node runtime** keeps v1's global Mongoose cache (`lib/db.ts`) working — the
exact thing Cloudflare Workers broke in v1.

**Honest caveats (baked in):**
- (a) Hobby commercial-ToS risk **× N cafes**, mitigated only by *the client owning the
  account* (risk legally sits with the client). The red-team verdict is blunt: the owner
  operating N Hobby accounts is "a deliberate, repeated ToS violation, multiplied by N."
- (b) The standby lives in a **separate** account so a flag on one doesn't take both — but the
  same code+usage pattern (and the always-on `/api/health` pings) can flag **both** together,
  so standby is **best-effort, not a guarantee**.
- (c) **N manual signups** is the irreducible bottleneck (decision §6 / the automation boundary).
- **Disclosure obligation (mandatory):** the cafe must be told **in writing** (onboarding/
  contract) that their deployment runs on a non-commercial Hobby plan that may be suspended.
  "Risk sits with the client" is only honest if it is disclosed, not silently transferred.

### Tier A — one shared paid app (escape ONLY — not built, not marketed)
ONE deployment, multi-tenant by host→tenant registry, on a commercial-OK host. A single
**Vercel Pro plan ($20/mo flat)** legitimizes commercial use, and **Fluid compute keeps ≥1
warm instance** so the module-level Mongoose connection is reused (*"zero cold starts for
99.37% of all requests … connection pools … initialized at module level … benefit from reuse"*
— [scale-to-one](https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts)). A *free*
commercial-OK Node-runtime always-on host that ALSO reuses the Mongoose socket basically does
not exist (CF Workers' per-request I/O isolation broke it; the [Data API shut down 2025-09-30](https://www.mongodb.com/docs/atlas/app-services/data-api/data-api-deprecation/);
[Hyperdrive is Postgres/MySQL only](https://developers.cloudflare.com/hyperdrive/)). So the
escape, if taken, is Vercel Pro $20/mo (all cafes) or a ~$5/mo VPS ([Hetzner CX22 €3.79/mo](https://www.hetzner.com/cloud/)).

**Rejected:** Render free (15-min spin-down, 30–60s cold start — unacceptable for a POS,
[Render free](https://render.com/docs/free)); Netlify free (suspends on credit overage).

---

## 4. Failover — ONE mechanism: Cloudflare-proxied edge-origin-swap (free)

**Why not the obvious alternatives:** a Vercel custom domain attaches to **only one account at
a time** ([Vercel KB](https://vercel.com/kb/guide/domain-linked-to-another-account)) — you
physically cannot pre-bind `cafe.platform.com` to both Hobby accounts, so the edge-swap is
**mandatory regardless of tier**. Cloudflare Load Balancing health-check failover is **paid
($5/mo)** ([LB docs](https://developers.cloudflare.com/load-balancing/)) — rejected for the ₹0
mandate.

**The free path:** the cafe's customer-facing hostname is a Cloudflare-**proxied (orange-cloud)**
record; both Vercel deployments are addressed by their **bare `*.vercel.app` origins** (no
Vercel custom-domain attach on either → **no SSL re-issue window**, no "domain linked"
conflict). A free **Workers cron** (100,000 req/day, commercial-use OK —
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) health-polls
`/api/health` and, on failure, **swaps the origin at the edge** (*"changes … take effect
globally within 5 minutes, usually much less"*, no resolver-TTL wait —
[proxy-status](https://developers.cloudflare.com/dns/proxy-status/)).

**Critical trade-off — controller-only:** the Worker is a **cron health-check + origin swap**
(dozens of invocations/day), **never a per-request reverse proxy** (that would blow the
100K/day cap on a busy cafe and make the Worker a SPOF that dies at the 00:00 UTC reset).
Steady-state traffic rides the proxied DNS/Origin-Rule path with **zero per-request Worker
cost**.

- **Hysteresis:** flip active→standby after `N_FAIL=3` consecutive failures; flip back after
  `M_RECOVER=5` successes (no flapping). Poll ~45–60s.
- **`swapOrigin` = one Cloudflare API call** — `PATCH` the proxied DNS record's `content`
  (DNS API) **or** the single Origin-Rules ruleset's origin override — to the healthy
  `*.vercel.app` origin.
- Per-tenant KV value: `{ zoneId, recordId|rulesetId, activeOrigin, standbyOrigin, current,
  failCount, recoverCount }`.
- **F3's `removeDomain`/`addDomain` is a SLOW manual fallback only**, not the primary path
  (build-rule #25).
- **Open spike before building this:** confirm a CF-proxied hostname → bare `*.vercel.app`
  origin serves without host-header/SNI/SSL errors (Vercel may need a `Host` rewrite at the
  edge). If it does, the whole failover is free.
- **Compute-only:** failover covers COMPUTE; both active+standby point at the **same** data
  pool, so it does **not** protect against an M0 fill/auto-pause/no-backup loss. Data
  resilience (sharding, nightly `mongodump`, keep-alive ping) is **F2**. (Skeleton Worker:
  `workers/failover/` — F1.7.)

Implementation skeleton lives in [`../workers/failover/`](../workers/failover/) (controller
algorithm + KV shape; wired to real tenants by F3's provisioner).

---

## 5. Tenant routing & "client owns it"

- **Subdomain-per-cafe, resolved from the host header** (Next.js's officially recommended
  multi-tenant pattern — [Next.js multi-tenant](https://nextjs.org/docs/app/guides/multi-tenant),
  ref impl [vercel/platforms](https://github.com/vercel/platforms)). Subdomain = a separate
  origin per tenant = the cleanest cookie/session isolation for a money app.
- **Host-only session cookies — do NOT set a `.app.com` cookie domain** so tenant A's session
  cookie physically cannot reach tenant B's origin ([next-auth #2414](https://github.com/nextauthjs/next-auth/issues/2414)).
- Custom domains via **Cloudflare for SaaS — 100 custom hostnames free**, then $0.10/hostname/mo
  ([CF for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)).
- In Tier B each deployment is single-tenant, so `x-tenant-id` is the deployment's configured
  `TENANT_ID`; the routing layer is built tier-agnostic so a Tier-A switch needs no rewrite
  (F1: `lib/tenant.ts`, `middleware.ts`, `lib/platform.ts`).
- **"Client owns it":** every free account is created under the cafe's own email — one Atlas
  org per cafe, the cafe's own R2, and in Tier B **TWO** of the cafe's own Vercel accounts
  under **two distinct emails** (active + standby — build-rule #27).

---

## 6. Per-tenant provisioning + edge-setup contract (the runbook) — F1.8

**The automation boundary (state it everywhere):** creating a brand-new free *account*
(Vercel/Atlas/Cloudflare signup — email + captcha + increasingly phone/CC anti-abuse) is the
**ONE irreducible manual step**. **Everything after a token exists is API-automated.** The F3
panel makes the manual step a ~60-second guided paste; Atlas's 250-projects/org ceiling
minimizes its frequency.

Idempotent per-tenant provisioning order (each step is check-then-create + persisted, so it is
**resumable**; honor Atlas `429 Retry-After`):

| # | Step | Manual / API | Owner |
|---|------|--------------|-------|
| 1 | Create the cafe's free accounts: 2× Vercel (active+standby, 2 emails), 1× Atlas org, 1× Cloudflare/R2 | **MANUAL** (signup) | owner via panel |
| 2 | Store the resulting tokens in the Hub **vault** (AES-256-GCM) | API | Hub (F3) |
| 3 | Atlas: create project → M0 (CORE) → DB user → `0.0.0.0/0` access-list → conn-string | API | Hub provisioner (F2/F3) |
| 4 | Vercel: create project ×2 → push env set (`MONGODB_URI`, `AUTH_SECRET`, `TENANT_ID`, R2 vars, `ROOT_DOMAIN`) → deploy both | API | Hub provisioner (F3) |
| 5 | Verify each deployment's `/api/health` returns `200 {ok:true,db:"up"}` | API | Hub |
| 6 | Cloudflare: create the **proxied** hostname → set origin = active `*.vercel.app` | API | Hub / failover Worker (F3) |
| 7 | Register the tenant in the Hub registry (subdomain, origins, dbPool, imagePool, branding) | API | Hub (F3) |
| 8 | Seed the working POS (admin + menu via `/api/products/import`) | API | Hub onboarding (F3) |

**Atlas key scoping (build-rule #28):** ORG-scoped *Project Creator* (NOT Org-Owner) for
`createProject`; PROJECT-scoped `GROUP_OWNER` for in-project ops. KEK lives in the Hub host
env ONLY, never in the DB.

**Hot-add a free account (growth):** when a cluster nears full, the owner pastes
`{connstring,user,pass}` into the panel → validate-gate → AES-256-GCM-encrypt → idempotent
upsert (fingerprint of `{host,db,user}`) → the live CORE registry → the router routes new
writes there with **no redeploy** (details: F2 §data + F3 provisioner). Prompt at ~70%,
hard-stop new placement at ~85%, keep one pre-armed warm standby.

`SETUP.md` (the step-by-step config guide + setup wizard, task.md CODE 11) is **F3**'s
deliverable; this runbook is what F3 implements against.

---

## 7. Owner-review flags — F1.9 (decisions §11; surfaced for sign-off)

The four `00 §11` decisions were RESOLVED 2026-06-25 at the recommended default; re-stated
here as the explicit F1 checklist. **Standing owner-decisions to confirm before go-live:**

- [ ] **(1) Hosting tier — Tier B [default] vs Tier A.** RESOLVED → **Tier B** (deploy-per-tenant,
      active+standby, free CF edge-failover). Tier A = documented escape only (not built/marketed).
      *Re-confirm acceptance of the re-validated non-commercial caveat.*
- [ ] **(2) Images — R2 [recommended] vs single-Cloudinary.** RESOLVED → **Cloudflare R2** (decided
      in F2; flagged here). Pooled Cloudinary rejected (AUP §4.1/§7.2 deletion risk).
- [ ] **(3) "Client owns it" granularity — one Atlas org per cafe [default] vs one platform org.**
      RESOLVED → **one Atlas org per cafe** (1 manual signup/cafe, then ~250 free M0s via the Admin API).
- [ ] **(4) Client pricing framing.** RESOLVED → **"Free to start, a tiny fee only if it grows"** —
      one-time ~₹10–15k under the client's own accounts; paid-upgrade triggers disclosed up front;
      **never** marketed as literal lifetime-free.

**Additional operational decisions to make _before selling_ (do not block F1):**
- [ ] **Post-3-month ops:** keep running the Hub as unpaid ongoing ops, OR charge a small recurring
      maintenance fee / hand over a self-serve runbook (§1 — "₹0 on cash, not on ops").
- [ ] **iOS web-push:** accept that iOS push works only from a home-screen-added PWA on 16.4+, and the
      sole no-native fallback is a lazy-on-open in-app alert (no guaranteed delivery). (P13.)
- [ ] **wa.me-only messaging:** the free product has NO automated/scheduled/bulk/delivery-confirmed
      messaging — every send is a manual human wa.me tap. (P5.)

---

## 8. Paid-upgrade exits (documented up front — don't pretend they don't exist)

In cost order: (a) Tier B → **Vercel Pro $20/mo** (one plan, all cafes, ToS-clean, keeps
Node/Mongoose) or a **~$5/mo VPS** (Hetzner CX22 €3.79/mo); (b) Atlas M0 fleet → a shared
**M10 (~$57/mo for all cafes)** or self-hosted Mongo on the same VPS; (c) image store stays ₹0
longest (R2 10 GB free, commercial-OK). Per-cafe blended cost falls as you scale and is *a
rounding error vs PetPooja's ₹10k–30k/yr* ([PetPooja pricing](https://www.dineopen.com/blog/petpooja-review-2026)).

---

## 9. F1 acceptance — what this doc + the F1 code satisfy

- **CODE 4** (free-tier setup, never-down, no user-facing gaps) — the honest verdict + 3-plane
  topology + active/standby failover + paid-exit framing (never markets literal lifetime-free).
- **CODE 7** (easy deploy + all service setup) — the §6 provisioning runbook + automation boundary.
- **CODE 8** (sell to many; each logs in with their own email, free, fast) — the "client owns it"
  model + subdomain routing + per-cafe auth, with the honest ToS caveat attached.
- **CODE 10** (optimized both sides) — the runtime choice that keeps the warm Mongoose connection,
  the `ClusterRouter` seam, the controller-only Worker.
- **Impl 11 (security base)** — physical tenant isolation, host-only cookies, host-scoped login
  guard, edge-safe middleware (no Mongoose on Edge). Full Z+ hardening = F3/F5.
- **PetPooja M1 (setup) — partial** (platform/topology/hosting/routing half; the wizard + seed +
  `SETUP.md` land in F3).
