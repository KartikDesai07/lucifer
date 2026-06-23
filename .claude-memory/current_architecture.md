---
name: current-architecture
description: Current tech stack, data flow, and deployment for Lucifer Cafe POS
metadata:
  type: project
---

# Current Architecture

> As of Phase 0 (2026-06-20) the project was migrated **in-place** from the
> Lovable-generated TanStack Start / Vite / Cloudflare Workers / Supabase app to
> **Next.js 15 App Router**. The original code is preserved on the
> `legacy-tanstack` git branch (and the snapshot commit on `main`).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.5.19 (App Router) |
| Runtime / React | React 19.1.0 |
| Routing | App Router (`app/`, route groups `(auth)` + `(dashboard)`) |
| Database | MongoDB Atlas M0 + Mongoose 8 (replaces Supabase) — **provisioned & live** (db `lucifer-cafe`, admin seeded Phase 1) |
| Auth | NextAuth.js v5 / Auth.js (`next-auth@5.0.0-beta.31`) — **live (Phase 1)**: Credentials + JWT, role-based (`admin`/`staff`), bcrypt(12) |
| Server State | TanStack Query 5 (`components/providers.tsx`) |
| Backend cache | node-cache (`lib/cache.ts`, TTLs per CLAUDE.md §9) |
| Image storage | Cloudinary (`next.config.ts` allows res.cloudinary.com) — Phase later |
| UI | shadcn/ui (new-york) + Tailwind CSS 4 (`app/globals.css`, oklch tokens) |
| Icons / Charts / Forms | lucide-react / recharts 2 / react-hook-form + zod |
| Hosting target | **Under review** — Cloudflare Workers (commercial-use OK) vs Vercel Hobby (ToS forbids commercial use); resolved in Phase 9 |
| Dev tooling | TypeScript 5, ESLint 9 (flat config, `eslint-config-next`) |

## Project Layout (key paths)

```
auth.config.ts                   edge-safe Auth.js config (route guard, jwt/session cbs)
lib/auth.ts                      full Auth.js: Credentials authorize() (bcrypt + DB)
middleware.ts                    NextAuth(authConfig) guard; matcher excludes /api,_next
types/next-auth.d.ts             Session/User + @auth/core/jwt JWT augmentation (id, role)
models/*.ts                      8 Mongoose models (Phase 2): Staff (password select:false),
                                 Product, Category, Customer, Order (embeds OrderItem, _id:false),
                                 Reservation, Event, Table — all share the Staff.ts reuse-guard +
                                 { timestamps:true }; enums pull from lib/constants.ts
schemas/*.schema.ts + index.ts   8 Zod schemas (Phase 2): staff (login/changePwd/create/update),
                                 product, category, customer, order, reservation, event — each
                                 exports create/update + inferred *Input types; barrel = schemas/index.ts
types/index.ts                   re-exports all *Input types from @/schemas (single import point)
hooks/use-auth.ts                useSession wrapper → {user, role, isAdmin, logout}
app/api/auth/[...nextauth]/route.ts   exports GET/POST from lib/auth handlers
app/api/staff/change-password/route.ts  self-service pwd change (auth + bcrypt)
app/(auth)/login/page.tsx        login form (react-hook-form + signIn, redirect:false)
app/(dashboard)/staff/page.tsx   admin-only placeholder wrapped in <AdminGuard>
app/(dashboard)/layout.tsx       sidebar + header shell
app/(dashboard)/page.tsx         dashboard home placeholder
app/api/health/route.ts          DB connectivity check (§7 response shape)
app/layout.tsx                   root: async, auth() → <SessionProvider> wraps Providers
components/ui/*                   46 shadcn primitives (all have 'use client')
components/layout/AppSidebar.tsx  role-filtered nav + user footer (badge, change-pwd, logout)
components/layout/Header.tsx      sidebar trigger + title
components/shared/AdminGuard.tsx  client guard, redirects non-admins to /
components/shared/ChangePasswordDialog.tsx  controlled dialog → change-password API
components/providers.tsx         TanStack Query client (§9 defaults)
lib/db.ts                        connectDB() — global cache, lazy URI read
lib/cache.ts | constants.ts (+ADMIN_ROUTES) | utils.ts
scripts/seed-admin.ts            exports seedAdmin(); `npm run seed:admin` (tsx + node --env-file)
scripts/seed-tables.ts           exports seedTables() — idempotent $setOnInsert upsert of T-1..T-8
scripts/seed.ts                  `npm run seed` — runs seedAdmin + seedTables on one cached conn
```

