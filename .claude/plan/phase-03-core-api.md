# Phase 3 — Core API Routes + Caching

**Status:** ⏳ Pending  
**Prerequisites:** Phase 2 complete (all models + Zod schemas)  
**Estimated time:** 2 days

---

## Goal

All CRUD API routes operational. node-cache integrated.
Every endpoint: validated (Zod), authenticated (session check), cached (where appropriate).
By end of phase: Postman/Thunder can hit all endpoints and get correct responses.

---

## API Route Structure (All Routes)

```
GET    /api/products              list all (cached 5min)
POST   /api/products              create (clear cache)
GET    /api/products/[id]         single
PUT    /api/products/[id]         update (clear cache)
DELETE /api/products/[id]         delete (clear cache)

GET    /api/categories            list (cached 5min)
POST   /api/categories            create (clear cache)
DELETE /api/categories/[id]       delete (clear cache, also update orphaned products)

GET    /api/customers             list (cached 2min)
POST   /api/customers             create (clear cache)
GET    /api/customers/[id]        single
PUT    /api/customers/[id]        update (clear cache)
DELETE /api/customers/[id]        delete (clear cache)

GET    /api/orders                list (NO cache, always fresh)
                                  Query: ?status=&tableNo=&date=&limit=
POST   /api/orders                create (update customer stats, update table status, clear table cache)
GET    /api/orders/[id]           single order
PUT    /api/orders/[id]           update status/details
DELETE /api/orders/[id]           delete
GET    /api/orders/summary        daily summary for dashboard

GET    /api/staff                 list (cached 5min, admin only)
POST   /api/staff                 create (admin only, hash password)
GET    /api/staff/[id]            single (admin only)
PUT    /api/staff/[id]            update (admin only)
DELETE /api/staff/[id]            soft delete: set isActive=false (admin only)
POST   /api/staff/change-password change own password

GET    /api/tables                list all 8 with status (cached 30s)
PUT    /api/tables/[tableNo]      update status (clear table cache)

GET    /api/reservations          list (cached 1min)
POST   /api/reservations          create (clear cache)
PUT    /api/reservations/[id]     update
DELETE /api/reservations/[id]     delete (clear cache)

GET    /api/events                list (cached 1min)
POST   /api/events                create (clear cache)
PUT    /api/events/[id]           update
DELETE /api/events/[id]           delete (clear cache)

POST   /api/upload                sign Cloudinary upload (returns signature)
DELETE /api/upload                delete from Cloudinary
```

---

## Steps

### Step 3.1 — Create API helper utilities
```typescript
// lib/api-helpers.ts
import { NextResponse } from 'next/server'
import { ZodSchema } from 'zod'
import { auth } from './auth'

export function success(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

export function created(data: unknown) {
  return success(data, 201)
}

export function error(message: string, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status })
}

export function validationError(details: Record<string, string[]>) {
  return NextResponse.json({ success: false, error: 'Validation failed', details }, { status: 400 })
}

export async function validateBody<T>(req: Request, schema: ZodSchema<T>): Promise<{ data: T } | { error: NextResponse }> {
  const body = await req.json().catch(() => null)
  const result = schema.safeParse(body)
  if (!result.success) return { error: validationError(result.error.flatten().fieldErrors) }
  return { data: result.data }
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) return { error: error('Not authenticated', 401) }
  return { session }
}

export async function requireAdmin() {
  const { session, error: authError } = await requireAuth() as any
  if (authError) return { error: authError }
  if ((session.user as any).role !== 'admin') return { error: error('Admin access required', 403) }
  return { session }
}
```

### Step 3.2 — Products API
```typescript
// app/api/products/route.ts
import { connectDB } from '@/lib/db'
import { Product } from '@/models/Product'
import cache, { TTL } from '@/lib/cache'
import { success, created, error, validateBody, requireAuth } from '@/lib/api-helpers'
import { createProductSchema } from '@/schemas'

const CACHE_KEY = 'products'

export async function GET() {
  try {
    const cached = cache.get(CACHE_KEY)
    if (cached) return success(cached)
    
    await connectDB()
    const products = await Product.find({ isActive: true }).sort({ category: 1, name: 1 }).lean()
    cache.set(CACHE_KEY, products, TTL.PRODUCTS)
    return success(products)
  } catch (e) {
    return error('Failed to fetch products')
  }
}

export async function POST(req: Request) {
  const { session, error: authError } = await requireAuth() as any
  if (authError) return authError
  
  const { data, error: validErr } = await validateBody(req, createProductSchema)
  if (validErr) return validErr
  
  try {
    await connectDB()
    const product = await Product.create(data)
    cache.del(CACHE_KEY)
    return created(product)
  } catch (e: any) {
    return error(e.message ?? 'Failed to create product')
  }
}
```

```typescript
// app/api/products/[id]/route.ts
// GET, PUT, DELETE for single product
// PUT: validate with updateProductSchema, clear cache
// DELETE: set isActive: false (soft delete) or hard delete
```

### Step 3.3 — Orders API (most important)
```typescript
// app/api/orders/route.ts
// GET: NO cache. Filter by status, tableNo, date. Paginate with limit.
// POST: 
//   1. Generate orderId: ORD-YYYYMMDD-NNN
//   2. Create order
//   3. If customerId: increment customer.visits + totalSpend
//   4. If tableNo: update table.status to 'Occupied', set table.currentOrderId
//   5. Clear 'tables' cache
//   6. Return created order
```

