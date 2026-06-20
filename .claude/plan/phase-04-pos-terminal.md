# Phase 4 — POS Terminal UI + Order Flow

**Status:** ⏳ Pending  
**Prerequisites:** Phase 3 complete (all API routes working)  
**Estimated time:** 2 days

---

## Goal

The POS terminal — the most critical and most-used screen — fully working:
- Product grid filtered by category
- Cart with qty controls, modifiers, item notes
- Discount (amount or %)
- Table selection
- Customer search + link
- Payment modal (Cash / Online / Due / Split / Credit)
- Order creation with optimistic update
- Receipt print after order
- All interactions feel instant

---

## UX Requirements (PetPooja-style)

```
┌─────────────────────────────────────────────────────────┐
│ POS Terminal              [Table: T-3]  [Customer: Walk-In] │
├─────────────────┬───────────────────────────────────────┤
│ Categories      │ Product Grid (2-3 col on tablet)       │
│ • All           │ ┌──────┐ ┌──────┐ ┌──────┐            │
│ • Pizza         │ │Pizza │ │Pasta │ │Coffee│            │
│ • Pasta         │ │ ₹200 │ │ ₹180 │ │ ₹120 │            │
│ • Beverages     │ └──────┘ └──────┘ └──────┘            │
│ • Desserts      │                                        │
├─────────────────┴───────────────────────────────────────┤
│ Cart                                                     │
│ Margherita Pizza x2 = ₹400        [- 2 +] [×]          │
│ Cold Coffee x1 = ₹120             [- 1 +] [×]          │
├─────────────────────────────────────────────────────────┤
│ Subtotal: ₹520  Discount: ₹20  Total: ₹500              │
│ [CASH]  [ONLINE]  [DUE]  [SPLIT]  [Credit]              │
│                          [Place Order →]                 │
└─────────────────────────────────────────────────────────┘
```

---

## Steps

### Step 4.1 — TanStack Query hooks for POS
```typescript
// hooks/use-products.ts
export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => fetch('/api/products').then(r => r.json()).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
}

// hooks/use-categories.ts
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => fetch('/api/categories').then(r => r.json()).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
}

// hooks/use-orders.ts
export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateOrderInput) => 
      fetch('/api/orders', { method: 'POST', body: JSON.stringify(data), headers: {'Content-Type':'application/json'} })
        .then(r => r.json()),
    onMutate: async (newOrder) => {
      // Pattern B: cache-based optimistic for POS
      await qc.cancelQueries({ queryKey: ['orders'] })
      const snapshot = qc.getQueryData(['orders'])
      // Add optimistic order to list
      qc.setQueryData(['orders'], (old: any[] = []) => [{ ...newOrder, _id: 'temp', status: 'Pending' }, ...old])
      return { snapshot }
    },
    onError: (_, __, ctx) => {
      qc.setQueryData(['orders'], ctx?.snapshot)
      toast.error('Order failed — please try again')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['tables'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
    onSuccess: (data) => {
      if (data.success) toast.success(`Order ${data.data.orderId} placed`)
    },
  })
}
```

### Step 4.2 — POS page layout
```typescript
// app/(dashboard)/pos/page.tsx
'use client'
// Two-panel layout:
// Left: Category sidebar (vertical list) + Product grid
// Right: Cart (sticky) + Discount + Payment
// On mobile/tablet: full-screen cart slides up from bottom
```

### Step 4.3 — CategorySidebar component
```typescript
// components/pos/CategorySidebar.tsx
// Props: categories[], selectedCategory, onSelect
// "All" option always first
// Active category: accent background
// Each category: name only (no icons initially)
```

### Step 4.4 — ProductGrid component
```typescript
// components/pos/ProductGrid.tsx
// Props: products[], selectedCategory, onAddToCart
// Filter products by selected category
// Product card: image (Cloudinary), name, price (after discount)
// Out of stock: show badge, disable click
// Click: add to cart (or open modifier modal if product has modifiers)
// Search bar above grid: filter products by name
```

### Step 4.5 — ModifierModal component
```typescript
// components/pos/ModifierModal.tsx
// Opens when product has modifiers
// Checklist of modifiers
// Free-text instructions field
// Confirm: adds to cart with selected modifiers
```

### Step 4.6 — Cart component
```typescript
// components/pos/Cart.tsx
// List of cart items with:
//   - Product name + modifiers
//   - Qty control: [- qty +]
//   - Price for line item
//   - Remove (×)
// Empty state: "Add items to start an order"
// Footer: Subtotal, Discount field, Total
// Discount: can enter amount or %
```

### Step 4.7 — TableSelector component
```typescript
// components/pos/TableSelector.tsx
// Shows 8 tables in a grid
// Color coded: Available=green, Occupied=red, Reserved=amber
// Click to select (and deselect)
// "Walk-In" option (no table)
```

