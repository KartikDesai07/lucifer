---
name: design
description: Design system and code patterns for Lucifer Cafe POS — how to build every layer correctly
---

# Lucifer Cafe POS — Design Skill

When building any part of this project, follow these patterns exactly.
This project is: **React 19 (TanStack Start) + Express.js + MongoDB + node-cache**.

---

## 1. Folder Structure (Source of Truth)

```
lucifer/
├── src/                          ← React frontend (TanStack Start)
│   ├── api/                      ← API client functions (axios calls)
│   │   ├── client.ts             ← axios instance configured
│   │   ├── products.api.ts
│   │   ├── orders.api.ts
│   │   ├── customers.api.ts
│   │   ├── categories.api.ts
│   │   ├── staff.api.ts
│   │   ├── reservations.api.ts
│   │   ├── events.api.ts
│   │   └── tables.api.ts
│   ├── hooks/                    ← React Query hooks (one per entity)
│   │   ├── use-products.ts
│   │   ├── use-orders.ts
│   │   ├── use-customers.ts
│   │   ├── use-categories.ts
│   │   ├── use-staff.ts
│   │   ├── use-reservations.ts
│   │   ├── use-events.ts
│   │   └── use-tables.ts
│   ├── components/               ← UI components (existing, keep)
│   │   ├── ui/                   ← shadcn/ui (never edit these)
│   │   └── AppSidebar.tsx
│   ├── routes/                   ← Page components (existing, keep UI)
│   ├── lib/
│   │   └── utils.ts              ← keep; remove storage.ts after migration
│   └── styles.css
│
├── server/                       ← Express backend (NEW)
│   ├── src/
│   │   ├── config/
│   │   │   └── db.ts             ← Mongoose connect()
│   │   ├── models/               ← Mongoose schemas + models
│   │   │   ├── Product.model.ts
│   │   │   ├── Category.model.ts
│   │   │   ├── Customer.model.ts
│   │   │   ├── Order.model.ts
│   │   │   ├── Staff.model.ts
│   │   │   ├── Reservation.model.ts
│   │   │   ├── Event.model.ts
│   │   │   └── Table.model.ts
│   │   ├── controllers/          ← Thin handlers (req → service → res)
│   │   │   ├── products.controller.ts
│   │   │   ├── orders.controller.ts
│   │   │   ├── customers.controller.ts
│   │   │   ├── categories.controller.ts
│   │   │   ├── staff.controller.ts
│   │   │   ├── reservations.controller.ts
│   │   │   ├── events.controller.ts
│   │   │   ├── tables.controller.ts
│   │   │   └── auth.controller.ts
│   │   ├── services/             ← Business logic
│   │   │   ├── products.service.ts
│   │   │   ├── orders.service.ts
│   │   │   ├── customers.service.ts
│   │   │   ├── auth.service.ts
│   │   │   └── ...
│   │   ├── repositories/         ← MongoDB queries (Mongoose calls only here)
│   │   │   ├── products.repo.ts
│   │   │   ├── orders.repo.ts
│   │   │   └── ...
│   │   ├── routes/               ← Express routers
│   │   │   ├── index.ts          ← mount all routers
│   │   │   ├── products.routes.ts
│   │   │   └── ...
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts    ← JWT verification
│   │   │   ├── cache.middleware.ts   ← node-cache read/write
│   │   │   ├── validate.middleware.ts ← Zod validation
│   │   │   └── error.middleware.ts   ← global error handler
│   │   ├── cache/
│   │   │   └── index.ts          ← NodeCache instance + helpers
│   │   ├── utils/
│   │   │   └── asyncHandler.ts   ← try/catch wrapper for controllers
│   │   └── app.ts                ← Express app setup + entry
│   ├── .env                      ← SECRETS (never committed)
│   ├── .env.example              ← Template (committed)
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                       ← Shared Zod schemas + inferred types
│   ├── schemas/
│   │   ├── product.schema.ts
│   │   ├── order.schema.ts
│   │   ├── customer.schema.ts
│   │   ├── category.schema.ts
│   │   ├── staff.schema.ts
│   │   ├── reservation.schema.ts
│   │   ├── event.schema.ts
│   │   └── index.ts              ← re-export all
│   └── types/
│       └── index.ts              ← non-Zod shared types (enums, constants)
│
├── .claude/
├── .claude-memory/
├── package.json                  ← root (frontend scripts)
└── ...existing config files
```

