# CLAUDE.md — Lucifer Cafe POS

> This file is the single source of truth for every decision in this project.
> Read this at the START of every session before touching any file or writing any code.

---

## 1. Project Identity

**Name:** Lucifer Cafe POS  
**Type:** Single-restaurant Point-of-Sale + Management System  
**Inspiration:** PetPooja (feature scope, not design copy)  
**Goal:** Zero-cost, production-grade, lifetime-free SaaS-quality software for one restaurant  
**Users:** 1 Admin + N Staff (added by admin only)  
**Data model:** Single restaurant, shared data pool — no multi-tenancy, no per-user isolation

---

## 2. Final Tech Stack (Locked — Do Not Change Without Explicit Instruction)

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend + API | **Next.js 15 App Router** | Single deploy on Vercel, RSC, API Routes |
| Database | **MongoDB Atlas M0** | Free forever, 512MB, Mongoose ODM |
| Auth | **NextAuth.js v5 (Auth.js)** | JWT + Credentials, role-based, App Router native |
| Image Storage | **Cloudinary** | Free tier: 25GB storage, transformations |
| Hosting | **Vercel Hobby Plan** | Free, edge network, Next.js native |
| Validation | **Zod** | Shared schemas across client + server |
| Server State | **TanStack Query v5** | Caching, optimistic updates, invalidation |
| UI Components | **shadcn/ui + Tailwind CSS 4** | Keep existing components |
| Printing | **react-to-print v3** | Browser print API, thermal printer compatible |
| Icons | **lucide-react** | Keep existing |
| Charts | **recharts** | Keep existing |
| Forms | **react-hook-form + zod resolver** | Keep existing |

**Why Next.js over React+Express:**
- Vercel is built for Next.js — serverless functions work natively
- No CORS complexity — API routes in same origin
- RSC reduces client JS bundle
- Auth.js v5 is designed for App Router
- Single `vercel deploy` for everything

---

## 3. Free Tier Constraints (Hard Limits)

### Vercel Hobby Plan
- Bandwidth: 100GB/month
- Serverless function timeout: 10 seconds (important — no long-running operations)
- Invocations: Unlimited on hobby (as of 2025)
- Edge functions: Available
- **Rule:** All API routes must complete in under 8 seconds. No file processing in API routes.

### MongoDB Atlas M0
- Storage: 512MB total
- Connections: 500 max shared with other Atlas users
- **Rule:** Use global connection cache — never create a new connection per request
- **Rule:** Always call `connectDB()` from `lib/db.ts` — never `mongoose.connect()` directly
- Connection pattern: cache in `global.mongoose` to survive hot reloads

### Cloudinary Free
- Credits: 25/month (1 credit = 1 transformation or ~1MB storage)
- Storage: 25GB
- Bandwidth: 25GB/month
- **Rule:** Use unsigned upload preset for direct browser uploads (no API route proxy needed)
- **Rule:** Store only the `public_id`, not the full URL — construct URLs at render time

---

## 4. Project Folder Structure (Source of Truth)

