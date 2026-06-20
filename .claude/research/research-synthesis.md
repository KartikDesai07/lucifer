# Research Synthesis — React 19 + Express POS Architecture (2026-06-20)

> Source: deep-research workflow — 113 agents, 30 sources, 128 claims extracted, 25 verified (15 confirmed / 10 killed)

---

## Verified Findings (High Confidence)

### 1. Environment Variables — HIGHEST RISK
**Vite statically replaces VITE_-prefixed vars at build time.** Their values are permanently visible in the browser bundle.

**Rules for this project:**
- `VITE_API_URL` = OK (just the Express server URL, not a secret)
- `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` = **backend .env ONLY**
- Never proxy secrets through frontend env vars
- `.env*.local` must be in `.gitignore`

---

### 2. React Query v5 — Optimistic Updates (Two Patterns)

**Pattern A — UI-based (simpler, recommended for table/order STATUS updates):**
```typescript
const mutation = useMutation({
  mutationFn: updateOrderStatus,
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['orders'] })
  // isPending + variables gives instant UI feedback without cache writes
})
```

**Pattern B — Cache-based (for order totals, cart state — must be immediately consistent):**
```typescript
const mutation = useMutation({
  mutationFn: createOrder,
  onMutate: async (newOrder) => {
    await queryClient.cancelQueries({ queryKey: ['orders'] }) // ← MUST be first
    const snapshot = queryClient.getQueryData(['orders'])     // ← snapshot before
    queryClient.setQueryData(['orders'], old => [...old, newOrder]) // optimistic
    return { snapshot }                                       // ← return for rollback
  },
  onError: (err, newOrder, ctx) => {
    queryClient.setQueryData(['orders'], ctx.snapshot)        // ← rollback
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })   // ← always sync
  }
})
```

**Known limitation:** Rapid concurrent mutations (like fast POS taps) have a residual race condition even with `cancelQueries`. For POS order creation, use debounce + disable button while `isPending`.

---

### 3. invalidateQueries — Prefix Matching

`invalidateQueries({ queryKey: ['orders'] })` invalidates ALL keys starting with `'orders'`:
- `['orders']` ✓
- `['orders', { status: 'pending' }]` ✓
- `['orders', orderId]` ✓

When a query is **active** (mounted), invalidation triggers an immediate background refetch — not just marking stale.

**Refuted claim:** invalidateQueries does NOT override staleTime — it marks the query stale, which then respects the refetch logic.

---

### 4. MongoDB Schema — Embed vs Reference

**Embed when:** Data is bounded and always read together with parent.
- ✅ Order → `items: OrderItem[]` (max ~50 items per order, always read together)
- ✅ Order → snapshot customer name (denormalize for fast display)

**Reference when:** Data is unbounded or queried independently.
- ✅ Orders are their own collection (not embedded in a "restaurant" doc)
- ✅ Products are separate (queried on their own from the menu grid)
- ✅ Customers are separate (CRM view queries them independently)

**Critical:** `subdoc.save()` is a **no-op** in Mongoose. Only `parentDoc.save()` persists subdocument changes.

---

### 5. Zod Shared Schemas

Place in `shared/schemas/` at project root. Export schema + inferred type together:

```typescript
// shared/schemas/order.schema.ts
export const createOrderSchema = z.object({
  customerName: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
  payment: z.enum(['Cash', 'Online', 'Due', 'Split', 'Credit']),
  tableNo: z.string().optional(),
})
export type CreateOrderInput = z.infer<typeof createOrderSchema>
```

Frontend: `import { createOrderSchema, type CreateOrderInput } from '../../shared/schemas/order.schema'`
Backend: `import { createOrderSchema } from '../../shared/schemas/order.schema'`

**Zod version pin:** Must use same Zod version across frontend + backend. Project currently uses Zod 3.24.2. Pin it. Zod v4 has breaking changes.

---

## Refuted Claims (Do NOT Use)

| Claim | Vote | Action |
|-------|------|--------|
| Redis sub-ms latency for single-restaurant POS | 1-2 | Use node-cache (in-process) instead — simpler, no extra infra |
| TTL of 60-120s for orders, hours for menu | 0-3 | Determine TTL empirically; menu can be 5min, active orders 0 (no cache) |
| DEL command for manual cache invalidation | 0-3 | Use cache.del(key) in write path — this is correct but not Redis-specific |
| MongoDB unnecessary indexes degrade writes | 0-3 | Add indexes for actual query patterns, measure with explain() |
| pnpm-workspace.yaml with apps/+packages/ required | 0-3 | Use simple folder structure, no complex workspace tooling needed |
| TypeScript composite:true required for incremental builds | 0-3 | Standard tsconfig per folder is sufficient for this project size |

---

## Backend Cache Decision: node-cache over Redis

For a single-restaurant POS with one server instance:
- **Redis is overkill** — requires separate process, connection pooling, serialization
- **node-cache** is sufficient — in-process, zero infrastructure, sub-ms access
- If scaling to multiple server instances later, swap node-cache → Redis (same API with ioredis wrapper)

**Cache strategy:**
```
Products/Categories: cache 5 minutes (changes rarely, high read volume from POS menu)
Customers/Staff:     cache 2 minutes (moderate reads)
Orders:              NO cache on reads (always fresh — POS needs real-time accuracy)
Tables:              cache 30 seconds (live table status matters)
Auth tokens:         stored in DB (refresh token family tracking for rotation)
```

---

## Open Questions (Not Resolved by Research)

1. **Specific MongoDB indexes** for POS query patterns — needs profiling with real data
2. **TypeScript project references** configuration across shared/ + server/ + src/ — verify against current TS docs
3. **Zod v4 vs v3** implications if upgrading later