---

## 2. Shared Schema Pattern

Every entity schema lives in `shared/schemas/<entity>.schema.ts`.

```typescript
// shared/schemas/order.schema.ts
import { z } from 'zod'

export const orderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number().min(0),
  qty: z.number().int().min(1),
  modifiers: z.array(z.string()).default([]),
  instructions: z.string().optional(),
})

export const createOrderSchema = z.object({
  customerName: z.string().min(1),
  customerId: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0),
  discount: z.number().min(0).default(0),
  total: z.number().min(0),
  paidAmount: z.number().min(0),
  payment: z.enum(['Cash', 'Online', 'Due', 'Split', 'Credit']),
  status: z.enum(['Pending', 'Completed']).default('Pending'),
  receiver: z.string().min(1),
  tableNo: z.string().optional(),
})

export const updateOrderSchema = createOrderSchema.partial()

export type OrderItem = z.infer<typeof orderItemSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>
```

---

## 3. Mongoose Model Pattern

```typescript
// server/src/models/Order.model.ts
import mongoose, { Schema, Document } from 'mongoose'
import type { CreateOrderInput, OrderItem } from '../../../shared/schemas/order.schema'

export interface IOrder extends Document, Omit<CreateOrderInput, 'items'> {
  orderId: string   // "ORD-20260620-001"
  items: OrderItem[]
  date: Date
  createdAt: Date
  updatedAt: Date
}

const orderItemSchema = new Schema<OrderItem>({
  productId: { type: String, required: true },
  name:      { type: String, required: true },
  price:     { type: Number, required: true },
  qty:       { type: Number, required: true },
  modifiers: [String],
  instructions: String,
}, { _id: false })  // ← _id: false for embedded subdocuments

const orderSchema = new Schema<IOrder>({
  orderId:      { type: String, required: true, unique: true },
  date:         { type: Date, default: Date.now },
  customerId:   String,
  customerName: { type: String, required: true },
  items:        { type: [orderItemSchema], required: true },
  subtotal:     { type: Number, required: true },
  discount:     { type: Number, default: 0 },
  total:        { type: Number, required: true },
  paidAmount:   { type: Number, required: true },
  payment:      { type: String, enum: ['Cash','Online','Due','Split','Credit'], required: true },
  status:       { type: String, enum: ['Pending','Completed'], default: 'Pending' },
  receiver:     { type: String, required: true },
  tableNo:      String,
}, { timestamps: true })

// Indexes for POS query patterns
orderSchema.index({ date: -1 })
orderSchema.index({ status: 1 })
orderSchema.index({ tableNo: 1 })
orderSchema.index({ customerId: 1 })

export const Order = mongoose.model<IOrder>('Order', orderSchema)
```

---

## 4. Controller Pattern (Thin)

```typescript
// server/src/controllers/orders.controller.ts
import { Request, Response } from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { ordersService } from '../services/orders.service'

export const getOrders = asyncHandler(async (req: Request, res: Response) => {
  const { status, tableNo, date } = req.query
  const orders = await ordersService.getAll({ status, tableNo, date } as any)
  res.json({ success: true, data: orders })
})

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await ordersService.create(req.body)
  res.status(201).json({ success: true, data: order })
})
```

---

## 5. Service Pattern (Business Logic)

```typescript
// server/src/services/orders.service.ts
import { ordersRepo } from '../repositories/orders.repo'
import { customersRepo } from '../repositories/customers.repo'
import type { CreateOrderInput } from '../../../shared/schemas/order.schema'
import { cache } from '../cache'

export const ordersService = {
  async getAll(filters: { status?: string; tableNo?: string }) {
    return ordersRepo.findAll(filters)
  },

  async create(data: CreateOrderInput) {
    // Generate human-readable order ID
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const count = await ordersRepo.countToday()
    const orderId = `ORD-${today}-${String(count + 1).padStart(3, '0')}`

    const order = await ordersRepo.create({ ...data, orderId })

    // Update customer stats on order creation
    if (data.customerId) {
      await customersRepo.incrementStats(data.customerId, data.total)
    }

    // Invalidate related caches
    cache.del('tables')
    // Orders are never cached, so no invalidation needed

    return order
  },
}
```

