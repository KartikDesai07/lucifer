# Phase 2 — Database Models & Seed Data

**Status:** ⏳ Pending  
**Prerequisites:** Phase 1 complete (Auth working)  
**Estimated time:** 1 day

---

## Goal

All 8 Mongoose models created with proper schemas, indexes, and TypeScript types.
Zod schemas created in `schemas/` (shared across API routes + forms).
Tables seeded (8 records: T-1 to T-8).
All models work with the global connection from `lib/db.ts`.

---

## Steps

### Step 2.1 — Create Product model
```typescript
// models/Product.ts
const productSchema = new Schema({
  name:      { type: String, required: true, trim: true },
  category:  { type: String, required: true },        // denormalized category name
  price:     { type: Number, required: true, min: 0 },
  discount:  { type: Number, default: 0, min: 0, max: 100 }, // percentage
  stock:     { type: Number, default: 0 },
  image:     { type: String, default: '' },           // Cloudinary public_id
  modifiers: [{ type: String }],
  isActive:  { type: Boolean, default: true },
}, { timestamps: true })

productSchema.index({ category: 1 })
productSchema.index({ name: 'text' })
```

### Step 2.2 — Create Category model
```typescript
// models/Category.ts
const categorySchema = new Schema({
  name:  { type: String, required: true, unique: true, trim: true },
  order: { type: Number, default: 0 }, // display order in POS
}, { timestamps: true })

categorySchema.index({ order: 1 })
```

### Step 2.3 — Create Customer model
```typescript
// models/Customer.ts
const customerSchema = new Schema({
  name:       { type: String, required: true, trim: true },
  mobile:     { type: String, required: true, unique: true },
  visits:     { type: Number, default: 0 },
  totalSpend: { type: Number, default: 0 },
  totalDue:   { type: Number, default: 0 }, // outstanding balance
  notes:      { type: String, enum: ['Regular', 'VIP'], default: 'Regular' },
}, { timestamps: true })

customerSchema.index({ mobile: 1 }, { unique: true })
customerSchema.index({ name: 'text' })
```

### Step 2.4 — Create Order model (most complex — with embedded OrderItem)
```typescript
// models/Order.ts
const orderItemSchema = new Schema({
  productId:    { type: String, required: true },
  name:         { type: String, required: true }, // denormalized
  price:        { type: Number, required: true },
  qty:          { type: Number, required: true, min: 1 },
  modifiers:    [{ type: String }],
  instructions: { type: String, default: '' },
}, { _id: false }) // embedded — no _id needed

const orderSchema = new Schema({
  orderId:      { type: String, required: true, unique: true }, // ORD-20260620-001
  customerId:   { type: String },          // optional
  customerName: { type: String, required: true },
  items:        { type: [orderItemSchema], required: true },
  subtotal:     { type: Number, required: true },
  discount:     { type: Number, default: 0 },
  total:        { type: Number, required: true },
  paidAmount:   { type: Number, required: true },
  payment:      { type: String, enum: ['Cash','Online','Due','Split','Credit'], required: true },
  splitCash:    { type: Number },          // for Split payment
  splitOnline:  { type: Number },          // for Split payment
  status:       { type: String, enum: ['Pending','Completed'], default: 'Pending' },
  receiver:     { type: String, required: true }, // staff name
  tableNo:      { type: String },          // optional T-1 to T-8
  notes:        { type: String },          // order-level notes
}, { timestamps: true })

orderSchema.index({ createdAt: -1 })
orderSchema.index({ status: 1 })
orderSchema.index({ tableNo: 1 })
orderSchema.index({ customerId: 1 })
orderSchema.index({ orderId: 1 }, { unique: true })
```

### Step 2.5 — Create Reservation model
```typescript
// models/Reservation.ts
const reservationSchema = new Schema({
  name:    { type: String, required: true },
  mobile:  { type: String, required: true },
  date:    { type: String, required: true }, // YYYY-MM-DD
  time:    { type: String, required: true }, // HH:MM
  guests:  { type: Number, required: true, min: 1 },
  tableNo: { type: String },
  notes:   { type: String },
  status:  { type: String, enum: ['Booked','Seated','Completed','Cancelled'], default: 'Booked' },
}, { timestamps: true })

reservationSchema.index({ date: 1, status: 1 })
```

### Step 2.6 — Create Event model
```typescript
// models/Event.ts
const eventSchema = new Schema({
  name:      { type: String, required: true },
  mobile:    { type: String, required: true },
  date:      { type: String, required: true },
  time:      { type: String, required: true },
  eventName: { type: String, required: true },
  notes:     { type: String },
  payable:   { type: Number, required: true, min: 0 }, // total amount
  advance:   { type: Number, required: true, default: 0 }, // paid upfront
  payMode:   { type: String, enum: ['Cash','Online','Credit'], required: true },
  status:    { type: String, enum: ['Booked','Completed','Cancelled'], default: 'Booked' },
}, { timestamps: true })

eventSchema.index({ date: 1 })
```

