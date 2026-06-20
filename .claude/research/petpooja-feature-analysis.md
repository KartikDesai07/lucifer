# PetPooja Feature Analysis — Scope Reference

**Date:** 2026-06-20
**Purpose:** Understand what PetPooja does so we know what to include vs. exclude for Lucifer Cafe

---

## PetPooja Core Features (Reference)

### What PetPooja Has
- POS terminal (billing)
- Menu management (categories, items, variants, modifiers)
- Table management (table layout, merge tables)
- Order management (KOT — Kitchen Order Ticket, hold orders)
- Customer management (CRM, loyalty)
- Staff management (roles, permissions, attendance, payroll)
- Inventory management (stock tracking, recipe costing, wastage)
- Reports (daily sales, item-wise, category-wise, payment-mode-wise, GST reports)
- Online ordering integration (Swiggy, Zomato)
- Printer integration (thermal printer, KOT printer)
- GST compliance (tax slabs, HSN codes)
- Multi-branch support
- Feedback / ratings system
- Supplier management
- Expense tracking

---

## What Lucifer Cafe Will Build (Scoped Down)

### In Scope ✅
| Feature | Notes |
|---------|-------|
| POS Terminal | Cart, discounts, payment modes, table assignment |
| Menu Management | Products with categories, price, discount, modifiers, image |
| Category Management | Simple list of category names |
| Order Management | Create, view, filter, status tracking (Pending/Completed) |
| Customer Management | Name, mobile, visit count, total spend, VIP flag |
| Staff Management | Name and mobile only — no roles/permissions |
| Table Management | 8 fixed tables, status (Available/Occupied/Reserved) |
| Reservations | Date, time, guest count, table, status |
| Event Bookings | Event name, advance payment, balance tracking |
| Dashboard | Daily sales, payment mode breakdown, top products |
| Basic Reports | Via dashboard charts (recharts already in use) |

### Out of Scope ❌ (Keep it lightweight)
| Feature | Why Not |
|---------|---------|
| KOT / Kitchen Display | One restaurant, owner operates it — no kitchen separation needed |
| Inventory / Stock Costing | Complex, not requested |
| GST Reports | Not requested, can add later |
| Swiggy / Zomato Integration | Not requested |
| Printer Integration | Not requested |
| Employee Attendance / Payroll | Not requested |
| Online Ordering | Not requested |
| Multi-branch | Explicitly out of scope — single restaurant only |
| Supplier Management | Not requested |
| Feedback System | Not requested |
| Recipe Costing | Not requested |

---

## Key Differentiators (Lucifer vs PetPooja)

1. **Self-hosted** — owner has full data control
2. **No subscription fees** — one-time build
3. **Simpler** — fewer features but faster and easier to use
4. **Single restaurant** — no complexity of multi-branch
5. **Custom design** — not a generic POS look

---

## Feature Parity Checklist (for implementation)

- [x] POS with cart and payment modes
- [x] Table assignment on orders
- [x] Due/credit payment tracking
- [x] Customer visit and spend tracking
- [x] Reservation management
- [x] Event booking with advance tracking
- [ ] Proper backend API (in progress)
- [ ] MongoDB data layer (in progress)
- [ ] Dashboard reports (exists, needs real data)
- [ ] Basic receipt/bill view (nice to have)
