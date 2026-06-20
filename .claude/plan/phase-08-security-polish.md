# Phase 8 — Security Hardening + Polish + Data Migration

**Status:** ⏳ Pending  
**Prerequisites:** Phase 7 complete  
**Estimated time:** 1.5 days

---

## Goal

Production-ready security, smooth UX polish, and migration of existing data from Supabase to MongoDB.
After this phase: zero obvious bugs, security audit passed, data migrated.

---

## Security Steps

### Step 8.1 — Rate limiting on auth routes
```typescript
// middleware.ts — add rate limiting for login attempts
// Use in-memory rate limiter (no Redis needed for single instance)
// Max 5 failed login attempts per IP per 15 minutes
// Return 429 with "Too many attempts. Try again in X minutes"

// Simple implementation with Map:
const loginAttempts = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  
  if (!record || now > record.resetTime) {
    loginAttempts.set(ip, { count: 1, resetTime: now + 15 * 60 * 1000 })
    return true
  }
  
  if (record.count >= 5) return false
  
  record.count++
  return true
}
```

### Step 8.2 — Security headers
Add to `next.config.ts`:
```typescript
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
```

### Step 8.3 — Input sanitization
Verify all string inputs are trimmed and max-length validated in Zod schemas:
```typescript
// Add to all string fields in schemas:
z.string().trim().max(200)  // names
z.string().trim().max(10)   // mobile
z.string().trim().max(1000) // notes
```

### Step 8.4 — Admin account hardening
- Add `POST /api/staff/change-password` endpoint
- Force admin to change default password after first login (add `mustChangePassword` flag)
- Validate new password: min 8 chars, at least 1 number, 1 special char

### Step 8.5 — Production error handling
```typescript
// In all API routes: don't leak stack traces
// Already handled in lib/api-helpers.ts:
if (process.env.NODE_ENV === 'production') {
  return error('Internal server error')  // no details
} else {
  return error(e.message)  // show message in dev
}
```

### Step 8.6 — Audit log for admin actions (simple)
```typescript
// models/AuditLog.ts
// { action, staffId, staffName, target, details, timestamp }
// Log: staff create/delete, product create/delete, order delete, settings change
// Simple console.log in production (can enhance later)
// Admin-only GET /api/audit endpoint to view recent actions
```

---

## Polish Steps

### Step 8.7 — Global loading state
```typescript
// app/loading.tsx — route-level loading
// components/shared/PageLoader.tsx — full page spinner
// All data tables: show Skeleton while loading
```

### Step 8.8 — Error boundaries
```typescript
// app/error.tsx — global error boundary
// Shows user-friendly message with "Try Again" button
// In development: shows stack trace
// In production: "Something went wrong. Please refresh."
```

### Step 8.9 — Empty states for all pages
Verify every page has an EmptyState component when no data:
- Products: "Add your first menu item to get started"
- Customers: "No customers yet. Add one or they'll appear after their first order"
- Orders: "No orders found for the selected filters"
- etc.

### Step 8.10 — Confirm dialogs for destructive actions
Every delete action must show ConfirmDialog:
```typescript
// "Are you sure you want to delete {itemName}? This cannot be undone."
// [Cancel] [Delete]
// Delete button: red variant, shows spinner while deleting
```

### Step 8.11 — Mobile responsiveness check
- Sidebar: collapses on mobile (Sheet or Drawer component)
- POS terminal: test on tablet (768px)
- Tables: horizontal scroll wrapper for wide tables
- Receipt: full-width on mobile

### Step 8.12 — Toast notifications audit
Verify every action has appropriate feedback:
- Create: "X created successfully"
- Update: "X updated"
- Delete: "X deleted"
- Error: specific error message (not just "Error occurred")
- Network error: "Connection failed. Please check your internet."

### Step 8.13 — Performance audit
- Check `npm run build` output for large bundles
- Use `dynamic()` for recharts, react-to-print
- Product images: use `next/image` with proper sizes
- API responses: verify `lean()` on all queries

---

## Data Migration Steps

### Step 8.14 — Migration script
```typescript
// scripts/migrate-from-supabase.ts
// 1. Connect to Supabase via REST API (SUPABASE_URL + SERVICE_KEY)
// 2. Fetch all data from app_kv table
// 3. Parse each key's JSON value
// 4. Transform and insert into MongoDB collections
// 5. Report results

// Add to .env.local (temp, remove after migration):
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx

// Migration map:
// cafe.products   → products collection (add isActive: true, timestamps)
// cafe.categories → categories collection (create { name, order } docs)
// cafe.customers  → customers collection (add timestamps)
// cafe.orders     → orders collection (parse dates, add orderId if missing)
// cafe.staff      → skip (new staff system)
// cafe.reservations → reservations collection
// cafe.events     → events collection
// cafe.tableStatus → tables collection (update status)
```

### Step 8.15 — Run migration + verify
1. Run `npm run migrate` 
2. Check MongoDB Atlas: all collections populated
3. Open app: products load, orders show, customers visible
4. Dashboard shows historical data

### Step 8.16 — Remove Supabase code
After migration verified:
- Remove `@supabase/supabase-js` from package.json
- Remove `src/integrations/supabase/` folder (if migrated from TanStack Start)
- Remove `src/lib/storage.ts` (replaced by hooks)
- Remove Supabase env vars from `.env.local`

---

## Checkpoint Criteria

- [ ] Rate limiting: 5 failed logins → 429 response
- [ ] Security headers present in network tab
- [ ] No stack traces in production error responses
- [ ] Admin must change password after first login
- [ ] All deletes show confirm dialog
- [ ] All mutations have toast feedback
- [ ] App works on 768px (tablet) in POS
- [ ] `npm run build` has no TypeScript or lint errors
- [ ] Supabase data migrated to MongoDB
- [ ] Supabase removed from codebase

---

## Next Session Prompt

```
Phase 9 — Deploy to Vercel + Production Setup

Context: Phase 8 complete. Security hardened. Data migrated from Supabase.
Polish complete. Zero TypeScript errors. All features working.

Resume from: Step 9.1 — Set up Vercel project and environment variables
Check: npm run build passes. All existing data visible. No console errors.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-09-deploy.md before starting.
```
