---
name: data-models
description: All 7 entity types with full field definitions — source of truth for MongoDB schema design
metadata:
  type: project
---

# Data Models

## Phase 2 — Implemented as Mongoose models (2026-06-20)

All 8 entities are now real Mongoose models in `models/*.ts` with Zod schemas in
`schemas/*.schema.ts`. **Read those files for exact fields** — below records only
non-obvious decisions/deltas from the legacy types:

- **Category** is now a real collection: `{ name (unique), order }` — no longer a bare string.
- **Customer** gained `totalDue` (outstanding balance). `notes` is the `Regular|VIP` enum (legacy name kept).
- **Order**: order-level `discount` is an **amount** (₹), not a percentage; Product `discount` is a percentage (0-100). Ordering uses `createdAt` (timestamps), **no separate `date` string field**. `items` are embedded `OrderItem` subdocs (`_id:false`). `orderId` (ORD-YYYYMMDD-NNN) is `unique`. `splitCash`/`splitOnline` optional (Split payment).
- **Table** seeded T-1..T-8 (status `Available`, capacity 4); seed is idempotent (`$setOnInsert`).
- **Enums centralized** in `lib/constants.ts`: PAYMENT_MODES, EVENT_PAY_MODES (Cash/Online/Credit subset), ORDER_STATUSES, RESERVATION_STATUSES, EVENT_STATUSES, CUSTOMER_NOTES, TABLE_STATUSES, STAFF_ROLES. Models use `[...CONST]`; Zod uses `z.enum(CONST)`.
- **Zod naming convention:** every inferred type uses the `...Input` suffix (`CreateOrderInput`, `OrderItemInput`, etc.); re-exported from `types/index.ts` and `schemas/index.ts`.

## Phase 7 — Settings model + Order.gstAmount (2026-06-21)

- **Settings** (`models/Settings.ts`) — **singleton** doc (the 9th model). Fields: `restaurantName`, `tagline`, `mobile`, `address`, `receiptHeader`, `receiptFooter`, `gstEnabled` (bool), `gstNumber`, `gstRate` (number %), `gstMode` (`inclusive|exclusive`, enum `GST_MODES`), `kotShowPrices` (bool). Always read/written via `findOne()` / `findOneAndUpdate({},…,{upsert:true})`; `/api/settings` GET creates it with model defaults on first read. Zod = `settings.schema.ts` (`settingsSchema` has **no `.default()`** so the form types `useForm<z.infer>` directly; `updateSettingsSchema = .partial()` for PUT).
- **Order gained `gstAmount`** (number, default 0) — the GST **added on top** when `gstMode==='exclusive'` (so `total = subtotal − discount + gstAmount`). Inclusive mode stores 0 and the receipt back-calculates the tax portion from `total` (see `lib/receipt.ts`).
- **New enums** in `lib/constants.ts`: `GST_MODES` (`inclusive|exclusive`), `GST_RATES` ([0,5,12,18,28] quick-picks). `ADMIN_ROUTES` += `/settings`.

## Phase 3 (P3 growth) Step 3 — Open tabs / running orders (2026-06-23)

- **New payment mode `"Unpaid"`** added to `PAYMENT_MODES` (badge label **"Open"** via `PAY_STYLES.Unpaid` slate; `PAYMENT_COLORS.Unpaid`). Represents a held/open tab: `status:"Pending"`, `paidAmount:0`, customer optional. **It is NOT a settlement mode** — `SETTLEMENT_PAY_MODES`/`SettlementPayMode` (the 5 real modes) drive the payment modal grid + the dashboard payment-mix; a tab can never be *completed* as Unpaid (Zod `createOrderSchema` superRefine: "Unpaid must be Pending").
- **Order gained `kotRounds`** (number, default 0 = count of KOT rounds fired) and **OrderItem gained `kotRound`** (number, default 0 = the round a line was fired in; 0 = legacy/unsent). A normal POST stamps the opening items `kotRound:1`, `kotRounds:1`. The add-items endpoint bumps the round and stamps only the new lines.
- **A tab is ONE order** from open → settle (same `orderId`; no new order number on add/settle).
- **Customer-ledger model is now `ledgerContribution(order)`** (lib/order.ts): Unpaid → `{0,0,0}` (an open tab is neither a sale nor a receivable until settled); else `{visits:1, spend:total, due:max(0,total−paid)}`. Create/PUT/DELETE/settle all express the ledger as deltas of this (`reconcileLedger(old, updated|null)`), so held→settle applies the full effect exactly once at settlement. Behaviour-identical to the prior inline math for every non-Unpaid path.
- **`updateOrderSchema` HARDENED**: PUT `/api/orders/[id]` now edits only `{customerName, customerId, tableNo, notes}` (`.pick().partial().strict()`). Money + `status` are server-owned and mutated ONLY via `/items` (fire a round) and `/settle` (take payment). The old "Mark complete" PUT-status path was removed.

