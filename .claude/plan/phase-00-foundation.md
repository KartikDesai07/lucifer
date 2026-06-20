# Phase 0 — Foundation & Migration to Next.js 15

**Status:** ⏳ Pending  
**Prerequisites:** None — this is the first phase  
**Session type:** Setup + scaffold — no feature code  
**Estimated time:** 1 day

---

## Goal

Migrate the existing TanStack Start project to **Next.js 15 App Router**.
Set up all tooling, config, and base structure. Zero feature code — just the skeleton.

By the end of this phase:
- Next.js 15 App Router project running locally
- shadcn/ui configured with all existing components
- MongoDB Atlas M0 cluster connected
- Cloudinary account + upload preset configured
- Environment variables documented and set
- Base layout (sidebar + header) rendered on `/`
- Login page at `/login` (no auth logic yet — just UI)
- All existing UI components migrated to new structure

---

## Pre-Phase Checklist

- [ ] MongoDB Atlas account created, M0 cluster provisioned
- [ ] Cloudinary account created, unsigned upload preset `lucifer_cafe_products` created
- [ ] Vercel account created (for later — not deploying yet)
- [ ] Node.js 20+ installed locally

---

## Steps

### Step 0.1 — Initialize Next.js 15 project
```bash
npx create-next-app@latest lucifer-cafe --typescript --tailwind --app --src-dir=no --import-alias="@/*"
```
- Choose: Yes to TypeScript, Yes to Tailwind, Yes to App Router, Yes to `@/*` alias
- Move into project folder
- Verify `npm run dev` starts on port 3000

### Step 0.2 — Install core dependencies
```bash
npm install \
  mongoose \
  next-auth@beta \
  zod \
  @tanstack/react-query \
  @tanstack/react-query-devtools \
  node-cache \
  cloudinary \
  bcryptjs \
  react-to-print \
  sonner \
  lucide-react \
  recharts \
  react-hook-form \
  @hookform/resolvers \
  date-fns \
  clsx \
  tailwind-merge \
  axios

npm install -D \
  @types/bcryptjs \
  @types/node-cache \
  @types/node
```

### Step 0.3 — Install and configure shadcn/ui
```bash
npx shadcn@latest init
# Style: New York, Base color: Slate, CSS variables: yes
```

Install all required components:
```bash
npx shadcn@latest add button input label card dialog sheet table select \
  badge skeleton separator scroll-area avatar dropdown-menu toast \
  popover command form tabs alert-dialog progress switch textarea \
  calendar date-picker breadcrumb sidebar
```

### Step 0.4 — Set up folder structure
Create all empty folders as per CLAUDE.md section 4:
- `app/(auth)/login/`
- `app/(dashboard)/` with all sub-routes
- `app/api/` with all route folders
- `components/ui/` (shadcn)
- `components/layout/`
- `components/pos/`
- `components/orders/`
- `components/dashboard/`
- `components/reports/`
- `components/shared/`
- `lib/`
- `models/`
- `schemas/`
- `hooks/`
- `types/`

### Step 0.5 — Create lib/db.ts (MongoDB connection)
```typescript
// lib/db.ts
import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) throw new Error('MONGODB_URI environment variable is not set')

let cached = (global as any).mongoose ?? { conn: null, promise: null }

if (!(global as any).mongoose) (global as any).mongoose = cached

export async function connectDB() {
  if (cached.conn) return cached.conn
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false })
  }
  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }
  return cached.conn
}
```

