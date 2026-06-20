# Phase 6 — Dashboard + Reports + Analytics

**Status:** ⏳ Pending  
**Prerequisites:** Phase 5 complete (all management pages working)  
**Estimated time:** 1.5 days

---

## Goal

Dashboard that gives the admin a real-time picture of the business.
Reports that help make decisions (what's selling, who owes money, which days are peak).

---

## Dashboard Layout

```
┌───────────────────────────────────────────────────────────┐
│ Today's Overview               📅 Friday, 20 Jun 2026    │
├──────────────┬──────────────┬──────────────┬─────────────┤
│ ₹12,450      │ 48 Orders    │ ₹2,100 Due   │ 3 Pending   │
│ Today's Sales│ Served       │ Outstanding  │ Orders Now  │
├──────────────┴──────────────┴──────────────┴─────────────┤
│ Payment Breakdown (Pie/Bar)  │ Top 5 Products (Bar)       │
│ Cash 68% · Online 24%        │ Margherita #1              │
│ Due 8%                       │ Cold Coffee  #2            │
├──────────────────────────────┴────────────────────────────┤
│ Recent Orders (last 10)                                   │
│ ORD-001 Table T-3 ₹450 Cash Completed 5m ago            │
│ ORD-002 Walk-In  ₹120 Online Pending 12m ago             │
├──────────────────────────────────────────────────────────┤
│ Today's Reservations (upcoming)                          │
│ 7:30 PM - Sharma Party - 8 guests - T-5, T-6            │
└──────────────────────────────────────────────────────────┘
```

---

## Steps

### Step 6.1 — Dashboard page data
```typescript
// app/(dashboard)/page.tsx — Server Component (fetch data on server)
import { auth } from '@/lib/auth'
import { connectDB } from '@/lib/db'
// Fetch today's summary, recent orders, upcoming reservations on server
// Pass as props to client components for charts
```

### Step 6.2 — Summary cards
```typescript
// components/dashboard/SummaryCard.tsx
// Props: title, value, subtitle, icon, color variant (green/blue/red/amber)
// Animated number: use simple CSS transition on mount
// 4 cards: Today's Sales, Orders Count, Outstanding Due, Pending Orders
```

### Step 6.3 — Payment breakdown chart
```typescript
// components/dashboard/PaymentChart.tsx
// 'use client' — recharts needs client
// Pie chart: Cash vs Online vs Due vs Split vs Credit
// Colors: yellow, blue, red, purple, orange (matching PAY_STYLES)
// Show legend with amounts
// Dynamic import this component to avoid SSR issues
```

### Step 6.4 — Top products chart
```typescript
// components/dashboard/TopProductsChart.tsx
// 'use client'
// Horizontal bar chart: top 10 products by revenue today
// Recharts HorizontalBarChart
// Show product name + revenue amount
```

### Step 6.5 — Recent orders list
```typescript
// components/dashboard/RecentOrders.tsx
// Last 10 orders (from today, sorted by time)
// Columns: orderId, table, customer, amount, payment badge, status badge, time ago
// Click order → open order detail sheet
// "View All Orders →" link at bottom
```

### Step 6.6 — Today's reservations panel
```typescript
// components/dashboard/TodayReservations.tsx
// Show today's upcoming reservations
// Sort by time
// Status badges: Booked, Seated, Completed
// Quick action: "Seat" button
```

### Step 6.7 — Dashboard auto-refresh
```typescript
// Dashboard stats: refetch every 2 minutes
// Recent orders: refetch every 30 seconds (live updates)
// Pending orders count: refetch every 30 seconds
// Use React Query refetchInterval option
```

---

## Reports Page

```
Route: /reports
Access: Admin only

┌─────────────────────────────────────────────────┐
│ Reports                                          │
├─────────────────────────────────────────────────┤
│ Date Range: [From] → [To]  [Report Type ▼]      │
│ [Generate Report]                               │
├─────────────────────────────────────────────────┤
│ Summary Cards: Total Sales | Orders | Avg/Order  │
├─────────────────────────────────────────────────┤
│ Sales by Day (Line Chart)                       │
├────────────────────┬────────────────────────────┤
│ Top Products       │ Payment Breakdown           │
│ (by revenue)       │ (by amount)                │
├────────────────────┴────────────────────────────┤
│ Customer Due Report                             │
│ Name | Mobile | Due Amount | Last Order        │
├─────────────────────────────────────────────────┤
│ [Export to CSV]                                 │
└─────────────────────────────────────────────────┘
```

### Step 6.8 — Reports API (enhance existing)
```typescript
// app/api/reports/route.ts
// GET with params: startDate, endDate
// Returns:
{
  summary: { totalSales, totalOrders, avgOrderValue, totalDue },
  salesByDay: [{ date: '2026-06-20', sales: 12450, orders: 48 }],
  topProducts: [{ name, revenue, count }],
  paymentBreakdown: { Cash: 8470, Online: 2980, Due: 1000 },
  customerDues: [{ name, mobile, totalDue, lastOrderDate }]
}
```

MongoDB aggregation for sales by day:
```typescript
const pipeline = [
  { $match: { createdAt: { $gte: startDate, $lte: endDate }, status: 'Completed' } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$total' }, orders: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]
```

### Step 6.9 — Reports page UI
```typescript
// app/(dashboard)/reports/page.tsx
// 'use client' — uses date pickers and charts
// Default date range: last 7 days
// Date pickers: shadcn Calendar component
// Charts: recharts (lazy loaded)
// "Generate Report" button: triggers query with new date range
// Loading state: skeleton cards
```

### Step 6.10 — Customer dues report table
```typescript
// In reports page: separate section for customer dues
// Sort by due amount (highest first)
// Quick "Mark Paid" action: sets totalDue = 0
// Shows: name, mobile, total due, days since last order
// Export to CSV: generate CSV string, trigger download
```

### Step 6.11 — CSV Export
```typescript
// lib/export.ts
export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  const headers = Object.keys(data[0])
  const rows = data.map(row => headers.map(h => row[h]).join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

### Step 6.12 — Low stock alerts (dashboard widget)
```typescript
// components/dashboard/LowStockAlert.tsx
// Products where stock < 5 (configurable threshold)
// Show as warning banner at top of dashboard
// "Update Stock →" link goes to /products
```

---

## Checkpoint Criteria

- [ ] Dashboard shows today's sales, order count, due amount, pending count
- [ ] Payment pie chart renders correctly (recharts)
- [ ] Top products chart shows correct data
- [ ] Recent orders list updates every 30 seconds
- [ ] Reports page generates report for any date range
- [ ] Sales by day chart is correct (test with known orders)
- [ ] Customer dues report shows customers with outstanding balance
- [ ] CSV export downloads a valid file
- [ ] `npm run build` passes (recharts + dynamic imports)

---

## Next Session Prompt

```
Phase 7 — Billing, Receipts & Printing

Context: Phase 6 complete. Dashboard shows real data. Reports generate correctly.
CSV export works. Customer dues visible.

Resume from: Step 7.1 — Enhance OrderReceipt component for full thermal format
Check: Dashboard shows correct data from today's test orders. Reports API returns data.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-07-billing-printing.md before starting.
```
