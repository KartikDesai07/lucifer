---
name: migration-target
description: Final target architecture — Next.js 15 App Router + MongoDB Atlas + Cloudinary + Vercel (all free)
metadata:
  type: project
---

# Migration Target (FINAL — Locked)

## Tech Stack Decision

**Previous plan:** React (Vite) + Express + MongoDB  
**Final decision:** Next.js 15 App Router + MongoDB Atlas + Cloudinary + Vercel

**Why the change:**
- Vercel is the hosting choice — Next.js is Vercel-native (same company)
- No CORS, no separate server deployment, single `vercel deploy`
- Auth.js v5 is designed for Next.js App Router
- API Routes (Route Handlers) replace Express — same patterns, serverless-native
- User confirmed: "Next me bhi build kar sakte ho"

## Final Stack

| Layer | Technology | Free Tier |
|-------|-----------|-----------|
| Framework | Next.js 15 App Router | ✅ |
| Hosting | Vercel Hobby Plan | ✅ |
| Database | MongoDB Atlas M0 | ✅ |
| Auth | NextAuth.js v5 (Auth.js) | ✅ |
| Images | Cloudinary (unsigned upload) | ✅ |
| Cache (backend) | node-cache (in-process) | ✅ |
| Cache (frontend) | TanStack Query v5 | ✅ |
| Validation | Zod (schemas in /schemas/) | ✅ |
| UI | shadcn/ui + Tailwind CSS 4 | ✅ |
| Printing | react-to-print v3 | ✅ |
| **Total Monthly Cost** | | **₹0** |

## Key Constraints

- Vercel serverless timeout: 10s — all API routes must complete in < 8s
- MongoDB M0: global connection cache required (lib/db.ts global mongoose)
- Cloudinary: 25 credits/month — use `q_auto,f_auto` to minimize transformations
- No Redis — node-cache (in-process) sufficient for single Vercel instance

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