---

# Legacy TypeScript Types (pre-migration reference)

Source: `src/lib/storage.ts`

## Product
```typescript
type Product = {
  id: string;
  name: string;
  category: string;           // category name (string, not FK)
  price: number;
  discount: number;           // percentage 0-100
  available: boolean;         // in-stock / "86" toggle (P3 Step 4; was numeric `stock`) — POS-disabled when false
  isActive: boolean;          // false = archived (soft-delete)
  image?: string;             // Cloudinary public_id
  modifiers?: string[];       // e.g. ["Extra Cheese", "No Onion"]
}
```

## Category
```typescript
type Category = string;       // just the name, no ID
```

## Customer
```typescript
type Customer = {
  id: string;
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  notes: "Regular" | "VIP";
}
```

## OrderItem
```typescript
type OrderItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
  instructions?: string;
}
```

## Order
```typescript
type Order = {
  id: string;                 // format: ORD-YYYYMMDD-NNN
  date: string;               // ISO string
  customerId?: string;
  customerName: string;
  items: OrderItem[];         // embedded
  subtotal: number;
  discount: number;           // amount (not %)
  total: number;
  paidAmount: number;
  payment: "Cash" | "Online" | "Due" | "Split" | "Credit";
  status: "Pending" | "Completed";
  receiver: string;           // staff name who received payment
  tableNo?: string;           // e.g. "T-1" through "T-8"
}
```

## Staff
**Implemented as a Mongoose model in Phase 1** (`models/Staff.ts`) — extended from the
legacy `{id,name,mobile}` shape with the auth fields below:
```typescript
type Staff = {
  id: string;
  name: string;
  mobile: string;
  username: string;            // unique, lowercase, trimmed
  password: string;            // bcrypt hash (12 rounds); schema select:false
  role: "admin" | "staff";     // default "staff"
  isActive: boolean;           // default true; only active users can log in
  createdAt: Date;             // timestamps:true
  updatedAt: Date;
}
```
- Never returned by default — `password` has `select:false`; opt in with `.select('+password')`.
- Login matches on `{ username (lowercased), isActive:true }` then `bcrypt.compare`.
- Initial admin seeded via `npm run seed:admin` (admin / Admin@123 — change after first login).

## Reservation
```typescript
type Reservation = {
  id: string;
  name: string;
  mobile: string;
  date: string;               // YYYY-MM-DD
  time: string;               // HH:MM
  guests: number;
  tableNo?: string;
  notes?: string;
  status: "Booked" | "Seated" | "Completed" | "Cancelled";
}
```

## EventBooking
```typescript
type EventBooking = {
  id: string;
  name: string;
  mobile: string;
  date: string;
  time: string;
  eventName: string;
  notes?: string;
  payable: number;            // total amount
  advance: number;            // paid upfront
  payMode: "Cash" | "Online" | "Credit";
  status: "Booked" | "Completed" | "Cancelled";
}
```

## Constants
```typescript
const TABLE_NUMBERS = ["T-1","T-2","T-3","T-4","T-5","T-6","T-7","T-8"];

const PAY_STYLES = {
  Cash:   { color: "yellow", label: "Cash" },
  Online: { color: "blue",   label: "Online" },
  Due:    { color: "red",    label: "Due" },
  Split:  { color: "purple", label: "Split" },
  Credit: { color: "red",    label: "Credit" },
}
```

**How to apply:** Use these exact field names and types when designing MongoDB collections. OrderItem is embedded in Order (not a separate collection). Categories are just strings but will need an ID in MongoDB.