```
lucifer/                           ← Next.js project root
├── app/                           ← Next.js App Router
│   ├── (auth)/                    ← Auth route group
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/               ← Protected route group
│   │   ├── layout.tsx             ← Dashboard shell (sidebar + header)
│   │   ├── page.tsx               ← Dashboard home
│   │   ├── pos/page.tsx           ← POS Terminal
│   │   ├── orders/page.tsx        ← Order management
│   │   ├── products/page.tsx      ← Menu management
│   │   ├── categories/page.tsx    ← Category management
│   │   ├── customers/page.tsx     ← Customer CRM
│   │   ├── staff/page.tsx         ← Staff (admin only)
│   │   ├── tables/page.tsx        ← Table status
│   │   ├── reservations/page.tsx  ← Reservations
│   │   ├── events/page.tsx        ← Event bookings
│   │   └── reports/page.tsx       ← Reports + analytics
│   └── api/                       ← API Route Handlers
│       ├── auth/[...nextauth]/route.ts
│       ├── products/route.ts
│       ├── products/[id]/route.ts
│       ├── categories/route.ts
│       ├── orders/route.ts
│       ├── orders/[id]/route.ts
│       ├── orders/summary/route.ts
│       ├── customers/route.ts
│       ├── customers/[id]/route.ts
│       ├── staff/route.ts
│       ├── staff/[id]/route.ts
│       ├── tables/route.ts
│       ├── tables/[tableNo]/route.ts
│       ├── reservations/route.ts
│       ├── reservations/[id]/route.ts
│       ├── events/route.ts
│       ├── events/[id]/route.ts
│       └── upload/route.ts        ← Cloudinary upload signature
│
├── components/                    ← Shared UI components
│   ├── ui/                        ← shadcn/ui (never modify)
│   ├── layout/
│   │   ├── AppSidebar.tsx
│   │   ├── Header.tsx
│   │   └── MobileNav.tsx
│   ├── pos/
│   │   ├── ProductGrid.tsx
│   │   ├── Cart.tsx
│   │   ├── PaymentModal.tsx
│   │   └── OrderReceipt.tsx       ← Printable receipt
│   ├── orders/
│   │   ├── OrderList.tsx
│   │   ├── OrderCard.tsx
│   │   └── OrderFilters.tsx
│   ├── dashboard/
│   │   ├── SalesCard.tsx
│   │   ├── PaymentChart.tsx
│   │   └── TopProducts.tsx
│   ├── reports/
│   │   ├── SalesReport.tsx
│   │   └── ReportFilters.tsx
│   └── shared/
│       ├── ConfirmDialog.tsx
│       ├── EmptyState.tsx
│       └── LoadingSkeleton.tsx
│
├── lib/                           ← Core utilities
│   ├── db.ts                      ← MongoDB connection (global cache)
│   ├── auth.ts                    ← NextAuth.js config
│   ├── cloudinary.ts              ← Cloudinary config
│   ├── cache.ts                   ← In-memory cache (node-cache)
│   ├── utils.ts                   ← Shared utilities (inr, dates)
│   └── constants.ts               ← TABLE_NUMBERS, PAY_STYLES, etc.
│
├── models/                        ← Mongoose models
│   ├── Product.ts
│   ├── Category.ts
│   ├── Customer.ts
│   ├── Order.ts
│   ├── Staff.ts
│   ├── Reservation.ts
│   ├── Event.ts
│   └── Table.ts
│
├── schemas/                       ← Zod schemas + inferred types
│   ├── product.schema.ts
│   ├── order.schema.ts
│   ├── customer.schema.ts
│   ├── category.schema.ts
│   ├── staff.schema.ts
│   ├── reservation.schema.ts
│   ├── event.schema.ts
│   └── index.ts
│
├── hooks/                         ← TanStack Query hooks
│   ├── use-products.ts
│   ├── use-orders.ts
│   ├── use-customers.ts
│   ├── use-categories.ts
│   ├── use-staff.ts
│   ├── use-reservations.ts
│   ├── use-events.ts
│   └── use-tables.ts
│
├── types/                         ← TypeScript types (non-Zod)
│   └── index.ts
│
├── middleware.ts                  ← Next.js middleware (auth guard)
├── auth.config.ts                 ← Auth.js edge-compatible config
├── next.config.ts                 ← Next.js config
├── tailwind.config.ts
├── components.json                ← shadcn/ui config
└── .env.local                     ← Never commit
```

---

## 5. Coding Standards

### General Rules
- TypeScript strict mode — no `any`, no `@ts-ignore` without comment
- No `console.log` in production code — use structured error objects
- No inline styles — Tailwind classes only
- No magic numbers — use named constants from `lib/constants.ts`
- Every function must have a single responsibility
- Max file length: 300 lines. If longer, split into components

### Naming Conventions
- Components: `PascalCase.tsx`
- Hooks: `use-kebab-case.ts`
- Utilities: `camelCase.ts`
- API Routes: `route.ts` (Next.js convention)
- Models: `PascalCase.ts` (singular, e.g. `Order.ts`)
- Schemas: `entity.schema.ts`
- Constants: `SCREAMING_SNAKE_CASE`

### Import Order
1. React + Next.js
2. Third-party libraries
3. Internal: types, schemas, models
4. Internal: hooks, lib, utils
5. Internal: components
6. Styles (if any)

