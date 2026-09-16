# Monorepo Structure — POS Software v2 (CODE 3 / build-rule #31)

> The locked two-app monorepo layout: the **cafe runtime** + the **owner Hub**
> share one **`packages/shared`** spine with **no duplication**. This is the
> auditable deliverable for task.md **CODE 3** ("proper folder structure with
> common reusable code") and **build-rule #31**.
>
> Authored in Phase **F1**. See [`PLATFORM.md`](PLATFORM.md) for the platform/
> hosting/federation decisions, and `.claude/plan/v2/BUILD-ORDER.md` for the
> phase sequence.

---

## 1. Layout

```
pos-software/                              ← monorepo root (npm workspaces)
├── package.json                      ← workspaces: ["apps/*", "packages/*"]; root scripts proxy to apps/cafe
├── .gitignore                        ← monorepo-wide (non-anchored) ignore patterns
├── apps/
│   ├── cafe/                         ← the v1 POS runtime (relocated verbatim from the repo root)
│   │   ├── app/  components/  hooks/  models/  scripts/  public/
│   │   ├── lib/                      ← cafe-only server wiring + re-export shims (see §3)
│   │   ├── schemas/                  ← 2 re-export shims (index barrel + staff.schema)
│   │   ├── types/                    ← 1 re-export shim (index)
│   │   ├── middleware.ts  auth.config.ts  next.config.ts
│   │   ├── components.json  postcss.config.mjs  eslint.config.mjs
│   │   ├── tsconfig.json             ← @/* → ./*   (all 641 existing @/ imports keep resolving)
│   │   ├── .env.local  .env.example  (gitignored; Next + seed scripts read them here)
│   │   └── package.json              ← name "@pos/cafe"; depends on "@pos/shared": "*"
│   └── hub/                          ← owner control plane — PLACEHOLDER (built in F3)
│       ├── src/placeholder.ts        ← proves it reuses @pos/shared (deleted in F3)
│       ├── tsconfig.json  README.md
│       └── package.json              ← name "@pos/hub"; depends on "@pos/shared": "*"
├── packages/
│   └── shared/                       ← THE single source of truth for reused code
│       ├── src/
│       │   ├── constants.ts          ← enums, GST rates, roles, timezone, auth timings
│       │   ├── utils.ts              ← cn, inr, escapeRegex, date/cafe-tz helpers
│       │   ├── query.ts              ← TanStack STALE_TIMES / GC_TIMES / REFETCH_INTERVALS
│       │   ├── cache.ts              ← in-process Map TTL cache (+ TTL map)
│       │   ├── api-client.ts         ← client fetch wrapper (apiGet / apiSend)
│       │   ├── api.ts                ← API response envelope (success/created/failure/…/validateBody)
│       │   ├── product-import.ts     ← pure CSV-import helpers (coerce/normalize/template)
│       │   ├── create-crud-hooks.ts  ← "use client" CRUD hook factory
│       │   ├── schemas/              ← all Zod schemas + inferred Input types (the codec lands here in P1, #39)
│       │   ├── types.ts              ← client-facing entity + analytics interfaces
│       │   └── index.ts              ← barrel ("." export)
│       ├── package.json              ← name "@pos/shared"; exports map to ./src/*.ts
│       └── tsconfig.json
├── workers/
│   └── failover/                     ← Cloudflare failover Worker (F1.7) — NOT part of any Next build
└── docs/
    ├── STRUCTURE.md  (this file)
    └── PLATFORM.md
```

Internal docs (`.claude/`, `.claude-memory/`, `CLAUDE.md`, `self-tasks/`) stay at the
repo root and are gitignored (kept on disk only).

---

## 2. Tooling decisions (owner-confirmed)

- **Package manager / workspaces: npm workspaces** (owner decision, 2026-06-29). Matches
  the live npm + Vercel setup — no new tool, one root `package-lock.json`, Vercel's npm
  build unchanged. (The plan's "pnpm/turbo" was written before the repo's npm reality;
  Turborepo can be layered later if build caching is ever needed — not for a 2-app repo.)
- **Layout: the v1 app relocated into `apps/cafe/`** (owner decision) so `apps/cafe` +
  `apps/hub` are symmetric siblings of `packages/shared` (#31). Each app keeps its own
  `tsconfig.json` with `@/* → ./*`, so **all existing `@/…` imports resolve unchanged**.
- **Vercel impact:** the only deploy-time change is the project **Root Directory →
  `apps/cafe`** (applied when we next deploy — gated on owner approval; nothing was deployed
  in F1). `DATA + images stay ₹0`; the runtime stays tier-agnostic (PLATFORM.md decision 6).

---

## 3. The shared boundary — how "no duplication" is achieved

`packages/shared` holds the **single source of truth**. The cafe consumes it two ways:

1. **Direct package imports** — new code (and the Hub) import `@pos/shared/<module>`.
2. **Re-export shims** — every relocated module left a 1-line shim at its old `@/…` path
   (e.g. `apps/cafe/lib/utils.ts` → `export * from "@pos/shared/utils"`), so the v1
   app's **641 `@/…` imports keep working with zero churn**. The logic lives ONLY in
   `packages/shared`; the shim is a pointer, not a copy.

**Resolution mechanism:** `packages/shared` ships **raw TypeScript** (no build step). Its
`package.json` `exports` map points `@pos/shared/<x>` → `./src/<x>.ts`; the cafe's
`next.config.ts` lists `transpilePackages: ["@pos/shared"]` so Next compiles it as
first-party source; TypeScript's `moduleResolution: "bundler"` + the npm-workspace symlink
(`node_modules/@pos/shared` → `packages/shared`) resolve it for `tsc` and `tsx` alike.

### What lives where

| Concern | Home | Why |
|---|---|---|
| Zod schemas + inferred types | **shared** `src/schemas/` | the validation contract both apps share; the **Zod codec lands here in P1** (#39) |
| Constants / utils / query / cache / api-client / product-import | **shared** `src/` | isomorphic, zero inverted deps |
| API response envelope (`success`/`failure`/`validateBody`/…) | **shared** `src/api.ts` | both apps speak the same CLAUDE.md §7 envelope |
| CRUD hook factory (`createCrudHooks`) | **shared** `src/create-crud-hooks.ts` | client-only, `"use client"`; import via the subpath (kept out of the barrel) |
| Client-facing entity/analytics types | **shared** `src/types.ts` | shared shapes over the wire |
| Auth guards (`requireAuth`/`requireAdmin`) | **cafe** `lib/api-helpers.ts` | depend on the cafe's own NextAuth instance (`@/lib/auth`) — app-specific. Re-export the shared response half so call sites are unchanged |
| `lib/db.ts`, `lib/auth.ts`, `auth.config.ts`, `models/*` | **cafe** | app-specific (own connection, own Staff model, own auth flow). The Hub gets its OWN versions in F3 |
| `lib/crud-route.ts` | **cafe** (for now) | imports `connectDB` (server-only). **Deferred to `shared` in F3** when the Hub needs CRUD routes (parameterize the connection — see the shared-spine map) |
| `lib/cloudinary.ts`, `lib/images.ts`, `lib/order.ts`, `lib/receipt.ts`, … | **cafe** | cafe feature code |

### Deferred extractions (named, not forgotten — build-rule #34)
- **`lib/crud-route.ts` → shared** when F3's Hub needs generic CRUD routes (inject the DB
  connection so it stops importing the cafe's `connectDB`).
- **`lib/codec.ts` (NEW) → `packages/shared`** is **P1**'s job (build-rule #39): the
  `transform`/`coerceForWrite` hooks on `crud-route` + the paise↔₹ / ObjectId / `v` codec,
  co-located with the schemas already in shared.
- **`staff.schema`** physically lives in shared today (pure Zod), but the Hub will have its
  OWN staff/auth model — revisit if the Hub's staff shape diverges.

---

## 4. Build / verify (this dev box has ~7.7 GB RAM)

A full `next build` **compiles** fine but its combined type-check+lint worker **OOMs locally**
(works on Vercel). On this box, verify each step with the checks run **separately**:

```bash
# from repo root
npm run lint  --workspace apps/cafe                       # eslint (light)
( cd apps/cafe       && NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit )
( cd packages/shared && npx tsc --noEmit )                # also checks the barrel
( cd apps/hub        && npx tsc --noEmit )
```

Do **not** set `typescript.ignoreBuildErrors` / `eslint.ignoreDuringBuilds` to dodge the
local OOM — that would mask real errors in the production (Vercel) build.

---

## 5. CODE 3 — satisfied

- Two apps + one shared package, **npm workspaces**, no duplication. ✔
- The reused v1 spine (`api-helpers` response half, `create-crud-hooks`, `schemas`, the
  codec home, constants/utils/query/cache/api-client/product-import) lives once in
  `packages/shared` and is consumed by **both** `apps/cafe` (via shims) and `apps/hub`
  (directly — proven by `apps/hub/src/placeholder.ts`). ✔
