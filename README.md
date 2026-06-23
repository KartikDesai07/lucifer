# Lucifer Cafe POS

A single-restaurant Point-of-Sale and management system — PetPooja-style feature
scope, built to run entirely on free tiers. One admin plus any number of staff
share a single data pool (no multi-tenancy).

> **Internal source of truth:** [`CLAUDE.md`](./CLAUDE.md) holds the locked
> architecture, conventions, and phase plan. This README is the developer
> getting-started guide.

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
| Images | Cloudinary |
| Printing | react-to-print |
| Hosting (target) | Cloudflare Workers + Pages |

---

## Prerequisites

- **Node.js 20+** (the seed scripts use `node --env-file`).
- A free **MongoDB Atlas** cluster (M0) and connection string.
- A free **Cloudinary** account (for product images), with an unsigned upload
  preset named `lucifer_cafe_products`.

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
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/lucifer-cafe

# NextAuth.js v5 — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# Cloudinary — server-only credentials
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Cloudinary — public values for the browser upload widget
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=lucifer_cafe_products
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

The documented target is **Cloudflare Workers + Pages** (free tier, commercial
use allowed, no cold starts). Key requirements:

- Add `nodejs_compat` to `compatibility_flags` so Mongoose's TCP sockets work.
- Set all environment variables as secrets in the Cloudflare dashboard / Wrangler.
- MongoDB Atlas: allow `0.0.0.0/0` (Cloudflare uses dynamic IPs).
- Configure the Cloudinary unsigned upload preset.
- Seed the admin account before first login.

See `CLAUDE.md` §18 for the full deployment checklist.

---

## License

Private project. Not licensed for redistribution.