### Component Rules
- Server Components by default — add `'use client'` only when needed (event handlers, hooks, browser APIs)
- `'use client'` components: wrap only the interactive part, not the whole page
- Never fetch data in a client component directly — use hooks or pass as props from server

### API Route Rules
- Always call `connectDB()` first in every route handler
- Always validate request body with Zod `safeParse` — return 400 on failure
- Always return `{ success: true, data: ... }` or `{ success: false, error: '...' }`
- Wrap handler in try/catch — return 500 with message on unexpected errors
- Check session/auth at start of protected routes
- Admin-only routes: check `session.user.role === 'admin'`

---

## 6. Database Rules

### Connection (Critical)
```typescript
// lib/db.ts — ONLY way to connect to MongoDB
let cached = (global as any).mongoose ?? { conn: null, promise: null }

export async function connectDB() {
  if (cached.conn) return cached.conn
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false })
  }
  cached.conn = await cached.promise
  return cached.conn
}
```
- Call `connectDB()` at the start of every API route
- Never call `mongoose.connect()` elsewhere
- `bufferCommands: false` — fail fast rather than queue

### Schema Rules
- All models: `{ timestamps: true }` — always track createdAt/updatedAt
- OrderItem: embedded subdocument with `{ _id: false }` — never save independently
- Denormalize `customerName` in Order — always store name snapshot for display
- Use `lean()` on read queries — returns plain JS objects, not Mongoose documents (faster)
- Use `select()` to fetch only needed fields on list endpoints

### Indexes (Apply on all models)
- Order: `{ date: -1 }`, `{ status: 1 }`, `{ tableNo: 1 }`, `{ customerId: 1 }`
- Customer: `{ mobile: 1 }` unique, text index on `name`
- Product: `{ category: 1 }`, text index on `name`
- Reservation: `{ date: 1, status: 1 }`

---

## 7. API Response Pattern

Every API route returns one of these shapes:

```typescript
// Success
{ success: true, data: T }

// Success with pagination
{ success: true, data: T[], total: number, page: number }

// Error
{ success: false, error: string, details?: Record<string, string[]> }
```

HTTP status codes:
- 200: successful GET/PUT
- 201: successful POST (resource created)
- 400: validation error (Zod parse failed)
- 401: not authenticated
- 403: authenticated but not authorized (wrong role)
- 404: resource not found
- 500: unexpected server error

---

## 8. Auth & Security Rules

### Authentication
- NextAuth.js v5 with Credentials provider
- JWT strategy (no database sessions — stateless, works on serverless)
- Access token in httpOnly session cookie managed by Auth.js
- Session shape: `{ user: { id, name, role: 'admin' | 'staff' } }`

### Role System
- `admin`: full access to everything including staff management, settings, reports
- `staff`: access to POS, orders, customers, reservations, events — NOT staff management
- Role check in API routes: `if (session.user.role !== 'admin') return 403`
- Role check in UI: `useSession()` → show/hide admin-only menu items

### Security Rules
- Rate limiting on `/api/auth/*` — max 5 attempts per IP per minute
- All API routes: validate session before processing
- Admin routes: validate role after session
- Input sanitization: Zod does this — never trust raw `req.body`
- No stack traces in API error responses in production (`NODE_ENV === 'production'`)
- CORS: Next.js API routes are same-origin by default — do not add permissive CORS
- Environment variables: never use `NEXT_PUBLIC_` prefix for secrets
- MongoDB URI: server-only env var — never expose to client

### Middleware (middleware.ts)
- Protect all `/(dashboard)/*` routes — redirect to `/login` if no session
- Allow `/login`, `/api/auth/*`, `/_next/*`, `/favicon.ico` unauthenticated
- Use `auth.config.ts` (edge-compatible, no Mongoose) for middleware

### Password Handling
- Passwords hashed with `bcryptjs` (12 rounds)
- Never store plaintext passwords
- Never return password hash in API responses — always `select('-password')` on Staff model

---

## 9. Caching Strategy

