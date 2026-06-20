# MongoDB Schema Design — Lucifer Cafe POS

**Date:** 2026-06-20
**Status:** Draft — not yet implemented

---

## Design Principles

1. **Embed when the child never exists alone** — OrderItems are always part of an Order. Embed them.
2. **Reference when the child is large or queried independently** — Products are queried separately from orders. Keep as separate collection.
3. **Single restaurant** — no `restaurantId` on any document. Keep it simple.
4. **Match existing TypeScript types** exactly to minimize frontend changes.

---

## Collections

### `products`
```javascript
{
  _id: ObjectId,
  name: String,           // required
  category: String,       // category name (denormalized for query speed)
  price: Number,          // required, >= 0
  discount: Number,       // 0-100 percentage, default 0
  stock: Number,          // default 0
  image: String,          // base64 data URL or empty
  modifiers: [String],    // array of strings e.g. ["Extra Cheese"]
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:** `{ category: 1 }`, `{ name: 'text' }` (for search)

---

### `categories`
```javascript
{
  _id: ObjectId,
  name: String,           // unique, required
  order: Number,          // display order
  createdAt: Date
}
```
**Indexes:** `{ name: 1 }` unique

---

### `customers`
```javascript
{
  _id: ObjectId,
  name: String,
  mobile: String,         // unique
  visits: Number,         // default 0, increment on each order
  totalSpend: Number,     // default 0, add order.total on each order
  notes: String,          // "Regular" | "VIP"
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:** `{ mobile: 1 }` unique, `{ name: 'text' }`

---

### `orders`
```javascript
{
  _id: ObjectId,
  orderId: String,        // "ORD-20260620-001" — human-readable ID
  date: Date,
  customerId: ObjectId,   // ref: customers (optional)
  customerName: String,   // denormalized for display without join
  items: [
    {
      productId: ObjectId, // ref: products
      name: String,        // denormalized
      price: Number,
      qty: Number,
      modifiers: [String],
      instructions: String
    }
  ],
  subtotal: Number,
  discount: Number,       // discount amount (not %)
  total: Number,
  paidAmount: Number,
  payment: String,        // "Cash" | "Online" | "Due" | "Split" | "Credit"
  status: String,         // "Pending" | "Completed"
  receiver: String,       // staff name
  tableNo: String,        // "T-1" through "T-8" or null
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:** `{ date: -1 }`, `{ status: 1 }`, `{ tableNo: 1 }`, `{ customerId: 1 }`, `{ orderId: 1 }` unique

---

### `staff`
```javascript
{
  _id: ObjectId,
  name: String,
  mobile: String,
  createdAt: Date
}
```

---

### `reservations`
```javascript
{
  _id: ObjectId,
  name: String,
  mobile: String,
  date: String,           // YYYY-MM-DD
  time: String,           // HH:MM
  guests: Number,
  tableNo: String,        // optional
  notes: String,          // optional
  status: String,         // "Booked" | "Seated" | "Completed" | "Cancelled"
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:** `{ date: 1, status: 1 }`

---

### `events`
```javascript
{
  _id: ObjectId,
  name: String,
  mobile: String,
  date: String,           // YYYY-MM-DD
  time: String,           // HH:MM
  eventName: String,
  notes: String,
  payable: Number,        // total amount
  advance: Number,        // amount paid upfront
  payMode: String,        // "Cash" | "Online" | "Credit"
  status: String,         // "Booked" | "Completed" | "Cancelled"
  createdAt: Date,
  updatedAt: Date
}
```

---

### `tables` (new — replaces `cafe.tableStatus` key)
```javascript
{
  _id: ObjectId,
  tableNo: String,        // "T-1" through "T-8" — unique
  status: String,         // "Available" | "Occupied" | "Reserved"
  currentOrderId: ObjectId // optional, ref: orders
}
```
**Seeded on first startup** — 8 documents, one per table.

---

## Notes on Migration from app_kv

- Current IDs are plain strings (UUID-like). MongoDB uses ObjectId. 
  → Strategy: Keep `id` as a string field alongside `_id` for backward compat, or remap on migration.
- `orderId` (human-readable) should be kept exactly — the UI displays "ORD-YYYYMMDD-NNN".
- Categories are currently plain strings — they need an `_id` and `name` in MongoDB.
  → In orders and products, store category name as string (denormalized) to avoid join on every product fetch.
