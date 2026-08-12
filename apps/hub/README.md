# @pos/hub — Owner Control Plane

> **Status:** F3.1 landed — the app skeleton + the registry connection + the
> registry models. The vault, provisioner, panel auth, monitoring, and onboarding
> are the later F3 steps (see `.claude/plan/v2/phase-F3-control-plane-provisioning.md`).

The owner-only **control plane** of the POS Software federation — a separate
Next.js + Mongoose app on the owner's own free account, backed by its **own free
M0 "registry" cluster**, that **resolves/manages config but is NEVER in a cafe's
request path** (a Hub outage must never stop a cafe billing —
`00-architecture-decisions.md` §2).

## Landed in F3.1
- **`lib/db.ts`** — the Hub's own global-cached Mongoose connection to the registry
  M0 (`HUB_MONGODB_URI`). Single-cluster, v1-style cache — NOT the cafe's F2
  multi-cluster router (the registry is one tiny doc-per-cafe cluster).
- **`models/Tenant.ts`** — the registry doc (`hosting[]` active/standby, `dbPool[]`
  with encrypted-URI *refs*, `imagePool[]`, `domain`/`routing`, idempotent
  `provisioning` state) + the **P8-G** additive grouping block (`chainClientId`,
  `royalty`, `consolidation`, …).
- **`models/AuditLog.ts`** — append-only, TTL-free audit (`ts` is the created-at).
- **`models/HubUser.ts`** — the single `role:'owner'` auth store (WebAuthn/TOTP in
  F3.4) + the **P8-G** franchise-principal fields.
- **`models/Chain.ts`** — the **P8-G** registry grouping collection (a chain is a
  Hub-registry grouping ONLY — no `tenantId`/`chainId` in any cafe doc, #30).
- **`app/`** — a minimal skeleton (root layout + landing + `/api/health`). The
  gated console is F3.4+.
- **`scripts/seed-hub-user.ts`** — idempotent owner-seed (`npm run seed:hub-user`).

Secrets are **never** inlined in `Tenant` — pool docs hold `*Ref` ObjectIds into
the `Secret` collection; the `Secret` model + the AES-256-GCM vault are **F3.2**.

## Setup (per SETUP.md, authored in F3.15)
1. Create the Hub's own free Atlas M0 registry cluster + a free Vercel project
   (both under the owner's master account — separate from any cafe).
2. `cp .env.example .env.local`, set `HUB_MONGODB_URI` + `HUB_OWNER_EMAIL`.
3. `npm run seed:hub-user --workspace apps/hub` → seeds the owner `HubUser`.

## Verify (this dev box — see `docs/STRUCTURE.md` §4; `next build` OOMs locally)
```bash
npm run lint --workspace apps/hub
( cd apps/hub && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit )
npm run test --workspace apps/hub          # DB-free model/db guards
```

## What F1 locked (unchanged)
- This app's place in the **two-app monorepo** (`apps/cafe` + `apps/hub` +
  `packages/shared`) and that the Hub **reuses `@pos/shared`** with no duplication
  (CODE 3 / build-rule #31) — now proven by real imports (`APP_NAME`) rather than
  the deleted `src/placeholder.ts`.

See [`../../docs/STRUCTURE.md`](../../docs/STRUCTURE.md) and
[`../../docs/PLATFORM.md`](../../docs/PLATFORM.md).