### Backend Cache (node-cache in lib/cache.ts)
```
Products:    5 minutes  — high reads, changes rarely during service
Categories:  5 minutes  — near-static
Staff:       5 minutes  — changes only via admin
Customers:   2 minutes  — updated on order creation
Tables:      30 seconds — live status during service
Reservations: 1 minute — same-day changes possible
Events:      1 minute  — payment updates during bookings
Orders:      NO CACHE  — always live, POS accuracy critical
```

- Invalidate on write: `cache.del('products')` in POST/PUT/DELETE handlers
- Never cache partial data — cache the full list response or not at all
- Cache key naming: entity name only, e.g. `'products'`, `'categories'`

### Frontend Cache (TanStack Query)
- Default: `staleTime: 2min`, `gcTime: 10min`, `retry: 1`, `refetchOnWindowFocus: false`
- Override staleTime per hook to match backend TTL
- Orders: `staleTime: 0` — always refetch
- `invalidateQueries({ queryKey: ['orders'] })` after any order mutation
- Pattern B (cache-based optimistic) for POS order creation only
- Pattern A (UI-based via isPending) for all other mutations

---

## 10. UI/UX Standards

### Design Principles
- **Speed first:** Every interaction must feel instant — use optimistic updates
- **Single action per screen state:** Don't show multiple CTAs at once
- **Mobile-aware:** POS terminal must work on tablet; other pages desktop-first
- **Error-friendly:** Every error shows what went wrong + what to do next
- **Empty states:** Never show a blank screen — always show "Add your first product" type message

### shadcn/ui Rules
- Never modify files in `components/ui/` — update via `npx shadcn@latest add`
- Use existing components: Button, Input, Dialog, Sheet, Table, Select, Badge, Card, Skeleton, Sonner
- Toast notifications: always use `sonner` — `toast.success()` and `toast.error()`
- Modals: use `Dialog` for confirmations, `Sheet` for slide-in forms

### Loading States
- Every list page: show `<Skeleton>` while loading
- Every mutation button: `disabled={isPending}` — prevent double-clicks
- POS order submit: show spinner inside button, disable after click

### Color System (from design skill)
- Use existing CSS variables from globals.css
- Payment colors: Cash=yellow, Online=blue, Due=red, Split=purple, Credit=orange
- Status colors: Pending=amber, Completed=green, Cancelled=gray

### Receipt / Bill
- 80mm thermal printer width = ~300px in CSS
- Print component: `@media print { /* hide sidebar, show receipt only */ }`
- Font: monospace for receipt body (authentic thermal look)
- Always show: restaurant name, order ID, date/time, items, subtotal, discount, total, payment mode

---

## 11. Billing & Printing Rules

### react-to-print Integration
- Receipt component: `components/pos/OrderReceipt.tsx`
- Usage: `const { handlePrint } = useReactToPrint({ contentRef: receiptRef })`
- Auto-print option: set `onAfterPrint` to close modal
- Print-specific CSS: use `@media print` to hide non-receipt elements

### Receipt Layout (80mm thermal format)
```
━━━━━━━━━━━━━━━━━━━━━━━━
      LUCIFER CAFE
   Tagline here
━━━━━━━━━━━━━━━━━━━━━━━━
Order: ORD-20260620-001
Date:  20 Jun 2026 14:30
Table: T-3
Staff: Rahul
━━━━━━━━━━━━━━━━━━━━━━━━
Margherita Pizza   x2  ₹400
Extra Cheese           ₹ 40
Cold Coffee        x1  ₹120
━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal:           ₹560
Discount:           -₹10
TOTAL:              ₹550
Paid (Cash):        ₹550
━━━━━━━━━━━━━━━━━━━━━━━━
    Thank you! Visit again
━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 12. Feature Scope (What to Build)

### Core Features (Must Have)
- [x] Auth: Admin login + Staff login (staff added by admin only)
- [x] POS Terminal: Product grid, cart, discounts, tables, payment
- [x] Menu Management: Products + categories + modifiers + images
- [x] Order Management: List, filter, search, status updates
- [x] Customer CRM: Track visits, spending, due payments
- [x] Table Management: 8 tables, live status
- [x] Staff Management: Admin-only CRUD
- [x] Reservations: Date, time, guests, status
- [x] Event Bookings: Advance payment tracking
- [x] Dashboard: Daily sales, payment breakdown, top products
- [x] Reports: Date-range sales, product-wise, payment-mode-wise, customer dues
- [x] Billing: Print receipt (thermal-compatible), digital view
- [x] Settings: Restaurant name, GST on/off, receipt header/footer

### Nice to Have (Add After Core)
- [ ] Basic stock tracking (low stock alerts)
- [ ] Daily shift summary (start/end of day)
- [ ] Order search by phone number
- [ ] Expense tracking
- [ ] WhatsApp receipt share (via wa.me link)

### Out of Scope (Never Build)
- Multi-restaurant / multi-branch
- Online ordering (Swiggy/Zomato integration)
- Kitchen Display System (KDS)
- Employee attendance/payroll
- Supplier management
- Loyalty points system
- GST filing / e-invoicing

---

## 13. Cloudinary Rules

### Upload Pattern
```typescript
// Use unsigned preset — upload directly from browser
// No server-side proxy needed for images

