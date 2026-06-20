---
name: routes-and-features
description: All 11 routes, their purpose, and key UI features in Lucifer Cafe POS
metadata:
  type: project
---

# Routes & Features

## Route Map

| Route | File | Size | Purpose |
|-------|------|------|---------|
| `/auth` | `src/routes/auth.tsx` | — | Public: sign in / sign up (email + Google) |
| `/__root` | `src/routes/__root.tsx` | — | Layout shell: sidebar, header, auth guard |
| `/` | `src/routes/index.tsx` | — | Dashboard: daily sales, top products, recent orders, payment split chart |
| `/pos` | `src/routes/pos.tsx` | ~40KB | POS terminal — create/edit orders, cart, payment modes, table assignment |
| `/orders` | `src/routes/orders.tsx` | ~26KB | Order browser: search, filter by table/status, view details, reorder |
| `/products` | `src/routes/products.tsx` | ~11KB | Menu CRUD: add/edit/delete products, image upload, discounts, modifiers |
| `/categories` | `src/routes/categories.tsx` | ~4KB | Category CRUD |
| `/customers` | `src/routes/customers.tsx` | ~9KB | Customer CRUD: track visits, spending, overdue payments |
| `/staff` | `src/routes/staff.tsx` | ~3KB | Staff CRUD |
| `/reservations` | `src/routes/reservations.tsx` | ~8KB | Table reservations: CRUD, status tracking, date/time, guest count |
| `/events` | `src/routes/events.tsx` | ~9KB | Event bookings: CRUD, advance/balance payment tracking |

## Key Feature Details

### POS Terminal (`/pos`) — Core Feature
- Select products from menu grid (filtered by category)
- Cart with quantity controls
- Apply per-order discount (amount, not %)
- Assign to table (T-1 to T-8)
- Select customer (optional)
- Payment modes: Cash, Online, Due, Split, Credit
- Split payment: enter how much cash + how much online
- Order receiver (which staff member)
- Save as Pending or mark Completed

### Orders Browser (`/orders`)
- List all orders sorted by date
- Filter: by table, by status (Pending/Completed), by payment type
- Search by customer name or order ID
- View full order details (items, payment breakdown)
- Quick reorder

### Dashboard (`/`)
- Daily sales total
- Payment mode breakdown (pie/bar chart)
- Top selling products
- Recent orders list
- Due amount tracker

### Table Management
- 8 fixed tables: T-1 through T-8
- Table status tracked separately (`cafe.tableStatus`)
- POS can assign orders to tables
- Reservations also reference tables

### Payment Tracking
- `paidAmount` vs `total` → due amount = total - paidAmount
- `isOrderPaid()`: paidAmount >= total
- `orderDue()`: total - paidAmount
- Color coding: Cash=yellow, Online=blue, Due=red, Split=purple, Credit=red

## Navigation Sidebar
Defined in `src/components/AppSidebar.tsx`:
- Dashboard, POS, Orders, Products, Categories, Customers, Staff, Reservations, Events
