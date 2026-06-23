---
name: migration-target
description: Final target architecture — Next.js 15 App Router + MongoDB Atlas + Cloudinary + Cloudflare Workers (all free, commercial OK)
metadata:
  type: project
---

# Migration Target (FINAL — Locked)

## Tech Stack Decision

**Previous plan:** React (Vite) + Express + MongoDB  
**Final decision:** Next.js 15 App Router + MongoDB Atlas + Cloudinary + **Cloudflare Workers**

**Why Cloudflare Workers (not Vercel):**
- Vercel Hobby plan **explicitly prohibits commercial use** — a restaurant POS is commercial (3-0 confirmed)
- Cloudflare Workers free tier: 100k req/day, commercial use explicitly allowed
- Project already deploys on CF Workers (`wrangler.jsonc` exists in repo)
- No cold starts (V8 isolates) — critical for POS responsiveness
- `nodejs_compat` flag enables TCP → Mongoose works normally

**Why Next.js:**
- Single codebase (API Routes + UI), no CORS
- Auth.js v5 designed for Next.js App Router
- User confirmed: "Next me bhi build kar sakte ho"
- Deploys to CF Workers via `@cloudflare/next-on-pages`

## Final Stack

| Layer | Technology | Free Tier |
|-------|-----------|-----------|
| Framework | Next.js 15 App Router | ✅ |
| Hosting | **Cloudflare Workers + Pages** | ✅ — 100k req/day, commercial OK |
| Database | MongoDB Atlas M0 | ✅ |
| Auth | NextAuth.js v5 / Auth.js v5 | ✅ |
| Images | Cloudinary (signed upload via API route) | ✅ — 25 credits/month |
| Cache (backend) | node-cache (in-process) | ✅ |
| Cache (frontend) | TanStack Query v5 | ✅ |
| Validation | Zod (schemas in /schemas/) | ✅ |
| UI | shadcn/ui + Tailwind CSS 4 | ✅ |
| Printing | react-to-print v3 | ✅ |
| **Total Monthly Cost** | | **₹0** |

## Key Constraints

- Cloudflare Workers: add `nodejs_compat` to `wrangler.jsonc` for Mongoose TCP support
- MongoDB M0: global connection cache required (lib/db.ts global mongoose)
- MongoDB M0: 500-connection ceiling, 100 ops/sec throttle — maxPoolSize: 10
- Cloudinary: 25 credits/month (1 credit = 1,000 transformations OR 1GB storage OR 1GB bandwidth) — use `q_auto,f_auto`
- No Redis — node-cache (in-process) sufficient for single CF Worker instance
- Auth.js v5: RBAC is developer's responsibility — no built-in role system; verify patterns against current authjs.dev docs

## Features to Build

Core (Phase 0-9):
- Admin + Staff auth (role-based)
- POS Terminal with cart, payment modes, table selection
- Menu management (products + categories + modifiers + Cloudinary images)
- Order management with live status
- Customer CRM (visit + spend tracking)
- Table management (T-1 to T-8, live status)
- Staff management (admin only)
- Reservations + Event bookings
- Dashboard (daily sales, payment breakdown, top products)
- Reports (date range, product-wise, customer dues, CSV export)
- Billing + thermal receipt printing (80mm)
- KOT (Kitchen Order Ticket)
- Settings (restaurant info, GST, receipt header)

## Implementation Phases

See `.claude/plan/README.md` for full 10-phase breakdown.
Current status: All plans written. Phase 0 ready to start.

**How to apply:** When user says "start", begin Phase 0. Read phase file completely before coding. One step at a time. Checkpoint before proceeding.