### Step 4.8 — CustomerSearch component
```typescript
// components/pos/CustomerSearch.tsx
// Search by name or mobile
// Debounced search (300ms)
// Shows: name, mobile, visits, outstanding due
// Select customer or "Walk-In"
// Quick add new customer inline
```

### Step 4.9 — PaymentModal component
```typescript
// components/pos/PaymentModal.tsx
// Shows order summary: items, total, discount
// Payment mode buttons: Cash | Online | Due | Split | Credit
// Cash: enter amount received → show change
// Online: just confirm
// Due: confirm (customer must be selected for Due/Credit)
// Split: enter cash amount + online amount (sum must equal total)
// Credit: same as Due but labeled differently
// Staff (receiver) selector: dropdown of active staff
// Place Order button: disabled while creating
```

### Step 4.10 — Order success + auto-print
```typescript
// After successful order:
// 1. Show success toast with order ID
// 2. Open receipt modal / print dialog
// 3. Clear cart
// 4. Reset table selection
// 5. Reset customer selection
```

### Step 4.11 — OrderReceipt component (printable)
```typescript
// components/pos/OrderReceipt.tsx
// 'use client' — uses useReactToPrint
// Width: 300px (80mm thermal equivalent)
// Font: monospace
// Shows: restaurant name, order ID, date/time, table, staff
//        item list with qty and price
//        subtotal, discount, total, payment mode
//        "Thank you! Visit again"
// @media print: hide everything except receipt

export function OrderReceipt({ order, ref }: { order: Order; ref: React.RefObject<HTMLDivElement> }) {
  return (
    <div ref={ref} className="receipt-root">
      {/* receipt HTML */}
    </div>
  )
}

// In parent component:
const receiptRef = useRef<HTMLDivElement>(null)
const { handlePrint } = useReactToPrint({ contentRef: receiptRef })
```

### Step 4.12 — Cart state management
Use `useState` in POS page (not React Query — cart is local UI state):
```typescript
interface CartItem {
  productId: string
  name: string
  price: number
  qty: number
  modifiers: string[]
  instructions: string
}

const [cart, setCart] = useState<CartItem[]>([])
const [discount, setDiscount] = useState(0)
const [selectedTable, setSelectedTable] = useState<string | undefined>()
const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>()
const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash')
```

Cart helpers:
```typescript
const addToCart = (product: Product, modifiers: string[], instructions: string) => { /* ... */ }
const removeFromCart = (productId: string) => { /* ... */ }
const updateQty = (productId: string, qty: number) => { /* ... */ }
const clearCart = () => setCart([])

const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0)
const total = Math.max(0, subtotal - discount)
```

### Step 4.13 — useHooks for tables + customers in POS
```typescript
// hooks/use-tables.ts
export function useTables() {
  return useQuery({
    queryKey: ['tables'],
    queryFn: ...,
    staleTime: 30 * 1000,   // 30 seconds
    refetchInterval: 30 * 1000,  // auto-poll every 30s
  })
}

// hooks/use-customers.ts
export function useCustomerSearch(query: string) {
  return useQuery({
    queryKey: ['customers', 'search', query],
    queryFn: () => fetch(`/api/customers?search=${query}`).then(...),
    enabled: query.length >= 2,  // only search when 2+ chars
    staleTime: 30 * 1000,
  })
}
```

---

## Performance Notes for POS

- Product grid: only render visible products (virtual scroll if >100 products)
- Category filter: client-side (products already fetched)
- Cart updates: all local state — instant
- Table status: auto-poll every 30s (see hook)
- Submit button: disabled immediately on click to prevent double-orders
- Receipt: use `dynamic(() => import(...), { ssr: false })` to avoid SSR issues with print

---

## Checkpoint Criteria

- [ ] Product grid shows all products, filtered by category
- [ ] Adding product to cart works, qty changes work
- [ ] Table selector shows live table status
- [ ] Customer search works (type mobile or name)
- [ ] Payment modal: all 5 payment modes work
- [ ] Split payment: validates sum equals total
- [ ] Order creation: success toast + orderId shown
- [ ] Receipt prints correctly (80mm layout)
- [ ] After order: cart clears, table shows Occupied
- [ ] Double-click prevention: submit button disables
- [ ] `npm run build` passes

---

## Next Session Prompt

```
Phase 5 — Management Pages

Context: Phase 4 complete. POS terminal fully working. Orders create and print.
Table status updates on order. Receipt prints. Cart clears after order.

Resume from: Step 5.1 — Products management page (CRUD with Cloudinary upload)
Check: Create an order from POS. Verify it appears in /api/orders. Check table status.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-05-management.md before starting.
```
