# POS Software

A single-restaurant Point-of-Sale and management system — PetPooja-style feature
scope, built to run entirely on free tiers. One admin plus any number of staff
share a single data pool (no multi-tenancy).

> **Internal source of truth:** [`CLAUDE.md`](./CLAUDE.md) holds the locked
> architecture, conventions, and phase plan; the v2 multi-client rebuild is
> planned phase-by-phase in [`.claude/plan/v2/`](./.claude/plan/v2/) (tracked in
> `.claude-memory/v2_plan.md`). As of 2026-06-28 every phase **P1–P13 is
> deep-planned + red-teamed**, and v2 is re-scoped **web-only (no native/app),
> no-AI, fully-free** ([`SCOPE-v2.1-web-only-free.md`](./.claude/plan/v2/SCOPE-v2.1-web-only-free.md)):
> **P13** is a responsive owner-view section of the one web app over the frozen
> P7/P12 report envelopes + the P8/P12-CE Hub consolidation, plus a free
> self-hosted-VAPID web-push alert plane. **Hosting stays Vercel Hobby**
> (deep-researched 2026: no genuinely-free host reuses a Mongoose socket).
> **Next: the build-ordering revision pass, then coding.** This README is the
> developer getting-started guide.

---

## Features

- **POS terminal** — product grid, cart, modifiers, per-order discount, table
  selection, and payment (Cash / Online / Due / Split / Credit).
- **Open tabs / running orders** — hold a tab, fire multi-round KOTs to the
  kitchen before payment, then settle to close it and free the table.
- **Order management** — list, filter (status / payment / table / date),
  **search by customer phone**, view, settle, and print receipts.
- **Menu management** — products + categories + modifiers + images, an
  in-stock / out-of-stock (**"86"**) availability toggle, **archive & restore**
  (soft-delete), and **bulk CSV import** with a dry-run preview.
- **Customer CRM** — visits, spend, and outstanding dues, reconciled from orders.
- **Tables, reservations, and event bookings** (with advance-payment tracking).
- **Dashboard** — live KPIs (sales, collected, in-progress, open tables,
  outstanding dues), a live floor panel, sales-by-hour, and an **admin-only,
  printable End-of-Day summary** (including unsettled open tabs).
- **Reports** — date-range sales, product-wise, payment-mode-wise, customer dues.
- **Billing** — 80mm thermal-compatible receipts and KOTs via `react-to-print`,
  plus a WhatsApp share link. Restaurant name, GST, and receipt header/footer
  are configurable in Settings.
- **Auth & roles** — admin (full access) and staff (everything except staff
  management, reports, and settings).

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router, RSC) + API Route Handlers |
| Database | MongoDB Atlas (M0) via Mongoose |
| Auth | NextAuth.js v5 (Auth.js) — JWT + Credentials, role-based |
| Validation | Zod (schemas shared client + server) |
| Server state | TanStack Query v5 |
| UI | shadcn/ui + Tailwind CSS 4, lucide-react, recharts |
| Forms | react-hook-form + zod resolver |
| Images | Cloudflare R2 (the cafe's own bucket; presigned direct uploads) — single per-cafe Cloudinary as the alternative |
| Printing | react-to-print |
| Hosting | Vercel (free Hobby tier, Node.js runtime) |

---

## Prerequisites

- **Node.js 20+** (the seed scripts use `node --env-file`).
- A free **MongoDB Atlas** cluster (M0) and connection string.
- A free **Cloudflare R2** bucket (for product images): a bucket-scoped API
  token, public read access (`r2.dev` or a custom domain), and a CORS rule
  allowing `PUT` + `content-type` from the app origin — see `DEPLOY.md`.
  *(Alternative: a Cloudinary account + `IMAGE_STORE=cloudinary` — uploads are
  signed server-side; no upload preset is needed.)*

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local   # then fill in the values (see below)

# 3. Seed an admin account + sample data (see "Seeding")
npm run seed:admin
npm run seed:tables
npm run seed:menu            # optional sample menu

# 4. Run the dev server
npm run dev                  # http://localhost:3000
```

### Environment variables

Set these in `.env.local` (never commit it):

```bash
# MongoDB Atlas M0 — server-only
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/pos

# NextAuth.js v5 — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# Cloudflare R2 — server-only credentials (bucket-scoped API token)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# R2 public base URL (build-time; renders product images)
NEXT_PUBLIC_R2_PUBLIC_BASE_URL=

# Optional — only when staying on a single per-cafe Cloudinary account:
#IMAGE_STORE=cloudinary
#CLOUDINARY_CLOUD_NAME=
#CLOUDINARY_API_KEY=
#CLOUDINARY_API_SECRET=
#NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
```

`SEED_ADMIN_PASSWORD` is also required (a strong password, no default) when
running `npm run seed:admin`.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run seed:admin` | Create the admin account (needs `SEED_ADMIN_PASSWORD`) |
| `npm run seed:tables` | Seed the 8 cafe tables |
| `npm run seed:menu` | Seed sample categories + products |
| `npm run seed` | Run all seeds |

---

## Project structure

```
app/                 Next.js App Router
  (auth)/login/      Login page
  (dashboard)/       Protected app (POS, orders, products, reports, …)
  api/               Route handlers (orders, products, customers, settings, …)
components/          UI — ui/ (shadcn), pos/, orders/, dashboard/, reports/, shared/
hooks/               TanStack Query hooks (use-products, use-orders, …)
lib/                 Core utils — db, auth, cache, receipt, query, utils
models/              Mongoose models
schemas/             Zod schemas + inferred types
types/               Client-facing TypeScript types
scripts/             Seed scripts
```

---

## Deployment

The host is **Vercel** (free Hobby tier — real Node.js runtime, so Mongoose's
connection cache works; see the commercial-use caveat in `DEPLOY.md`). Key
requirements:

- Set all environment variables in the Vercel project settings.
- MongoDB Atlas: allow `0.0.0.0/0` (Vercel uses dynamic egress IPs).
- R2 bucket: public read access + the CORS rule for browser PUTs.
- Seed the admin account before first login.

See `DEPLOY.md` for the full runbook and checklist.

---

## License

Private project. Not licensed for redistribution.