**Seed script pattern:** each seeder exports a pure async fn that calls connectDB()
(cached on global, so combined seed shares one connection) and a guarded standalone
runner (`isMain` = normalized process.argv[1] endsWith the script path) so importing
the fn into seed.ts never triggers the standalone runner. ts-node from the plan was
replaced with the already-installed `tsx`.

**Env note:** `.env.local` uses `NEXTAUTH_SECRET`/`NEXTAUTH_URL`; next-auth v5 reads
`AUTH_SECRET ?? NEXTAUTH_SECRET` and `AUTH_URL ?? NEXTAUTH_URL`, so both work. CLAUDE.md §18
prefers `AUTH_*` for the Cloudflare deploy.

## Data Flow (target — built in later phases)

```
Client (TanStack Query hook) → Next API route (app/api/*)
  → connectDB() → Mongoose model query (.lean())
  → node-cache read-through (except orders) → { success, data } JSON
```
The old `useLocal()` + Supabase `app_kv` blob pattern is **gone**.

## Deployment

- Target: **TBD** — Vercel Hobby disallows commercial use (a cafe POS is commercial), so Cloudflare Workers (via `@opennextjs/cloudflare`) is the likely target. Decide in Phase 9. MongoDB Atlas IP allowlist 0.0.0.0/0 either way.
- GitHub remote `origin`: `https://github.com/KartikDesai07/lucifer.git`
- `legacy-tanstack` branch holds the pre-migration Lovable code.

## Verification status (Phase 1)

- `npm run build` ✓ 0 errors · `npm run lint` ✓ 0 warnings
- All routes now dynamic (ƒ) because root layout calls `auth()` (reads cookies) — expected for an authed app. Shared First Load JS ≈ 102 kB; `/login` 142 kB (next-auth/react + RHF + zod), under 200 kB target.
- Live auth E2E (dev server, curl): `/` & `/staff` unauth → 307 `/login`; `/login` 200; credentials login admin/Admin@123 → session `{user:{id,name,role:'admin'}}`; wrong password → session stays `null`; logged-in `/login` → 307 `/`; change-password API → 401 unauth / 400 wrong-current / 400 short-pwd.
- Build emits a harmless `jose DecompressionStream` Edge-Runtime warning (JWE-compression code path Auth.js never invokes) — not an error.
- Known gotcha: JWT type augmentation must target `@auth/core/jwt`, NOT `next-auth/jwt` (the latter only `export *`s, so augmenting it is a no-op for callback `token` typing).

## Verification status (Phase 2 — 2026-06-20)

