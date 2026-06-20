---
name: implementation-plan
description: Phase-wise step-by-step implementation plan for Lucifer Cafe POS — React + Express + MongoDB migration
---

# Lucifer Cafe POS — Implementation Plan

**Goal:** Replace Supabase/localStorage data layer with Express + MongoDB backend.
Keep all existing UI. Add proper caching on both frontend (React Query) and backend (node-cache).

**Stack:** React 19 (TanStack Start) + Express.js + MongoDB (Mongoose) + node-cache + JWT auth + Zod

---

## Phase 0 — Foundation Setup
> **Goal:** Scaffold the new folder structure. Zero code changes to existing frontend.

### Step 0.1 — Create shared/ schemas folder
- Create `shared/schemas/` at project root
- Write Zod schemas for all 7 entities (product, category, customer, order, staff, reservation, event)
- Export schema object + z.infer type from each file
- Create `shared/schemas/index.ts` re-exporting all

**Files to create:**
```
shared/schemas/product.schema.ts
shared/schemas/category.schema.ts
shared/schemas/customer.schema.ts
shared/schemas/order.schema.ts
shared/schemas/staff.schema.ts
shared/schemas/reservation.schema.ts
shared/schemas/event.schema.ts
shared/schemas/index.ts
shared/types/constants.ts      ← TABLE_NUMBERS, PAY_STYLES enums
```

### Step 0.2 — Create server/ folder
- `server/package.json` with Express + Mongoose + dependencies
- `server/tsconfig.json`
- `server/.env.example`
- Install: `express`, `mongoose`, `zod`, `jsonwebtoken`, `cookie-parser`, `cors`, `helmet`, `morgan`, `node-cache`, `dotenv`
- Dev deps: `typescript`, `ts-node`, `nodemon`, `@types/*`

**server/package.json scripts:**
```json
{
  "dev": "nodemon --exec ts-node src/app.ts",
  "build": "tsc",
  "start": "node dist/app.js"
}
```

### Step 0.3 — Express app skeleton
- `server/src/app.ts` — express app with middleware stack (cors, helmet, morgan, cookieParser, json)
- `server/src/config/db.ts` — Mongoose connect with retry
- Routes not wired yet (just placeholder `/api/health` endpoint)
- Start server, confirm `GET /api/health` returns `{ ok: true }`

### Step 0.4 — Environment setup
- Add `server/.env` to `.gitignore`
- Create `server/.env` with all required vars
- Update root `package.json` scripts to run both frontend + backend:
  ```json
  "dev:server": "cd server && npm run dev",
  "dev:web": "vite dev",
  "dev": "concurrently \"npm:dev:server\" \"npm:dev:web\""
  ```

**Checkpoint:** `npm run dev` starts both. Health endpoint responds. No functional change yet.

---

## Phase 1 — Mongoose Models
> **Goal:** Define all 8 MongoDB collections with proper schemas and indexes.

### Step 1.1 — Product model
```typescript
// Fields: name, category(string), price, discount, stock, image, modifiers[]
// Indexes: { category: 1 }, text on name
```

### Step 1.2 — Category model
```typescript
// Fields: name(unique), order(display order)
// Index: { name: 1 } unique
```

### Step 1.3 — Customer model
```typescript
// Fields: name, mobile(unique), visits, totalSpend, notes(Regular|VIP)
// Indexes: { mobile: 1 } unique, text on name
```

### Step 1.4 — Order model (with embedded OrderItem)
```typescript
// OrderItem subdoc: productId, name, price, qty, modifiers[], instructions
// Order fields: orderId(unique), date, customerId?, customerName, items[], 
//               subtotal, discount, total, paidAmount, payment, status, receiver, tableNo?
// Indexes: { date: -1 }, { status: 1 }, { tableNo: 1 }, { customerId: 1 }
```

### Step 1.5 — Staff model
```typescript
// Fields: name, mobile, createdAt
// Used for login: add passwordHash field
```

### Step 1.6 — Reservation model
```typescript
// Fields: name, mobile, date(YYYY-MM-DD), time(HH:MM), guests, tableNo?, notes?, status
// Index: { date: 1, status: 1 }
```

### Step 1.7 — Event model
```typescript
// Fields: name, mobile, date, time, eventName, notes?, payable, advance, payMode, status
```

### Step 1.8 — Table model + seed
```typescript
// Fields: tableNo(unique "T-1"…"T-8"), status(Available|Occupied|Reserved), currentOrderId?
// Seed 8 documents on first startup if collection is empty
```

**Checkpoint:** Models created. Run a quick seed script, verify 8 table docs in MongoDB Compass.

---

## Phase 2 — Express CRUD API
> **Goal:** Full REST API for all entities. No auth yet (add in Phase 3).

### Step 2.1 — Utilities and middleware
- `server/src/utils/asyncHandler.ts`
- `server/src/middleware/validate.middleware.ts` (Zod)
- `server/src/middleware/error.middleware.ts` (global error handler)
- Wire `errorHandler` as last middleware in `app.ts`

### Step 2.2 — Cache setup
- `server/src/cache/index.ts` — NodeCache instance + TTL constants
- `server/src/middleware/cache.middleware.ts` — read cache, intercept res.json to populate cache