### Step 0.6 — Create lib/constants.ts
Move all constants from old `storage.ts`:
```typescript
export const TABLE_NUMBERS = ['T-1','T-2','T-3','T-4','T-5','T-6','T-7','T-8'] as const
export type TableNumber = typeof TABLE_NUMBERS[number]

export const PAYMENT_MODES = ['Cash','Online','Due','Split','Credit'] as const
export type PaymentMode = typeof PAYMENT_MODES[number]

export const ORDER_STATUSES = ['Pending','Completed'] as const
export type OrderStatus = typeof ORDER_STATUSES[number]

export const RESERVATION_STATUSES = ['Booked','Seated','Completed','Cancelled'] as const
export const EVENT_STATUSES = ['Booked','Completed','Cancelled'] as const
export const CUSTOMER_NOTES = ['Regular','VIP'] as const

export const PAY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  Cash:   { color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Cash' },
  Online: { color: 'text-blue-600',   bg: 'bg-blue-50',   label: 'Online' },
  Due:    { color: 'text-red-600',    bg: 'bg-red-50',    label: 'Due' },
  Split:  { color: 'text-purple-600', bg: 'bg-purple-50', label: 'Split' },
  Credit: { color: 'text-orange-600', bg: 'bg-orange-50', label: 'Credit' },
}
```

### Step 0.7 — Create lib/utils.ts
```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function inr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  return `${hour > 12 ? hour - 12 : hour}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function generateOrderId(sequence: number): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `ORD-${date}-${String(sequence).padStart(3, '0')}`
}
```

### Step 0.8 — Create lib/cache.ts (node-cache)
```typescript
import NodeCache from 'node-cache'

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 })

export const TTL = {
  PRODUCTS:     5 * 60,
  CATEGORIES:   5 * 60,
  STAFF:        5 * 60,
  CUSTOMERS:    2 * 60,
  TABLES:       30,
  RESERVATIONS: 1 * 60,
  EVENTS:       1 * 60,
  ORDERS:       0, // never cache
} as const

export default cache
```

### Step 0.9 — Create .env.local
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/lucifer-cafe?retryWrites=true&w=majority
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=lucifer_cafe_products
```
Add `.env.local` to `.gitignore` immediately.

Create `.env.example`:
```env
MONGODB_URI=mongodb+srv://...
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=lucifer_cafe_products
```

### Step 0.10 — Create base layout
- `app/layout.tsx` — root layout with providers (QueryClient, Sonner)
- `app/(dashboard)/layout.tsx` — dashboard shell with AppSidebar + Header
- `app/(auth)/login/page.tsx` — login UI (no logic yet, just the form design)
- `app/(dashboard)/page.tsx` — placeholder "Dashboard coming in Phase 6"

### Step 0.11 — Migrate existing components
Copy from old project into new structure:
- `components/ui/*` — all shadcn components
- `components/layout/AppSidebar.tsx` — update imports for Next.js
- Update all `import` paths to use `@/*` alias

### Step 0.12 — Verify types file
Create `types/index.ts` — re-export all types (will be populated in Phase 2)

---

## Checkpoint Criteria

- [ ] `npm run build` passes with 0 errors
- [ ] `npm run dev` starts, browser shows dashboard layout on `/`
- [ ] Login page renders at `/login`
- [ ] Sidebar shows all navigation items
- [ ] No TypeScript errors in terminal
- [ ] MongoDB connection works: test with a simple `connectDB()` call in `/api/health`
- [ ] `.env.local` is in `.gitignore` and not committed

---

## Files Created This Phase

```
app/layout.tsx
app/(auth)/login/page.tsx
app/(dashboard)/layout.tsx
app/(dashboard)/page.tsx
app/api/health/route.ts
lib/db.ts
lib/utils.ts
lib/constants.ts
lib/cache.ts
.env.local
.env.example
next.config.ts
tailwind.config.ts
components.json
types/index.ts
```

---

## Next Session Prompt

```
Phase 1 — Authentication & Role System

Context: Phase 0 complete. Next.js 15 App Router project running. MongoDB connected.
base layout done. Login page UI exists but has no auth logic.

Resume from: Step 1.1 — Install and configure NextAuth.js v5
Check: Run `npm run build` — must pass with 0 errors before starting.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-01-auth.md before starting.
```
