# Phase 7 — Billing, Receipts & Printing

**Status:** ⏳ Pending  
**Prerequisites:** Phase 6 complete  
**Estimated time:** 1 day

---

## Goal

Professional billing and receipt system:
- Print-ready receipt (80mm thermal format)
- Works with any thermal printer (USB or Bluetooth) via browser print dialog
- Digital receipt view in app
- KOT (Kitchen Order Ticket) option
- Receipt settings (restaurant name, tagline, footer message)

---

## Steps

### Step 7.1 — Full OrderReceipt component
```typescript
// components/pos/OrderReceipt.tsx
// Width: 302px (80mm = 3.15in ≈ 302px at 96dpi)
// Font: 'Courier New', monospace — thermal printer aesthetic
// No colors in print (thermal = black only)

interface ReceiptProps {
  order: Order
  restaurantName?: string
  tagline?: string
  footerMessage?: string
}

// Layout:
// - Center: restaurant name (large, bold)
// - Center: tagline (small)
// - Separator line (━━━━━━)
// - Order ID, Date, Time
// - Table: T-3 or Walk-In
// - Staff: receiver name
// - Separator
// - Items list: name x qty ... price (right-aligned)
//   - Sub-items: modifiers (indented)
// - Separator
// - Subtotal
// - Discount (if any)
// - TOTAL (bold, larger)
// - Paid amount
// - Due amount (if any, red — but gray in print)
// - Payment mode
// - Separator
// - Footer message
// - Center: "Thank you! Visit again"
// - Center: date+time of print

// CSS for print:
// @media print {
//   .receipt-root { width: 302px; font-family: 'Courier New'; }
//   body > *:not(.print-target) { display: none; }
// }
```

### Step 7.2 — Print functionality with react-to-print
```typescript
// In POS page and Order detail sheet:
import { useReactToPrint } from 'react-to-print'
import { useRef } from 'react'

const receiptRef = useRef<HTMLDivElement>(null)

const { handlePrint } = useReactToPrint({
  contentRef: receiptRef,
  documentTitle: `Receipt-${order.orderId}`,
  onAfterPrint: () => {
    // Optional: close modal after print
    // Optional: mark order as printed
  },
  pageStyle: `
    @page { size: 80mm auto; margin: 4mm; }
    @media print {
      body { font-family: 'Courier New', monospace; }
    }
  `
})

// Usage:
<Button onClick={handlePrint} variant="outline">
  <PrinterIcon className="w-4 h-4 mr-2" />
  Print Receipt
</Button>

// Hidden receipt (only visible to printer):
<div className="hidden print:block">
  <OrderReceipt ref={receiptRef} order={order} />
</div>
```

### Step 7.3 — KOT (Kitchen Order Ticket)
```typescript
// components/pos/KOTReceipt.tsx
// Simpler version of receipt — just items + qty
// No prices (kitchen doesn't need prices)
// Large font for easy reading
// Order ID + Table + Time at top
// Items in large text

// Same print flow as OrderReceipt
// Separate "Print KOT" button in POS
```

### Step 7.4 — Bill settings (admin)
Add "Settings" page for admin:
```typescript
// app/(dashboard)/settings/page.tsx
// Admin only

// Restaurant settings:
interface RestaurantSettings {
  name: string         // "Lucifer Cafe"
  tagline: string      // "Where every bite is legendary"
  mobile: string       // contact number on receipt
  address: string      // address on receipt
  gstNumber?: string   // GST number (if applicable)
  gstEnabled: boolean  // show GST on bills
  gstRate: number      // default 5 or 18
  receiptFooter: string // "Thank you! Visit again"
  currencySymbol: string // "₹"
}

// Store in MongoDB as a single Settings document
// models/Settings.ts — singleton document
```

### Step 7.5 — Settings model + API
```typescript
// models/Settings.ts
const settingsSchema = new Schema({
  restaurantName: { type: String, default: 'My Restaurant' },
  tagline:        { type: String, default: '' },
  mobile:         { type: String, default: '' },
  address:        { type: String, default: '' },
  gstEnabled:     { type: Boolean, default: false },
  gstNumber:      { type: String, default: '' },
  gstRate:        { type: Number, default: 5 },
  receiptFooter:  { type: String, default: 'Thank you! Visit again' },
}, { timestamps: true })

// Singleton pattern: always findOne() and update (upsert)
```

```typescript
// app/api/settings/route.ts
// GET: return settings (cached 10min)
// PUT: admin only, update settings, clear cache
```

### Step 7.6 — GST calculation on bill
```typescript
// When gstEnabled: true
// Add GST row to receipt:
// Subtotal (before GST): ₹XXX
// GST (5%):              ₹XXX
// Total:                 ₹XXX

// In createOrderSchema: add optional gstAmount field
// In Order model: add gstAmount field
// In receipt component: conditionally show GST row
```

### Step 7.7 — Digital receipt in Orders page
In the Order detail sheet (orders management page):
```typescript
// Show receipt preview embedded in sheet (right side)
// "Print" button opens browser print dialog
// "Share WhatsApp" button: creates wa.me link with order summary text
// Separate receipt URL: /api/receipt/[orderId] → returns HTML receipt

// WhatsApp share text:
const waText = encodeURIComponent(
  `*${restaurantName} - Receipt*\n` +
  `Order: ${order.orderId}\n` +
  `Date: ${formatDate(order.createdAt)}\n` +
  `Total: ${inr(order.total)}\n` +
  `Payment: ${order.payment}\n\n` +
  `Thank you! Visit again 🙏`
)
const waLink = `https://wa.me/?text=${waText}` // wa.me share (no phone needed)
```

### Step 7.8 — Print CSS (global)
Add to `app/globals.css`:
```css
@media print {
  /* Hide everything by default */
  body > * { display: none !important; }
  
  /* Show only the element with print-target class */
  .print-target { display: block !important; }
  
  /* Receipt-specific styles */
  .receipt-root {
    width: 302px;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    color: #000;
  }
  
  .receipt-separator {
    border-top: 1px dashed #000;
    margin: 6px 0;
  }
  
  /* Page size for thermal */
  @page {
    size: 80mm auto;
    margin: 3mm;
  }
}
```

---

## Checkpoint Criteria

- [ ] OrderReceipt renders correctly at 302px width
- [ ] Print dialog opens with correct 80mm page size
- [ ] All receipt fields show (order ID, date, items, total, payment)
- [ ] KOT prints items + qty without prices
- [ ] Settings page saves restaurant name, updates receipt header
- [ ] GST calculation correct when enabled
- [ ] WhatsApp share creates correct message
- [ ] `npm run build` passes (react-to-print, no SSR issues)

---

## Next Session Prompt

```
Phase 8 — Security Hardening + Polish + Data Migration

Context: Phase 7 complete. Billing and printing work. Settings saved.
KOT and full receipt print. WhatsApp share functional.

Resume from: Step 8.1 — Rate limiting on auth endpoints
Check: Print a receipt from POS. Verify it renders on thermal printer (or preview).

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-08-security-polish.md before starting.
```