### Step 2.7 — Create Table model
```typescript
// models/Table.ts
const tableSchema = new Schema({
  tableNo:        { type: String, required: true, unique: true }, // T-1 to T-8
  status:         { type: String, enum: ['Available','Occupied','Reserved'], default: 'Available' },
  currentOrderId: { type: String },   // orderId of active order
  capacity:       { type: Number, default: 4 },
}, { timestamps: true })
```

### Step 2.8 — Create Zod schemas in schemas/

For each entity, create `schemas/{entity}.schema.ts` following this pattern:
```typescript
// schemas/order.schema.ts
import { z } from 'zod'

export const orderItemSchema = z.object({
  productId:    z.string().min(1),
  name:         z.string().min(1),
  price:        z.number().min(0),
  qty:          z.number().int().min(1),
  modifiers:    z.array(z.string()).default([]),
  instructions: z.string().optional().default(''),
})

export const createOrderSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerId:   z.string().optional(),
  items:        z.array(orderItemSchema).min(1, 'Cart cannot be empty'),
  subtotal:     z.number().min(0),
  discount:     z.number().min(0).default(0),
  total:        z.number().min(0),
  paidAmount:   z.number().min(0),
  payment:      z.enum(['Cash','Online','Due','Split','Credit']),
  splitCash:    z.number().optional(),
  splitOnline:  z.number().optional(),
  status:       z.enum(['Pending','Completed']).default('Pending'),
  receiver:     z.string().min(1),
  tableNo:      z.string().optional(),
  notes:        z.string().optional(),
})

export const updateOrderSchema = createOrderSchema.partial()

export type OrderItem = z.infer<typeof orderItemSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>
```

Create schemas for: product, category, customer, order, staff, reservation, event

### Step 2.9 — Create schemas/index.ts
```typescript
export * from './product.schema'
export * from './category.schema'
export * from './customer.schema'
export * from './order.schema'
export * from './staff.schema'
export * from './reservation.schema'
export * from './event.schema'
```

### Step 2.10 — Create seed script for tables
```typescript
// scripts/seed-tables.ts
// Creates 8 table documents if they don't exist
const tables = ['T-1','T-2','T-3','T-4','T-5','T-6','T-7','T-8']
for (const tableNo of tables) {
  await Table.findOneAndUpdate(
    { tableNo },
    { tableNo, status: 'Available', capacity: 4 },
    { upsert: true }
  )
}
console.log('8 tables seeded')
```

Add `"seed:tables": "ts-node scripts/seed-tables.ts"` to package.json

### Step 2.11 — Create combined seed script
```typescript
// scripts/seed.ts
// Runs seed-admin + seed-tables in sequence
```
Add `"seed": "ts-node scripts/seed.ts"` to package.json

### Step 2.12 — Update types/index.ts
Export all TypeScript types from Zod schemas:
```typescript
export type { CreateOrderInput, UpdateOrderInput, OrderItem } from '@/schemas/order.schema'
export type { CreateProductInput } from '@/schemas/product.schema'
// ... etc
```

---

## Model Checklist

| Model | Schema | Index | Zod Schema | Seeds |
|-------|--------|-------|-----------|-------|
| Staff | ✓ | username unique | ✓ | admin |
| Product | ✓ | category, text | ✓ | — |
| Category | ✓ | order | ✓ | — |
| Customer | ✓ | mobile, text | ✓ | — |
| Order | ✓ | date, status, tableNo | ✓ | — |
| Reservation | ✓ | date+status | ✓ | — |
| Event | ✓ | date | ✓ | — |
| Table | ✓ | tableNo unique | ✓ | T-1 to T-8 |

---

## Checkpoint Criteria

- [ ] All 8 models compile with no TypeScript errors
- [ ] `npm run seed` creates admin + 8 tables in MongoDB
- [ ] MongoDB Compass shows: `staff` collection (1 doc), `tables` collection (8 docs)
- [ ] `npm run build` passes
- [ ] All Zod schemas have matching TypeScript types exported

---

## Next Session Prompt

```
Phase 3 — Core API Routes + Caching

Context: Phase 2 complete. All 8 Mongoose models created. Zod schemas done.
Tables seeded (T-1 to T-8). Admin account exists.

Resume from: Step 3.1 — Create helper functions for API routes
Check: npm run build must pass. MongoDB must show 8 tables in Atlas.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-03-core-api.md before starting.
```