// In app: use Cloudinary Upload Widget or fetch to Cloudinary API directly
// Store: public_id only (e.g. "lucifer-cafe/products/abc123")
// Render: use cloudinary URL with transformations

const imageUrl = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_300,h_300,c_fill/${publicId}`
```
- Upload preset: create "lucifer_cafe_products" unsigned preset in Cloudinary dashboard
- Folder: `lucifer-cafe/products/`
- On delete: call `/api/upload` DELETE to also remove from Cloudinary
- Never store full Cloudinary URL — always store `public_id` and construct URL at runtime

---

## 14. Session & Phase Workflow (Critical)

### At the START of Every Session
1. Read `CLAUDE.md` (this file) completely
2. Read `.claude-memory/MEMORY.md` index
3. Read the relevant memory files for the current phase
4. Read `.claude/plan/` for the current phase file
5. Check git status to understand current state
6. Confirm which phase is active and which step to resume from

### During a Session
- Work on **ONE task at a time** — complete it fully before starting the next
- After each file is created/modified: verify it compiles (no TypeScript errors)
- After each phase step: run a quick test to confirm the step works
- If a bug is reported: read the full file first, understand the root cause, then fix
- If a code change is requested: review the impact on other files before changing
- Never start Phase N+1 until Phase N checkpoint is complete

### At the END of Every Session
1. Update relevant memory files with what was completed
2. Mark completed steps in the phase plan file
3. Note any issues or decisions made during the session
4. **Always provide the "Next Session Prompt"** — exact prompt for the user to paste in next session

### Next Session Prompt Format
```
Phase [N] — [Phase Name] — Step [X]: [Description]

Context: [What was completed last session]
Resume from: [Exact step to start from]
Check: [File or test to verify before starting]

Paste this to start the next session.
```

---

## 15. Memory Protocol

### Memory Files Location: `.claude-memory/`
- `MEMORY.md` — index (always read first)
- `project_overview.md` — project purpose, scope
- `current_architecture.md` — current tech stack
- `data_models.md` — all entity types
- `migration_target.md` — what we're building to
- `routes_and_features.md` — all pages and features
- `user_profile.md` — who Kartik is, how he works
- `feedback_preferences.md` — confirmed preferences

### When to Update Memory
- After completing a phase: update `current_architecture.md`
- After adding a new entity or model: update `data_models.md`
- After a new user preference is expressed: update `feedback_preferences.md`
- After a tech decision is made: update relevant memory file
- After fixing a non-obvious bug: add to `feedback_preferences.md` with root cause

### What NOT to Store in Memory
- Code snippets (read the actual file)
- Temporary session state
- Todo lists (use plan files)
- Anything derivable from git log or reading files

---

## 16. Agent & Skill Behavior

### Auto-Use These Tools (No Permission Needed)
- Read any file to understand context
- Search codebase for symbols, patterns
- Run `git status`, `git diff`, `git log` to understand state
- Write/Edit files as part of a planned task
- Run `npm run build` to check for TypeScript errors
- Run `npm run lint` to check for lint errors

### Always Ask Before
- `git push` or any remote operation
- Deleting files that might contain important data
- Changing environment variables
- Modifying `package.json` in a way that removes packages