### Step 2.3 — Products API
```
GET    /api/products          → list all (cache 5min)
GET    /api/products/:id      → single product
POST   /api/products          → create (validate + clear products cache)
PUT    /api/products/:id      → update (validate + clear products cache)
DELETE /api/products/:id      → delete (clear products cache)
```

### Step 2.4 — Categories API
```
GET    /api/categories        → list all (cache 5min)
POST   /api/categories        → create
DELETE /api/categories/:id    → delete
```

### Step 2.5 — Customers API
```
GET    /api/customers         → list all (cache 2min)
GET    /api/customers/:id     → single
POST   /api/customers         → create
PUT    /api/customers/:id     → update
DELETE /api/customers/:id     → delete
```

### Step 2.6 — Orders API
```
GET    /api/orders            → list (NO cache, always fresh)
                                query params: status, tableNo, date, limit
GET    /api/orders/:id        → single order
POST   /api/orders            → create (validate, auto-generate orderId, update customer stats, update table status)
PUT    /api/orders/:id        → update (clear table cache)
DELETE /api/orders/:id        → delete
GET    /api/orders/summary    → daily totals for dashboard
```

### Step 2.7 — Staff API
```
GET    /api/staff             → list all (cache 5min)
POST   /api/staff             → create (hash password via bcrypt)
PUT    /api/staff/:id         → update
DELETE /api/staff/:id         → delete
```

### Step 2.8 — Reservations API
```
GET    /api/reservations      → list (cache 1min, filter by date/status)
POST   /api/reservations      → create
PUT    /api/reservations/:id  → update
DELETE /api/reservations/:id  → delete
```

### Step 2.9 — Events API
```
GET    /api/events            → list (cache 1min)
POST   /api/events            → create
PUT    /api/events/:id        → update
DELETE /api/events/:id        → delete
```

### Step 2.10 — Tables API
```
GET    /api/tables            → list all 8 tables with status (cache 30sec)
PUT    /api/tables/:tableNo   → update status (clear table cache)
```

**Checkpoint:** Test all endpoints with Postman/Thunder Client. CRUD works for all entities.

---

## Phase 3 — Authentication
> **Goal:** JWT auth with httpOnly cookies. Protect all /api routes.

### Step 3.1 — Auth service
- `server/src/services/auth.service.ts`
- `generateAccessToken(staffId)` → JWT signed with `JWT_SECRET`, expires in 15min
- `generateRefreshToken(staffId)` → JWT signed with `JWT_REFRESH_SECRET`, expires in 7d
- Store refresh token hash in Staff document (for rotation/invalidation)

### Step 3.2 — Auth endpoints
```
POST /api/auth/login     → validate credentials, set accessToken + refreshToken cookies (httpOnly, secure, sameSite)
POST /api/auth/refresh   → verify refreshToken cookie → issue new accessToken
POST /api/auth/logout    → clear both cookies, invalidate refresh token in DB
GET  /api/auth/me        → return current user from token
```

### Step 3.3 — JWT middleware
- `server/src/middleware/auth.middleware.ts`
- Read `accessToken` from `req.cookies`
- Verify, attach `req.user = decoded`
- Return 401 if missing/invalid

### Step 3.4 — Protect all routes
- Apply `protect` middleware to all routes EXCEPT `/api/auth/login` and `/api/health`
- Update `server/src/routes/index.ts`

### Step 3.5 — Frontend auth hook
- `src/hooks/use-auth.ts` — replaces `src/hooks/use-auth.tsx`
- `useQuery` on `/api/auth/me` to get current user
- `login(username, password)` → POST /api/auth/login → invalidate me query
- `logout()` → POST /api/auth/logout → clear user cache

**Checkpoint:** Login works. Auth routes return 401 without cookie. Refresh rotates token.

---

## Phase 4 — Frontend API Client
> **Goal:** Create the API layer that replaces direct Supabase calls.

### Step 4.1 — axios instance
- `src/api/client.ts` — axios with `baseURL: VITE_API_URL`, `withCredentials: true`
- Response interceptor: on 401, try `/api/auth/refresh`, retry once, then redirect to `/auth`

### Step 4.2 — Entity API files
Create one file per entity (follow design.md pattern):
```
src/api/products.api.ts
src/api/categories.api.ts
src/api/customers.api.ts
src/api/orders.api.ts
src/api/staff.api.ts
src/api/reservations.api.ts
src/api/events.api.ts
src/api/tables.api.ts
```

### Step 4.3 — React Query client config
- `src/lib/queryClient.ts` — configure staleTime, gcTime, retry, refetchOnWindowFocus: false
- Update `src/router.tsx` to wrap app in `<QueryClientProvider>`

**Checkpoint:** API client created. Network tab shows requests to Express. No hook migration yet.

---

## Phase 5 — Frontend Hooks (Replace Storage Layer)
> **Goal:** Replace `useLocal()` hooks in storage.ts with React Query hooks. One entity at a time.

**Order of migration (safest first → most complex last):**

### Step 5.1 — useCategories
Simple CRUD, no complex relations. Good first migration.