---

## 6. Repository Pattern (DB Queries Only)

```typescript
// server/src/repositories/orders.repo.ts
import { Order } from '../models/Order.model'
import type { CreateOrderInput } from '../../../shared/schemas/order.schema'

export const ordersRepo = {
  findAll(filters: { status?: string; tableNo?: string }) {
    const query: Record<string, unknown> = {}
    if (filters.status) query.status = filters.status
    if (filters.tableNo) query.tableNo = filters.tableNo
    return Order.find(query).sort({ date: -1 }).lean()
  },

  findById(id: string) {
    return Order.findById(id).lean()
  },

  create(data: CreateOrderInput & { orderId: string }) {
    return Order.create(data)
  },

  updateById(id: string, data: Partial<CreateOrderInput>) {
    return Order.findByIdAndUpdate(id, data, { new: true }).lean()
  },

  deleteById(id: string) {
    return Order.findByIdAndDelete(id)
  },

  countToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end   = new Date(); end.setHours(23, 59, 59, 999)
    return Order.countDocuments({ date: { $gte: start, $lte: end } })
  },
}
```

---

## 7. Middleware Pattern

### asyncHandler
```typescript
// server/src/utils/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from 'express'

export const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
```

### Zod Validation Middleware
```typescript
// server/src/middleware/validate.middleware.ts
import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

export const validate = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      })
    }
    req.body = result.data  // replace with parsed+coerced data
    next()
  }
```

### Global Error Handler
```typescript
// server/src/middleware/error.middleware.ts
import { Request, Response, NextFunction } from 'express'

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.statusCode ?? err.status ?? 500
  const message = err.message ?? 'Internal Server Error'

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${req.method}] ${req.path}`, err)
  }

  res.status(status).json({ success: false, error: message })
}
```

### node-cache Middleware
```typescript
// server/src/cache/index.ts
import NodeCache from 'node-cache'

export const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 })

// Cache TTLs (seconds)
export const TTL = {
  PRODUCTS: 300,    // 5 min — menu changes rarely
  CATEGORIES: 300,  // 5 min
  CUSTOMERS: 120,   // 2 min
  STAFF: 300,       // 5 min
  TABLES: 30,       // 30 sec — live table status
  ORDERS: 0,        // NO cache — always fresh
  RESERVATIONS: 60, // 1 min
  EVENTS: 60,       // 1 min
}
```

```typescript
// server/src/middleware/cache.middleware.ts
import { Request, Response, NextFunction } from 'express'
import { cache } from '../cache'

export const cacheMiddleware = (key: string, ttl: number) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (ttl === 0) return next()  // skip cache entirely

    const cached = cache.get(key)
    if (cached) {
      return res.json({ success: true, data: cached, fromCache: true })
    }

    // Intercept res.json to store in cache
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (res.statusCode === 200 && body?.success) {
        cache.set(key, body.data, ttl)
      }
      return originalJson(body)
    }
    next()
  }
```

---

## 8. React Query Hook Pattern

```typescript
// src/hooks/use-orders.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ordersApi } from '../api/orders.api'
import { toast } from 'sonner'
import type { CreateOrderInput } from '../../shared/schemas/order.schema'

export const ORDER_KEYS = {
  all: ['orders'] as const,
  filtered: (f: object) => ['orders', f] as const,
}