```typescript
// app/api/orders/summary/route.ts
// GET: Today's total sales, payment breakdown, order count
// Used by dashboard
// Cache: 2 minutes

export async function GET() {
  const cacheKey = `order-summary-${new Date().toDateString()}`
  const cached = cache.get(cacheKey)
  if (cached) return success(cached)
  
  await connectDB()
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(); end.setHours(23,59,59,999)
  
  const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'Completed' }).lean()
  
  const summary = {
    totalOrders: orders.length,
    totalSales: orders.reduce((sum, o) => sum + o.total, 0),
    totalDue: orders.filter(o => o.payment === 'Due').reduce((sum, o) => sum + (o.total - o.paidAmount), 0),
    paymentBreakdown: {
      Cash: orders.filter(o => o.payment === 'Cash').reduce((s, o) => s + o.paidAmount, 0),
      Online: orders.filter(o => o.payment === 'Online').reduce((s, o) => s + o.paidAmount, 0),
      Due: orders.filter(o => o.payment === 'Due').length,
      Split: orders.filter(o => o.payment === 'Split').length,
    }
  }
  
  cache.set(cacheKey, summary, 120)
  return success(summary)
}
```

### Step 3.4 — Tables API
```typescript
// app/api/tables/route.ts
// GET: return all 8 tables with status (cached 30s)

// app/api/tables/[tableNo]/route.ts
// PUT: update table status + currentOrderId
//      clear 'tables' cache
// Validation: status must be 'Available' | 'Occupied' | 'Reserved'
```

### Step 3.5 — Staff API (admin only)
```typescript
// app/api/staff/route.ts
// GET: requireAdmin(), return all staff excluding password field
// POST: requireAdmin(), hash password, create staff

// app/api/staff/[id]/route.ts
// PUT: requireAdmin(), update staff (if password included: hash it)
// DELETE: requireAdmin(), soft delete (isActive: false)
```

### Step 3.6 — Customers API
```typescript
// GET: list with search by name/mobile
// POST: create, check mobile uniqueness
// PUT: update customer details
// DELETE: soft delete or check for outstanding due first
```

### Step 3.7 — Reservations + Events API
```typescript
// Standard CRUD, similar pattern to products
// Reservations GET: filter by date range, status
// Events GET: filter by date, status
```

### Step 3.8 — Upload API (Cloudinary)
```typescript
// app/api/upload/route.ts
// POST: generate Cloudinary upload signature
//   Use server-side signature for SIGNED uploads (more secure)
//   Returns: { signature, timestamp, cloudName, apiKey }
//   Frontend uses this to upload directly to Cloudinary

// DELETE: delete image from Cloudinary by public_id
import cloudinary from '@/lib/cloudinary'

export async function DELETE(req: Request) {
  const { publicId } = await req.json()
  const result = await cloudinary.uploader.destroy(publicId)
  return success(result)
}
```

### Step 3.9 — Create lib/cloudinary.ts
```typescript
// lib/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export default cloudinary
```

### Step 3.10 — Add orderId generation logic
```typescript
// lib/utils.ts — add to existing
export async function generateOrderId(): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '') // 20260620
  
  const startOfDay = new Date(today.setHours(0,0,0,0))
  const endOfDay = new Date(today.setHours(23,59,59,999))
  
  const count = await Order.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } })
  return `ORD-${dateStr}-${String(count + 1).padStart(3, '0')}`
}
```

### Step 3.11 — Reports API
```typescript
// app/api/reports/route.ts
// GET with query params: startDate, endDate, groupBy
// Returns: orders in range with aggregation

// Aggregations needed:
// - Total sales by date range
// - Sales by payment mode
// - Top 10 products by revenue
// - Customer dues list
// - Day-wise breakdown
```

---

## API Testing Checklist

Use Thunder Client or Postman to verify each endpoint:

| Endpoint | Test | Expected |
|----------|------|----------|
| GET /api/products | No auth | 401 |
| GET /api/products | With session | 200 + array |
| POST /api/products | Missing name | 400 + validation details |
| POST /api/products | Valid body | 201 + product |
| GET /api/orders | With session | 200 + orders array (fresh) |
| POST /api/orders | Valid order | 201 + order with orderId |
| GET /api/tables | With session | 200 + 8 tables |
| GET /api/staff | Staff role | 403 |
| GET /api/staff | Admin role | 200 |

---

## Checkpoint Criteria

- [ ] All endpoints return correct HTTP status codes
- [ ] Zod validation returns 400 with field-level errors
- [ ] Unauthenticated requests return 401
- [ ] Staff accessing admin routes returns 403
- [ ] Products are cached: second GET is faster, cache clears on POST
- [ ] Order creation increments customer totalSpend
- [ ] Order creation updates table status to Occupied
- [ ] `npm run build` passes

---

## Next Session Prompt

```
Phase 4 — POS Terminal UI + Order Flow

Context: Phase 3 complete. All API routes working. Cache integrated.
Authentication verified. Order creation updates customer + table.

Resume from: Step 4.1 — POS Terminal layout and product grid
Check: All API routes respond correctly. npm run build passes.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-04-pos-terminal.md before starting.
```
