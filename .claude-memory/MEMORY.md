# Memory Index — Lucifer Cafe POS

> Always loaded. Each entry under ~150 chars. Full details in linked file.

## Project

- [Project Overview](project_overview.md) — Single-restaurant POS (PetPooja-style), one restaurant, shared staff pool
- [Current Architecture](current_architecture.md) — Next.js 15 App Router + MongoDB/Mongoose + NextAuth v5 + TanStack Query (migrated Phase 0; old code on `legacy-tanstack`). Phase 1 auth + Phase 2 data layer + Phase 3 Core API (24 routes) + Phase 4 POS Terminal + Phase 5 Management Pages (8 CRUD pages) + Phase 6 Dashboard + Reports + **Phase 7 Billing/Receipts/Printing (Settings singleton model+API+admin page; fully-configurable GST both inclusive & exclusive via lib/receipt.ts + Order.gstAmount; settings-driven OrderReceipt + new KOTReceipt; KOT + WhatsApp-share buttons; react-to-print already wired Phase 4/5)** DONE — build/lint/type ✓; in-browser verify pending. `npm run seed:menu` adds test menu. Hosting target under review (CF Workers vs Vercel)
- [Data Models](data_models.md) — 9 Mongoose models live (Phase 2 + Phase 7 Settings singleton): Staff, Product, Category, Customer, Order(+embedded OrderItem; +gstAmount), Reservation, Event, Table, Settings. Zod schemas in schemas/, enums in lib/constants.ts
- [Routes & Features](routes_and_features.md) — 11 routes, POS terminal, order management, dashboard, reservations, events
- [Migration Target](migration_target.md) — Next.js 15 App Router + MongoDB Atlas + Cloudinary + **Cloudflare Workers** (Vercel Hobby = no commercial use)

## User

- [User Profile](user_profile.md) — Kartik Desai, restaurant tech builder, Lovable-generated project base, Hinglish comms

## Feedback

- [Collaboration Preferences](feedback_preferences.md) — One phase per session; review first; no code until instructed; single restaurant; login rate-limiting SKIPPED (smoothness > friction)

## Audit

- [Audit Findings](audit_findings.md) — 117-agent deep audit 2026-06-21: **grade B−**, 86 confirmed findings. Reframes Phase 8 into Phase 0→3. **P0 DONE** (money-path, atomic counter, idempotent follow-ups, DB pool, schema lockdown, short TTLs, table-grab, hardening). **P1 DONE 2026-06-22** (error/loading boundaries, optimistic fix + refetch guards, session maxAge+DB revalidation, last-admin guard, admin password reset, GST snapshot, bookings isError, report date validation, bundle trims). **P2 COMPLETE 2026-06-22** — code health: new `lib/query.ts` STALE_TIMES single source, `hooks/create-crud-hooks.ts` CRUD hook factory, `lib/crud-route.ts` route factory (collapses Reservations≈Events + products/categories), 3 GET routes connectDB-before-cache, shared `FormField`/`FormSheet` (5 sheets), 3 files >300 lines split (orders/pos pages, ProductFormSheet). All build/lint/type-verified + 9-agent adversarial-review-hardened (2 findings fixed). **P3 growth Step 1 DONE 2026-06-22** — bulk CSV product import (lib/product-import.ts + importProductRowSchema reusing createProductSchema + /api/products/import bulkWrite upsert-by-name + dry-run preview + auto-create categories + template; PapaParse client, xlsx avoided; 13-agent review-hardened, 3 fixes). **P3 growth Step 2 DONE 2026-06-23** — live floor panel + richer KPIs: enriched /api/orders/summary (collected[completed-only], inProgress{count,value}, outstandingDues{total,customers}=live ledger, hourly[]; dropped today-only totalDue) + cafeHourOf; new HourlySalesChart + LiveFloorPanel (click occupied tile→order sheet); dashboard now 6 KPI cards (Sales/Orders/Collected/In-progress/Open Tables N÷8/Outstanding Dues) + Sales-by-hour; REFETCH_INTERVALS.SUMMARY 2min→30s; settle/reconcile/order-PUT/DELETE del today's summary key on ledger touch; 18-agent review-hardened, 5 fixes. **P3 Step 3 DONE 2026-06-23** — open tabs / running orders + fire-KOT-before-payment: research-grounded (108-agent deep-research; full single-cafe running-order loop, enterprise bits deferred). New `payment:"Unpaid"` held-tab state (badge "Open") + `SETTLEMENT_PAY_MODES`; `lib/order.ts` (derivePayment+ledgerContribution+reconcileLedger+gstConfigFromOrder); new `/api/orders/[id]/settle` + `/items` (server-authoritative, conditional-update race guards); PUT hardened to metadata-only (closes a latent client-money/status spoof — the old audit note was wrong, schema *included* money). Order.kotRounds + OrderItem.kotRound (multi-round KOT). POS: `use-pos-tab` hook, Send-to-Kitchen/Pay-Now, resume tab w/ locked fired lines + OpenTabsButton, round-only KOT print, Settle reuses PaymentModal. Settle from OrderDetailSheet/OrderTable; In-progress KPI → /orders?payment=Unpaid. Multi-agent review (3 fixes) + 2 races proactively guarded; build/lint/type ✓. **P3 Step 4 DONE 2026-06-23** — stock→`available` ("86" toggle, no qty/decrement/alerts; `isActive`=archived only; "out" read as `available===false`, no migration; `LowStockAlert`+`LOW_STOCK_THRESHOLD` deleted); product archive/restore (`?archived` view + restore/availability hooks; availability is NOT a CSV column); order phone search (Customer.mobile reverse-lookup → customerId $in); admin-gated printable EOD summary on dashboard (incl. unsettled open-tabs list; `RECEIPT_PAGE_STYLE`→`lib/print.ts`); README rewritten. 12-agent review-hardened (6 fixes). **P3 GROWTH COMPLETE.** Deferred (enterprise): idempotency key, cross-isolate SWR, CSP, merge/transfer/split-bill. Report artifact linked in file.

## Skills & Plans

- [Design Skill](../.claude/skills/design.md) — All code patterns: API helpers, React Query hooks, node-cache middleware, Zod
- [Implementation Plan](../.claude/skills/implementation-plan.md) — Original Express plan (superseded by Next.js plan below)
- [Phase Plan](../.claude/plan/README.md) — 10 phases (0-9), Next.js 15 + MongoDB Atlas + Vercel
- [Research Synthesis](../.claude/research/research-synthesis.md) — Verified findings: React Query v5, MongoDB embed vs reference, Zod shared schemas
- [Free Tier Stack](../.claude/research/free-tier-stack.md) — Vercel limits, Atlas M0, Cloudinary free tier, react-to-print
