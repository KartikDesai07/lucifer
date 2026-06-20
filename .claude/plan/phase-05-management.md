# Phase 5 — Management Pages

**Status:** ⏳ Pending  
**Prerequisites:** Phase 4 complete (POS working)  
**Estimated time:** 2 days

---

## Goal

All management/CRUD pages working:
1. Products (with Cloudinary image upload)
2. Categories
3. Customers (with due tracking)
4. Staff (admin only)
5. Reservations
6. Events
7. Tables (status overview)
8. Orders (list, filter, status update)

Each page: list → search/filter → add → edit → delete. Smooth, no bugs.

---

## Common Page Pattern

Every management page follows this structure:
```
┌─────────────────────────────────────────────┐
│ [Page Title]          [+ Add New]           │
├─────────────────────────────────────────────┤
│ Search: [_______________]  [Filter: All ▼]  │
├─────────────────────────────────────────────┤
│ Table/List of items                         │
│ Row: info | actions (Edit | Delete)         │
├─────────────────────────────────────────────┤
│ Pagination (if >20 items)                   │
└─────────────────────────────────────────────┘
```

Add/Edit: opens as a Sheet (side panel) with form validation.
Delete: opens ConfirmDialog → then DELETE API call.

---

## Steps

### Step 5.1 — Products page
```
Route: /products
Data: useProducts() hook
Actions: Create, Edit, Delete (soft), Upload image

Product form fields:
- Name (required)
- Category (dropdown from useCategories)
- Price (number, required)
- Discount % (0-100)
- Stock count
- Modifiers (tag input — type + Enter)
- Image upload (Cloudinary)

Image upload flow:
1. User selects file
2. POST to /api/upload → get signature
3. Upload directly to Cloudinary with signature
4. On success: store public_id in product.image
5. Show preview from Cloudinary URL

Cache: invalidate ['products'] on create/update/delete
```

### Step 5.2 — Categories page
```
Route: /categories
Data: useCategories() hook
Actions: Create, Reorder (drag or up/down arrows), Delete

Category form: name only
Delete warning: "This will not delete products in this category. Products will show without category."
Cache: invalidate ['categories'] on change
```

### Step 5.3 — Customers page
```
Route: /customers
Data: useCustomers() + search
Actions: Create, Edit, Delete, View order history

Customer table columns:
- Name
- Mobile
- Visits (auto-tracked)
- Total Spend (auto-tracked)
- Due Amount (totalDue field)
- Type (Regular/VIP badge)
- Actions (Edit | History | Delete)

Due amount highlight: red badge if totalDue > 0
Customer form fields: name, mobile, notes (Regular/VIP)
Order history modal: list of past orders for this customer
```

### Step 5.4 — Staff page (Admin only)
```
Route: /staff
Guard: AdminGuard component wraps this page
Data: useStaff() hook
Actions: Create, Edit (name, mobile, username), Deactivate

Staff table columns:
- Name
- Username
- Mobile
- Role (Admin/Staff badge)
- Status (Active/Inactive)
- Actions (Edit | Deactivate)

Staff form fields: name, mobile, username, password (create only), role

Security notes:
- Password field only shown on Create (not Edit)
- Admin cannot deactivate themselves
- Cannot delete admin account (can only deactivate other staff)
```

### Step 5.5 — Orders page
```
Route: /orders
Data: useOrders(filters) hook — NO cache, always fresh

Filters:
- Status: All | Pending | Completed
- Table: All | T-1 to T-8 | Walk-In
- Payment: All | Cash | Online | Due | Split | Credit
- Date: today | yesterday | this week | custom range

Order table columns:
- Order ID (ORD-XXX-XXX)
- Date & Time
- Customer Name
- Items (count + preview)
- Total
- Paid
- Due (if any) — red
- Payment Mode (colored badge)
- Status (Pending=amber, Completed=green)
- Table
- Actions (View | Print | Mark Complete | Delete)

Order detail sheet: full order breakdown, receipt preview, print button
"Mark Complete" button: updates status to Completed, clears table

Reorder button: copies order items to POS cart
```