- 8 Mongoose models + 8 Zod schemas + seed scripts created. `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ (0 errors).
- `npm run seed` against Atlas → idempotent; verified live counts: `staff` = 1 (1 admin), `tables` = 8 (T-1..T-8, all Available, capacity 4).
- Verified `tsx` resolves the `@/` tsconfig path alias, so models/schemas/scripts can use `@/lib/...` imports (not just relative).
- Deltas from the plan's literal snippets (all intentional, build-verified): field-level `unique:true` instead of a duplicate `schema.index()` (avoids Mongoose dup-index warning); enums sourced from `lib/constants.ts` via `[...CONST]`; Zod `z.enum(CONST)` accepts the `as const` readonly tuples (zod 3.24); inferred type is `OrderItemInput` (matches the universal `...Input` convention) not the plan's bare `OrderItem`.
- Adversarial multi-lens review (plan-conformance / conventions / runtime-correctness / completeness) → 0 confirmed defects.

## Verification status (Phase 3 — 2026-06-20)

- **All Core API routes built** under `app/api/*` (23 handlers): products, products/[id], categories, categories/[id], customers, customers/[id], orders, orders/[id], orders/summary, tables, tables/[tableNo], staff, staff/[id], reservations, reservations/[id], events, events/[id], upload, reports (+ pre-existing auth, health, staff/change-password).
- **`lib/api-helpers.ts`** is the shared spine: `success/created/failure/notFound/validationError/isDuplicateKeyError` + `validateBody`/`requireAuth`/`requireAdmin`. TypeScript-strict (no `as any`, deviates from the plan's snippet): helpers return discriminated unions `{data}|{error}` / `{session}|{error}`; routes narrow with `if ("error" in x) return x.error`. Error builder named `failure` (not `error`) to avoid shadowing the `.error` arm.
- **Pattern per route:** auth/admin guard FIRST → Zod `validateBody` → `connectDB()` → Mongoose (`.lean()` reads) → node-cache read-through (except orders) → `{success,data}`. Every file sets `export const dynamic = "force-dynamic"`. Next.js 15 async params (`params: Promise<{id}>`). ObjectId validated via `mongoose.isValidObjectId` → 404 on bad id.
- **Caching:** read-through on GET lists (TTLs from `lib/cache.ts`); writes `cache.del(key)`. Keys: `products`, `categories`, `customers`, `tables`, `staff`, `reservations`, `events`, and per-day `order-summary-<dateString>` (`orderSummaryCacheKey()` in utils, TTL.SUMMARY=2min). Orders never cached. Customers/reservations/events GET bypass cache when filter/search params present.
- **Order POST** (the important one): generates `ORD-YYYYMMDD-NNN` via today's count + `generateOrderId(seq)`, retries ≤3× on E11000 collision; `$inc` customer visits/totalSpend(+total)/totalDue(+max(0,total-paid)); sets table Occupied + currentOrderId; invalidates `customers`/`tables`/today's summary.
- **New files added Phase 3:** `lib/cloudinary.ts` (+`CLOUDINARY_FOLDER`), `schemas/table.schema.ts` (`updateTableSchema`, in barrel). **Edited:** `lib/utils.ts` (+`dayRange`, +`orderSummaryCacheKey`), `lib/cache.ts` (+`TTL.SUMMARY`), `lib/constants.ts` (+`UNCATEGORIZED`).
- **Domain rules:** category delete reassigns orphaned products → `UNCATEGORIZED` (clears products+categories cache). Customer delete blocked if `totalDue>0`. Staff is admin-only (`requireAdmin`): create hashes bcrypt(12) + re-reads w/o password; update via `updateStaffSchema` (no password — that's `/staff/change-password`); delete is soft (isActive:false) + self-deactivation guard. Upload returns a SIGNED Cloudinary payload (browser uploads direct); DELETE destroys by public_id. Reports = aggregation pipelines (totals, salesByPayment, top-10 products, day-wise, customer dues) over Completed orders in a date range (default last 30d).
- **Checks:** `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ (0 errors). Atlas allowlist `0.0.0.0/0` added → DB connects.
- **Full authenticated E2E PASSED (session 2)** via curl + real NextAuth cookie: CRUD, 400 validation, 401/403 gates, order create side-effects, ledger reconcile, all cleaned up. (Admin seed: admin / Admin@123.)
- **Deep 2-reviewer audit done; must-fixes applied (session 2):**
  - Order `[id]` PUT now **reconciles** customer `totalSpend`/`totalDue` by delta (+ customerId change) and reassigns table; DELETE **fully reverses** visits/spend/due + frees the table. (Was: POST-only side-effects → permanent dues corruption / un-deletable customers.)
  - Day boundaries anchored to **`Asia/Kolkata`** (`CAFE_TIMEZONE`, `CAFE_UTC_OFFSET_MINUTES=330` in constants): `dayRange`/`cafeDateString`/`orderSummaryCacheKey` are tz-correct on a UTC host; reports `$dateToString` passes `timezone`; `generateOrderId` uses IST date.
  - orderId is now **`max(today seq)+1`** (not count+1) so it survives mid-day deletes & concurrent creates.
  - `orders/summary` `paymentBreakdown` is uniform `{amount,count}` per mode (agrees with `/reports`).
  - `/api/health` + `change-password` no longer leak raw DB errors (health gates `details` behind non-prod; change-password refactored onto shared helpers + `BCRYPT_ROUNDS`).
  - `createOrderSchema.tableNo` validated via `z.enum(TABLE_NUMBERS)`.
- **DEFERRED security gap (tracked):** `/api/auth/*` rate-limiting (§8) NOT implemented — needs a shared store (per-isolate node-cache = false security on CF Workers). Do in auth-hardening / Phase 9 after the host is chosen. Other minors deferred: mobile normalization, reservation/event date-param regex, non-atomic order side-effects (M0 has no txns), category-rename cascade.

## Verification status (Phase 4 — POS Terminal — 2026-06-21)

- **POS terminal built** at `app/(dashboard)/pos/page.tsx` (client orchestrator, holds cart/table/customer/discount/payment state; <300 lines). Two-column at `md` (categories+grid | sticky cart); phones get a sticky summary bar → bottom Sheet hosting the same `<Cart>`.
- **New TanStack hooks** (`hooks/`): `use-products`, `use-categories`, `use-tables` (30s staleTime + 30s `refetchInterval`), `use-customers` (`useCustomerSearch` enabled@2chars + `useCreateCustomer`), `use-orders` (`useOrders` staleTime:0 + `useCreateOrder` **Pattern B** cache-optimistic per §9: cancelQueries→snapshot→setQueryData→rollback onError→invalidate orders/tables/customers onSettled). `use-cart` = local cart state hook (not React Query): line-merge by product+modifiers+instructions, `effectivePrice()` applies the product's % discount, exposes subtotal/count.
- **New shared infra:** `lib/api-client.ts` (`apiGet`/`apiSend` unwrap the `{success,data}` envelope, throw on `success:false` → React Query error path); `lib/images.ts` (`productImageUrl(publicId,size)` builds Cloudinary URL from public_id, null-safe → placeholder); `components/shared/EmptyState.tsx`; **client entity types** added to `types/index.ts` (`Product`/`Category`/`Customer`/`Table`/`Order`/`OrderItem` — the JSON-serialized lean shapes, distinct from server `I*` model interfaces).
- **POS components** (`components/pos/`): `CategorySidebar` (All-first rail), `ProductGrid` (client category+name filter, out-of-stock disable on `stock===0`, % discount badge, next/image w/ initial fallback), `ModifierModal` (modifiers are **label-only**, no per-modifier price — model has none; + instructions + qty), `Cart` (qty steppers, controlled discount ₹/% toggle so it can mount twice safely, total=max(0,subtotal-discount)), `TableSelector` (8-table grid, Available=green/Occupied=red/Reserved=amber, occupied/reserved disabled), `CustomerSearch` (300ms debounce + inline quick-add), `PaymentModal` (5 modes; Cash shows change; Split validates cash+online===total; Due/Credit require a customer & set paidAmount=0; receiver = logged-in user's name), `OrderReceipt` (80mm/300px monospace, react-to-print v3 `contentRef`, off-screen mount + print-after-commit effect, `pageStyle` @page 80mm).
- **Key decisions:** (1) **receiver = session user's name** — no staff dropdown, since `/api/staff` is admin-only and POS is used by staff. (2) **POS orders are created `status:"Completed"`** (counter-service: payment taken at order time) so they count in `/api/orders/summary` & `/reports` (both filter `status:"Completed"`); Due/Credit are Completed sales with `paidAmount<total`, balance tracked via the Phase-3 `$inc totalDue`. (3) order-level `discount` = flat amount (schema); product `discount` = percentage applied to unit price.
- **Checks:** `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ (0 errors; `/pos` = 26.5 kB / 168 kB First Load, under 200 kB). All 5 payment-mode payloads parse against `createOrderSchema` (offline contract test). Live dev server (port 3000): `/pos`→307 (auth guard), `/api/products`→401, `/login`→200 — no import/compile crash.
- **New dev seed:** `scripts/seed-menu.ts` + `npm run seed:menu` — idempotent upsert of 4 categories + 8 products (with stock; some discounts/modifiers; one `stock:0` to exercise out-of-stock). Ran against Atlas ✓. (Test menu only; Phase 5 builds the real management UI.)
- **NOT yet verified (needs in-browser, authed):** visual cart math, add-to-cart/qty interactions, the print dialog rendering, and the post-order table→Occupied + cart-clear UX. The underlying order POST side-effects were already E2E-verified in Phase 3.

## Verification status (Phase 5 — Management Pages — 2026-06-21)

- **All 8 management pages built** under `app/(dashboard)/`: `products`, `categories`, `customers`, `staff` (admin-only via `<AdminGuard>`), `orders`, `reservations`, `events`, `tables`. Common pattern: header + `<Plus>` add → search/filter → shadcn `<Table>` (or card grid for tables) → add/edit in a `<Sheet>` form → delete via shared `<ConfirmDialog>` → `<EmptyState>` first-run / no-match / error states + `<Skeleton>` while loading. Sidebar already linked all routes (Phase 4).
- **Hooks completed** (`hooks/`): added mutation hooks to `use-products` (create/update/delete), `use-categories` (create/update/delete), `use-customers` (added `useCustomers` list, `useCustomerOrders`, update/delete; kept search + create), `use-orders` (added `useOrders(filters)` + update/delete; kept Pattern-B create), `use-tables` (added `useUpdateTable`). **New hooks:** `use-staff`, `use-reservations`, `use-events` — all CRUD. Mutations follow §9 **Pattern A** (UI `isPending`): `onSuccess` toast, `onError` toast(err.message), `onSettled` invalidate. `useCreateCustomer` stays silent (POS inline use); customers page toasts success itself.
- **New shared components:** `components/shared/ConfirmDialog.tsx` (AlertDialog, destructive styling, `isLoading`; caller closes it), `components/shared/ImageUpload.tsx` (direct browser→Cloudinary **signed** upload via existing `/api/upload` → stores `public_id`; 2MB/image-type guard; object-URL preview is `unoptimized`, stored Cloudinary URL optimized). **New feature component dirs:** `components/{products,customers,staff,reservations,events,orders}/` hold each entity's `*FormSheet` (+ `CustomerHistoryDialog`, `OrderDetailSheet`).
- **Forms = react-hook-form + zodResolver.** CRITICAL pattern: schemas with `.default()` (product, customer.notes, staff.role, event.advance) make zod **input ≠ output**, so those forms MUST type `useForm<z.input<S>, unknown, z.output<S>>` (resolver is `Resolver<Input,Ctx,Output>` in @hookform/resolvers@5) — otherwise TS fails to compile. Reservation form has no defaults in its picked fields so `z.infer` suffices. Number inputs use `register(..,{valueAsNumber:true})`; Radix `<Select>` can't use `""` as a value → reservation tableNo uses a `"none"` sentinel ↔ undefined.
- **Edit safety:** customer edit picks only `{name,mobile,notes}` (never resets derived visits/totalSpend/totalDue); staff edit omits password (changed via change-password); staff create sends `isActive:true`. Reservation/event create inject `status:"Booked"`.
- **API additions this phase:** `app/api/categories/[id]` gained a **PUT** (rename/reorder; renames cascade to products' denormalized `category`). `app/api/orders` GET gained `payment` + `customerId` filters (customer history + accurate orders-page filtering). `types/index.ts` gained client interfaces `Staff`/`Reservation`/`Event` + re-export of `UpdateTableInput`.
- **Domain behaviors:** category reorder = swap `order` of two neighbours (two PUTs → two toasts, minor). Orders "Mark complete" = PUT status Completed **and** frees the order's table via `useUpdateTable` (CLAUDE.md §12). Events "Receive balance" sets `advance=payable`. Staff deactivate disabled for self + admin accounts (UI), API also blocks self. Order/reservation/event quick status actions update inline.
- **Checks:** `npm run build` ✓ (clean `.next`, 0 errors; all 8 routes emitted; products 205 kB / customers 198 kB First Load — under target) · `npm run lint` ✓ 0 warnings. The jose/Edge-Runtime `CompressionStream` warning is pre-existing (next-auth, harmless).
- **NOT yet verified (needs in-browser, authed):** real Cloudinary upload round-trip (needs `CLOUDINARY_*` + `NEXT_PUBLIC_CLOUDINARY_*` env set), receipt print from orders detail, and full click-through CRUD. Build + lint + type-check all green.
- **Known limitations / deferred:** products page lists only **active** products (GET filters `isActive:true`) → soft-deleted items can't be un-deleted from the UI. Orders date filter is single-day only (API has no from/to). Order "reorder→POS cart" button skipped (POS cart is page-local; no cross-page handoff yet). Category reorder fires two success toasts. `/api/auth/*` rate-limiting still deferred (Phase 9).

## Verification status (Phase 6 — Dashboard + Reports + Analytics — 2026-06-21)

- **Dashboard** (`app/(dashboard)/page.tsx`) rebuilt as a **client** page (not the plan's literal Server Component) so React Query `refetchInterval` auto-refresh works (Step 6.7) — consistent with every other page. Composes: 4 `SummaryCard`s (Today's Sales / Orders Served / Due Today / Pending Orders), `PaymentChart` (pie) + `TopProductsChart` (h-bar) side-by-side, `RecentOrders` + `TodayReservations`, and a `LowStockAlert` banner. Owns the shared `OrderDetailSheet` (recent-order rows open it; reuses its print + mark-complete, freeing the table like the orders page). **[SUPERSEDED by P3 Step 2, 2026-06-23 — see audit_findings.md:** now **6** KPI cards (Today's Sales / Orders Served / Collected / In-progress / Open Tables / **Outstanding Dues** replacing "Due Today"); added `LiveFloorPanel` + `HourlySalesChart`; dropped the separate pending query (→ summary.inProgress); summary poll now 30s.**]**
- **Auto-refresh cadence (Step 6.7):** summary `useOrderSummary()` staleTime+refetchInterval = **2min** (mirrors `TTL.SUMMARY`); recent-orders `useOrders({date:today})` and pending-count `useOrders({status:'Pending'})` poll **30s** via a new optional `useOrders(filters, {refetchInterval})` 2nd arg (backward-compatible). Pending count is a **separate live query** (summary only counts Completed) so it reflects true "now".
- **Reports** (`app/(dashboard)/reports/page.tsx`) is **admin-only, enforced at 4 layers**: `ADMIN_ROUTES` now includes `/reports` (middleware edge redirect) + sidebar item `adminOnly:true` + page wrapped in `<AdminGuard>` + `/api/reports` switched `requireAuth`→**`requireAdmin`**. Native `<input type=date>` From/To (default last 7 days, set in `useEffect` to dodge SSR date-hydration mismatch) + Generate button (disabled until range changes / on error retry). Summary cards (Sales/Orders/Avg-Order/Collected) + `SalesByDayChart` (line) + reused `TopProductsChart`/`PaymentChart` + `CustomerDuesTable`.
- **Charts** (`components/dashboard/PaymentChart`, `TopProductsChart`; `components/reports/SalesByDayChart`) are recharts, `'use client'`, and **dynamic-imported with `{ssr:false}`** + Skeleton fallback in both pages (keeps them out of initial bundle / avoids recharts SSR issues — plan Steps 6.3/6.4). PaymentChart/TopProductsChart take **normalized props** (`{mode,amount}[]` / `ProductStat[]`) so dashboard (today) + reports (range) both reuse them.
- **API change:** `/api/orders/summary` now also returns `topProducts` (top-10 by revenue today), computed **in-memory** from the already-fetched `orders` array (no extra DB round-trip), matching `/api/reports.topProducts` shape. `/api/reports` unchanged except the admin guard.
- **New shared infra:** `lib/export.ts` `exportToCSV()` (RFC-4180 quote-escaping, Blob download, cafe-date-stamped filename — Step 6.11); `lib/utils.ts` +`timeAgo()`; `lib/constants.ts` +`PAYMENT_COLORS` (hex mirror of PAY_STYLES for recharts) +`LOW_STOCK_THRESHOLD=5`; `types/index.ts` +`OrderSummary`/`Report`/`ProductStat`/`PaymentStat`/`CustomerDue`; **new hook** `hooks/use-reports.ts` (`useReport(range, enabled)`); `hooks/use-orders.ts` +`useOrderSummary()` +`ORDER_KEYS.summary`. "Mark paid" in CustomerDuesTable = `useUpdateCustomer({totalDue:0})` then invalidate `REPORT_KEYS.all`.
- **Checks:** `npm run build` ✓ (0 errors; `/` dashboard 162 kB, `/reports` 156 kB First Load — under 200 kB target) · `npm run lint` ✓ 0 warnings.
- **NOT yet verified (needs in-browser, authed):** chart rendering, 30s/2min live refresh visually, CSV download, "Mark paid" round-trip. Build/lint/type all green.
- **Deviations / notes:** customer-dues table shows name/mobile/due only — the plan's "days since last order" was dropped (the reports API `customerDues` selects just `name mobile totalDue`; adding it = per-customer order lookup, not worth the cost). "Due Today" card uses summary `totalDue` (today's uncollected), labelled accordingly — not an all-time outstanding figure (that lives in the reports dues table).

## Verification status (Phase 7 — Billing, Receipts & Printing — 2026-06-21)

- **Settings system built (the headline of this phase):** 9th Mongoose model `models/Settings.ts` (**singleton**), `schemas/settings.schema.ts`, `app/api/settings/route.ts` (GET `requireAuth` + cached 10min via new `TTL.SETTINGS`; PUT `requireAdmin` + `findOneAndUpdate({},…,{upsert,setDefaultsOnInsert,runValidators})` + cache.del), `hooks/use-settings.ts` (`useSettings` 10min staleTime + `useUpdateSettings` Pattern-A), and **admin-only** `app/(dashboard)/settings/page.tsx` (wrapped in `<AdminGuard>`) + `components/settings/SettingsForm.tsx` (RHF+zod, Cards for Restaurant / Receipt text / GST / KOT sections, Switch toggles, Select for gstMode, number input + `GST_RATES` quick-pick buttons for rate). Sidebar gained a Settings item (`adminOnly:true`); `/settings` added to `ADMIN_ROUTES` → **4-layer admin gate** like /reports (middleware + sidebar + AdminGuard + requireAdmin).
- **GST is fully admin-configurable, BOTH modes built end-to-end** (`lib/receipt.ts` is the shared spine): `computeExclusiveGst(base,cfg)` (POS-side add-on) + `receiptGst(order,cfg)` (display breakdown). **Inclusive** = prices include GST; receipt back-calculates the tax portion out of `total`; POS total/`Order` unchanged. **Exclusive** = GST added on top → POS folds it into `total`, persists `Order.gstAmount`, and the cart/PaymentModal/receipt all show a `+GST @x%` line. Old orders (no gstAmount) show no tax line under exclusive, back-calc under inclusive — intentional.
- **Receipt (`OrderReceipt`) is now settings-driven** (was hardcoded "LUCIFER CAFE"): renders `restaurantName`/`tagline`/`address`/`mobile`/`GSTIN`/`receiptHeader`/`receiptFooter` from Settings (with fallbacks for the pre-load window), the GST breakdown, and an actual **print timestamp** (`new Date()` — hydration-safe because the receipt body only renders once an order is selected, i.e. client-side post-interaction). `KOTReceipt` (new) = large-font kitchen ticket, items+qty+modifiers+instructions+order note, prices hidden unless `Settings.kotShowPrices`.
- **Print plumbing was already wired** (Phase 4/5): `react-to-print` v3 off-screen-clone in both the POS `PaymentModal` flow and `OrderDetailSheet`. Phase 7 added a 2nd off-screen source (KOT) with its own `kotRef`/`printKot` in both places, a "KOT" button (POS header, shown once `lastOrder` exists; + in OrderDetailSheet), and a **WhatsApp share** button in OrderDetailSheet (`wa.me/?text=…` no recipient — Order has no customer mobile). Steps 7.2/7.8 (print fn + global print CSS) were already satisfied by the iframe-clone approach, so `globals.css` was left untouched (the plan's `body>*{display:none}` global print CSS is unnecessary with react-to-print's iframe and would risk breaking it).
- **Checks:** `npx tsc --noEmit` ✓ · `npm run lint` ✓ 0 warnings · `npm run build` ✓ (0 errors; all 17 routes + `/api/settings` emitted; `/settings` 4.84 kB/198 kB, `/pos` 12.5→ now incl GST+KOT 173 kB First Load — under 200 kB).
- **Decisions / deviations:** (1) GST kept whole-rupee (`Math.round`) to match `inr()` (maxFractionDigits:0). (2) `currencySymbol` from the plan was **dropped** — `inr()` is hardcoded INR/₹ across the app; a half-wired symbol toggle is worse than none for a single Indian cafe. (3) KOT "Print KOT button in POS" implemented as a header button keyed to `lastOrder` (POS resets after each order; lastOrder persists for reprint). (4) SettingsForm `isDirty`-gates Save; after save the form isn't re-`reset()` from the refetched data (RHF defaultValues are mount-only) — harmless since values already match.
- **NOT yet verified (needs in-browser, authed):** the actual print dialog rendering of the enriched receipt + KOT, GST math on a live bill (both modes), Settings save round-trip, WhatsApp link. Build/lint/type all green; GST math is unit-consistent by construction (`receiptGst` taxable = total − gstAmount = base).