### Step 5.2 — useStaff
Simple CRUD.

### Step 5.3 — useProducts
Slightly complex (image handling, modifiers).

### Step 5.4 — useCustomers
Visits and totalSpend now managed by server.

### Step 5.5 — useReservations
Date/time filtering, status updates.

### Step 5.6 — useEvents
Advance/balance payment tracking.

### Step 5.7 — useTables
Live table status (short staleTime).

### Step 5.8 — useOrders ← Most complex
- `useOrders(filters?)` — with staleTime: 0, refetchInterval: 30000 (poll every 30s)
- `useCreateOrder()` — cache-based optimistic update (Pattern B from design.md)
- `useUpdateOrder()` — UI-based optimistic update (Pattern A)
- `useDeleteOrder()`
- `useOrderSummary()` — for dashboard

**For each hook:**
```
src/hooks/use-{entity}.ts
```

### Step 5.9 — Update routes to use new hooks
- Replace all `useLocal()` / `useProducts()` etc. imports with new hook imports
- Remove `src/lib/storage.ts` usage (keep file until all routes migrated)
- One route at a time: categories → products → customers → staff → reservations → events → orders → pos

**Checkpoint after each route:** UI still works, data persists through refresh.

---

## Phase 6 — Data Migration
> **Goal:** Move existing Supabase data into MongoDB.

### Step 6.1 — Migration script
- `server/scripts/migrate-from-supabase.ts`
- Read from Supabase `app_kv` table (all 8 keys)
- Transform: remap string IDs, add timestamps, generate orderId for orders
- Insert into MongoDB collections
- Report: "Migrated 47 products, 156 orders, 23 customers..."

### Step 6.2 — Run migration
- `ts-node server/scripts/migrate-from-supabase.ts`
- Verify in MongoDB Compass: all collections populated

### Step 6.3 — Verify in app
- Log in to running app
- Check products page: all menu items show
- Check orders page: all historical orders show
- Check dashboard: totals match

### Step 6.4 — Remove Supabase code
- Remove `src/integrations/supabase/` folder
- Remove `src/lib/storage.ts`
- Remove Supabase env vars from root `.env`
- Remove `@supabase/supabase-js` from package.json

---

## Phase 7 — Polish & Hardening
> **Goal:** Error handling, loading states, production readiness.

### Step 7.1 — Frontend error boundaries
- Add error boundary on each route
- Show user-friendly error messages (not raw axios errors)

### Step 7.2 — Loading skeletons
- Use existing `<Skeleton>` shadcn component
- Add loading state to product grid, order list, dashboard

### Step 7.3 — Toast error messages
- All mutations: `onError` → `toast.error(err.error ?? 'Something went wrong')`
- All deletes: `toast.success('{Entity} deleted')`

### Step 7.4 — Environment audit
- Verify NO secrets in VITE_ vars
- Verify `server/.env` is in `.gitignore`
- Add `server/.env.example` with all keys documented

### Step 7.5 — CORS hardening
- Set `CORS_ORIGIN` to exact frontend URL (not `*`)
- Set `credentials: true` on CORS config

### Step 7.6 — Production checklist
- [ ] `NODE_ENV=production` in server env
- [ ] JWT secrets are long random strings (not "secret")
- [ ] MongoDB connection string uses auth (not local)
- [ ] HTTPS only in production (cookies: `secure: true`)
- [ ] `helmet()` middleware active
- [ ] Error responses don't leak stack traces in production

---

## Phase Overview (Timeline Estimate)

| Phase | Name | Est. Time |
|-------|------|-----------|
| 0 | Foundation Setup | 1 day |
| 1 | Mongoose Models | 1 day |
| 2 | Express CRUD API | 2–3 days |
| 3 | Authentication | 1 day |
| 4 | Frontend API Client | 0.5 day |
| 5 | Frontend Hook Migration | 2–3 days |
| 6 | Data Migration | 0.5 day |
| 7 | Polish | 1 day |
| **Total** | | **~10–12 days** |

---

## Dependencies to Install

### server/package.json (production)
```
express
mongoose
zod
jsonwebtoken
bcryptjs
cookie-parser
cors
helmet
morgan
node-cache
dotenv
```

### server/package.json (dev)
```
typescript
ts-node
nodemon
@types/express
@types/mongoose
@types/jsonwebtoken
@types/bcryptjs
@types/cookie-parser
@types/cors
@types/morgan
@types/node
```

### root package.json additions
```
axios           (for src/api/client.ts)
concurrently    (for running dev:server + dev:web together)
```

---

## Key Architecture Decisions (Locked)

1. **No Redis** — node-cache is sufficient for single-restaurant, single-server setup
2. **OrderItems are embedded** in Order document (bounded array, always read together)
3. **Orders never cached** on backend — always hit DB for accuracy
4. **Shared schemas in shared/** — both frontend and backend import from same source
5. **Controller → Service → Repository** — strict layering, no DB calls in controllers
6. **Pattern B optimistic updates only for POS order creation** — UI-based for everything else
7. **httpOnly cookies for JWT** — no localStorage for tokens
8. **Single .env.example in server/** — all secrets on backend only