export function useOrders(filters?: object) {
  return useQuery({
    queryKey: filters ? ORDER_KEYS.filtered(filters) : ORDER_KEYS.all,
    queryFn: () => ordersApi.getAll(filters),
    staleTime: 0,       // orders always fresh
    gcTime: 5 * 60000,  // keep in cache 5 min after unmount
  })
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateOrderInput) => ordersApi.create(data),
    onMutate: async (newOrder) => {
      // Pattern B: cache-based optimistic update for immediate POS feedback
      await qc.cancelQueries({ queryKey: ORDER_KEYS.all })
      const snapshot = qc.getQueryData(ORDER_KEYS.all)
      qc.setQueryData(ORDER_KEYS.all, (old: any[] = []) => [
        { ...newOrder, _id: 'optimistic', status: 'Pending' },
        ...old,
      ])
      return { snapshot }
    },
    onError: (err, _, ctx) => {
      qc.setQueryData(ORDER_KEYS.all, ctx?.snapshot)
      toast.error('Order failed — please retry')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all })
      qc.invalidateQueries({ queryKey: ['tables'] })  // refresh table status
    },
    onSuccess: () => toast.success('Order created'),
  })
}

export function useUpdateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CreateOrderInput>) =>
      ordersApi.update(id, data),
    // Pattern A: UI-based — simpler, good enough for status changes
    onSettled: () => qc.invalidateQueries({ queryKey: ORDER_KEYS.all }),
    onError: () => toast.error('Update failed'),
  })
}
```

---

## 9. API Client Pattern

```typescript
// src/api/client.ts
import axios from 'axios'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api',
  withCredentials: true,  // send httpOnly cookies for auth
  headers: { 'Content-Type': 'application/json' },
})

// Global error interceptor — let React Query handle retries
apiClient.interceptors.response.use(
  res => res.data,
  err => Promise.reject(err.response?.data ?? err)
)
```

```typescript
// src/api/orders.api.ts
import { apiClient } from './client'
import type { CreateOrderInput } from '../../shared/schemas/order.schema'

export const ordersApi = {
  getAll: (filters?: object) => apiClient.get('/orders', { params: filters }),
  getById: (id: string) => apiClient.get(`/orders/${id}`),
  create: (data: CreateOrderInput) => apiClient.post('/orders', data),
  update: (id: string, data: object) => apiClient.put(`/orders/${id}`, data),
  delete: (id: string) => apiClient.delete(`/orders/${id}`),
}
```

---

## 10. JWT Auth Pattern

```typescript
// server/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export const protect = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.accessToken
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!)
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Token invalid or expired' })
  }
}
```

```typescript
// server/src/controllers/auth.controller.ts
// Login: issue access token (15min) in httpOnly cookie + refresh token (7d) in httpOnly cookie
// Refresh: verify refresh token → issue new access token
// Logout: clear both cookies
```

---

## 11. Environment Variables

### Frontend (src/.env.local)
```env
VITE_API_URL=http://localhost:3001/api
```

### Backend (server/.env) — NEVER commit
```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/lucifer-cafe
JWT_SECRET=<random 64-char string>
JWT_REFRESH_SECRET=<different random 64-char string>
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CORS_ORIGIN=http://localhost:5173
```

### Backend (server/.env.example) — commit this
```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/lucifer-cafe
JWT_SECRET=your-jwt-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CORS_ORIGIN=http://localhost:5173
```

---

## 12. React Query Client Config

```typescript
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,   // 2 min default — override per hook
      gcTime: 10 * 60 * 1000,     // 10 min in cache after unmount
      retry: 1,                    // retry once on failure
      refetchOnWindowFocus: false, // POS app — don't refetch on tab switch
    },
    mutations: {
      retry: 0,  // never retry mutations
    },
  },
})
```

---

## Rules Summary

1. **No secrets in frontend** — VITE_ vars are public. Backend .env only for secrets.
2. **No DB calls in controllers** — controllers call services, services call repos, repos call Mongoose.
3. **Subdoc.save() is a no-op** — always call parent `.save()` or use `findByIdAndUpdate`.
4. **cancelQueries before setQueryData** — always, in cache-based optimistic updates.
5. **invalidateQueries in onSettled** — always, even after onError rollback.
6. **Orders are never cached on backend** — always fresh from DB.
7. **Shared schemas are the type source of truth** — no manual type duplication.
8. **asyncHandler wraps every controller** — no bare try/catch in controllers.
9. **Zod validate on both frontend (form) and backend (middleware)** — double validation.
10. **Single restaurant** — no restaurantId, no tenancy, no per-user isolation.