### Skills Available
- `design` skill: code patterns for this project (Controller/Service/Repo, hooks, cache)
- `implementation-plan` skill: phase-by-phase plan reference
- Use `deep-research` for any unclear technology decision

### Agent Rules
- One task at a time — complete it before starting the next
- If blocked: explain the blocker clearly, suggest 2 options, wait for user to decide
- If a bug is reported: reproduce the issue mentally, find root cause, fix minimally
- Never refactor code that is not part of the current task
- Never add features not in the plan without explicit instruction
- Always prefer editing existing files over creating new ones

---

## 17. Performance Rules

### Next.js Specific
- Use Server Components for data-fetching pages (no `useEffect` fetch)
- Use `Suspense` + loading.tsx for route-level loading states
- Use `dynamic()` with `{ ssr: false }` for heavy client components (charts, print)
- Images: always use `next/image` with `width` and `height` — never raw `<img>`
- Fonts: use `next/font` — no external font CDN

### Bundle Rules
- Max 200KB initial JS bundle (check with `next build` output)
- No unused `shadcn/ui` components — only install what's needed
- Import icons individually: `import { X } from 'lucide-react'` — not `import * as Icons`

### API Performance
- Always use `lean()` on Mongoose queries (plain JS, not documents)
- Select only needed fields: `.select('name price category')`
- Paginate list endpoints: default 50 items max
- All API routes must complete in under 8 seconds (Vercel hobby timeout)

---

## 18. Deployment Rules (Vercel)

### Environment Variables (Set in Vercel Dashboard)
```
MONGODB_URI           = mongodb+srv://...
NEXTAUTH_SECRET       = (random 32-char string)
NEXTAUTH_URL          = https://your-app.vercel.app
CLOUDINARY_CLOUD_NAME = ...
CLOUDINARY_API_KEY    = ...
CLOUDINARY_API_SECRET = ...
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = ... (public — needed for upload widget)
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = lucifer_cafe_products
```

### Deployment Checklist
- [ ] `npm run build` passes with 0 TypeScript errors
- [ ] `npm run lint` passes with 0 errors
- [ ] All env vars set in Vercel dashboard
- [ ] MongoDB Atlas IP whitelist: `0.0.0.0/0` (Vercel uses dynamic IPs)
- [ ] NextAuth `NEXTAUTH_URL` set to production URL
- [ ] Cloudinary unsigned upload preset configured
- [ ] Admin account seeded in MongoDB before first login

---

## 19. Common Mistakes to Avoid

1. **Mongoose connection in middleware** — middleware runs on Edge runtime, cannot use Mongoose. Use `auth.config.ts` (edge-compatible) for middleware, full `auth.ts` for API routes.
2. **Missing `connectDB()` call** — every API route must call it first.
3. **`subdoc.save()` is a no-op** — always save the parent Order document.
4. **`NEXT_PUBLIC_` secrets** — never prefix sensitive vars with `NEXT_PUBLIC_`.
5. **Client component for data fetch** — use Server Components or React Query for data fetching, not `useEffect` + fetch.
6. **Missing `'use client'`** — any component using `useState`, `useEffect`, or event handlers needs this.
7. **Forgetting cache invalidation** — after every write, `cache.del('entityName')` in the API route.
8. **Multiple MongoDB connections** — always use `lib/db.ts`, never instantiate directly.
9. **Optimistic update without `cancelQueries`** — always cancel in-flight queries before optimistic setQueryData.
10. **Receipt not printing on all browsers** — test with Chrome AND Firefox. Use `@media print` CSS.

---

## 20. Glossary

| Term | Meaning |
|------|---------|
| POS | Point of Sale — the order creation terminal |
| KOT | Kitchen Order Ticket — copy of order for kitchen |
| Due | Payment not yet collected (paidAmount < total) |
| Split | Payment split between Cash and Online |
| T-1 to T-8 | 8 fixed tables in the cafe |
| Admin | Single super-user who manages staff and settings |
| Staff | Regular users who operate POS and manage orders |
| Phase | A self-contained unit of work with a checkpoint |
| Session | One Claude Code conversation — one phase only |