### Step 5.6 — Reservations page
```
Route: /reservations
Data: useReservations() hook

Filters: date picker, status filter

Reservation table columns:
- Date & Time
- Guest Name
- Mobile
- Guests count
- Table (if assigned)
- Status (Booked=blue, Seated=green, Completed=gray, Cancelled=red)
- Actions (Edit | Seat | Complete | Cancel)

Quick action buttons: "Seat" (Booked→Seated), "Complete" (Seated→Completed)

Reservation form: name, mobile, date, time, guests, table (optional), notes
```

### Step 5.7 — Events page
```
Route: /events
Data: useEvents() hook

Events table columns:
- Event Name
- Date & Time
- Customer Name + Mobile
- Payable amount
- Advance paid
- Balance (payable - advance) — red if > 0
- Pay Mode (Cash/Online/Credit badge)
- Status
- Actions (Edit | Receive Balance | Complete | Cancel)

"Receive Balance" action: marks full payment, sets advance = payable

Event form: name, mobile, date, time, eventName, notes, payable, advance, payMode
```

### Step 5.8 — Tables overview page
```
Route: /tables
Data: useTables() hook (30s refresh)

Visual layout: 2x4 grid of table cards (or 3x3 with walk-in)
Table card:
- Table number (T-1 to T-8)
- Status indicator (green=Available, red=Occupied, amber=Reserved)
- Current order ID if Occupied
- Quick actions: Mark Available | Mark Reserved

Click on Occupied table: show current order summary + option to open in POS
```

### Step 5.9 — Cloudinary image upload component
```typescript
// components/shared/ImageUpload.tsx
'use client'
// Props: value (current publicId), onChange (new publicId)
// 
// Flow:
// 1. Show current image (if any) or upload button
// 2. User clicks "Change Image"
// 3. File input opens (accept="image/*", max 2MB)
// 4. On file select: 
//    a. Show preview immediately (URL.createObjectURL)
//    b. POST to /api/upload to get signature
//    c. Upload to Cloudinary with signature
//    d. On success: call onChange(publicId)
//    e. On error: show toast.error
// 5. Loading state during upload
// 
// Image URL from publicId:
// https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_300,h_300,c_fill/${publicId}
```

### Step 5.10 — Shared hooks for all entities
Create all remaining hooks:
```typescript
hooks/use-orders.ts        → useOrders(filters?), useUpdateOrder, useDeleteOrder
hooks/use-customers.ts     → useCustomers(search?), useCreateCustomer, useUpdateCustomer
hooks/use-staff.ts         → useStaff (admin only), CRUD mutations
hooks/use-reservations.ts  → useReservations(filters?), CRUD mutations
hooks/use-events.ts        → useEvents(filters?), CRUD mutations
hooks/use-tables.ts        → useTables(), useUpdateTable
```

All mutation hooks follow the same pattern:
- `onError`: `toast.error('Operation failed')`
- `onSuccess`: `toast.success('...')`
- `onSettled`: `qc.invalidateQueries({ queryKey: [entityKey] })`

### Step 5.11 — Empty states for all pages
```typescript
// components/shared/EmptyState.tsx
// Props: title, description, actionLabel?, onAction?
// Example: EmptyState title="No products yet" description="Add your first menu item" actionLabel="Add Product" onAction={openAddSheet}
```

---

## Checkpoint Criteria

- [ ] Products: add/edit/delete works. Image uploads to Cloudinary. Shows in product grid.
- [ ] Categories: add/delete. Products show category filter correctly.
- [ ] Customers: add/edit. Visits and totalSpend auto-update from orders.
- [ ] Staff (admin only): add new staff. Staff can log in. Deactivate works.
- [ ] Orders: all filters work. Mark complete updates table status.
- [ ] Reservations: full CRUD + status transitions work.
- [ ] Events: full CRUD + balance payment works.
- [ ] Tables: visual grid shows live status. Manual status change works.
- [ ] All pages show empty state on first visit.
- [ ] `npm run build` passes.

---

## Next Session Prompt

```
Phase 6 — Dashboard + Reports + Analytics

Context: Phase 5 complete. All management pages work. Products, customers, staff, orders, reservations, events all have full CRUD. Cloudinary image upload works.

Resume from: Step 6.1 — Dashboard page with daily summary cards
Check: Create 3-4 products, place 2 orders from POS, verify orders show in /orders page.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-06-dashboard-reports.md before starting.
```
