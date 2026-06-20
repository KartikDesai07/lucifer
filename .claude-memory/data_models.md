---
name: data-models
description: All 7 entity types with full field definitions — source of truth for MongoDB schema design
metadata:
  type: project
---

# Data Models (Current TypeScript Types)

Source: `src/lib/storage.ts`

## Product
```typescript
type Product = {
  id: string;
  name: string;
  category: string;           // category name (string, not FK)
  price: number;
  discount: number;           // percentage 0-100
  stock: number;
  image?: string;             // data URL (base64)
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
```typescript
type Staff = {
  id: string;
  name: string;
  mobile: string;
}
```

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
