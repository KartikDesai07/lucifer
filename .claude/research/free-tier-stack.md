# Free Tier Stack Research — Lucifer Cafe POS

**Date:** 2026-06-20  
**Status:** Verified from official docs + first research run

---

## Vercel Hobby Plan (Free)

| Limit | Value | Impact for POS |
|-------|-------|----------------|
| Bandwidth | 100GB/month | Fine — single cafe, ~100 staff sessions/day |
| Serverless timeout | 10 seconds | Must ensure all API routes complete < 8s |
| Invocations | Unlimited (as of 2025) | No concern |
| Edge functions | Available | Use for middleware (auth check) |
| Builds per day | 100 | Fine for development |
| Domains | 1 custom | Can use `.vercel.app` subdomain for free |

**Key rules:**
- Never do long-running operations in API routes (no file processing, no batch jobs)
- MongoDB connection must be cached globally — cold start + new connection = timeout risk
- Use Edge runtime for middleware (auth check) — faster cold starts

---

## MongoDB Atlas M0 (Free Forever)

| Limit | Value | Impact for POS |
|-------|-------|----------------|
| Storage | 512MB | Fine — restaurant data is tiny (orders = ~2KB each, 50k orders = 100MB) |
| Max connections | 500 (shared) | Must use connection cache pattern |
| Backups | None (manual only) | Weekly export via Atlas GUI |
| Replication | 1 replica | Data is safe |
| Oplog | 1 hour | Sufficient |

**Critical pattern — global connection cache:**
```typescript
// lib/db.ts
let cached = (global as any).mongoose ?? { conn: null, promise: null }
;(global as any).mongoose = cached

export async function connectDB() {
  if (cached.conn) return cached.conn
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI!, {
      bufferCommands: false,
      maxPoolSize: 10,     // limit pool size for serverless
    })
  }
  cached.conn = await cached.promise
  return cached.conn
}
```

**Network access:** Set `0.0.0.0/0` in Atlas → Network Access → Allow from anywhere.
Vercel uses dynamic IPs — cannot whitelist specific IPs.

---

## Cloudinary Free Tier

| Limit | Value | Impact for POS |
|-------|-------|----------------|
| Storage | 25GB | Very generous — even 10,000 product images |
| Bandwidth | 25GB/month | Fine — images are served from CDN, internal use only |
| Transformations | 25 credits/month | Each w_300 transformation = 1 credit on first request (cached after) |
| Upload | Unlimited | No limit on upload count |

**Rules:**
- Use unsigned upload preset — direct browser → Cloudinary (no server proxy needed)
- Request transformation once with `f_auto,q_auto,w_300,h_300,c_fill` — Cloudinary caches it
- Store `public_id` only, not full URL — construct at render time

**Upload preset config (in Cloudinary dashboard):**
- Name: `lucifer_cafe_products`
- Signing mode: Unsigned
- Folder: `lucifer-cafe/products`
- Allowed formats: jpg, jpeg, png, webp
- Max file size: 5MB

---

## Next.js 15 + MongoDB Atlas on Vercel

**Tested pattern for serverless + MongoDB:**
1. Global connection cache (see above)
2. `bufferCommands: false` — fail fast, don't queue
3. `maxPoolSize: 10` — don't exhaust Atlas connection limit
4. Call `connectDB()` at start of every API route
5. Never create connections in middleware (use edge-compatible auth config)

**Cold start mitigation:**
- Vercel Edge functions (middleware) have ~0ms cold start
- Regular serverless functions: 200-500ms cold start on first request
- For POS: this is acceptable — after first request, functions stay warm
- Connection stays alive across warm invocations

---

## react-to-print v3

```bash
npm install react-to-print
```

**Usage:**
```typescript
import { useReactToPrint } from 'react-to-print'

const contentRef = useRef<HTMLDivElement>(null)
const handlePrint = useReactToPrint({
  contentRef,
  documentTitle: 'Receipt',
  pageStyle: `@page { size: 80mm auto; margin: 3mm; }`,
})

// Trigger: handlePrint() — no arguments in v3
```

**80mm thermal compatibility:**
- `@page { size: 80mm auto; margin: 3mm; }` — tells browser the paper size
- Works with any thermal printer that has Windows/Mac print driver installed
- Browser must be Chrome or Firefox (Safari has print limitations)
- No plugins needed — uses browser's native print API
- Auto-print without dialog is NOT possible (browser security blocks it)
  → Always shows print dialog — user clicks "Print"

---

## NextAuth.js v5 (Auth.js) on Vercel

**Session strategy: JWT** — recommended for Vercel serverless
- No database calls per request (stateless)
- JWT stored in httpOnly cookie (not localStorage)
- Auth.js manages cookie security automatically

**Split config pattern (required):**
- `auth.config.ts` — edge-compatible (for middleware, no bcrypt/mongoose)
- `lib/auth.ts` — full config with bcrypt/mongoose (for API routes)

**Protected routes via middleware:**
- middleware.ts uses `auth.config.ts` (edge runtime)
- Works on Vercel Edge Network — very fast
- Redirects unauthenticated users to `/login` before page loads

---

## Decision: Next.js App Router vs Express on Vercel

| Factor | Next.js App Router | Express on Vercel |
|--------|------------------|-------------------|
| Cold starts | ~200ms | ~200ms |
| MongoDB connection | Global cache works | Same pattern |
| CORS | Not needed (same origin) | Required |
| Deployment | Single `vercel deploy` | Complex serverless adapter |
| Auth | Auth.js v5 native | Manual JWT setup |
| File uploads | API route → Cloudinary | Same |
| Vercel support | First-class | Supported but not native |

**Decision: Next.js App Router** — clearly superior for Vercel deployment.

---

## Total Monthly Cost: ₹0

| Service | Plan | Cost |
|---------|------|------|
| Vercel | Hobby | Free |
| MongoDB Atlas | M0 | Free |
| Cloudinary | Free tier | Free |
| Domain (optional) | .vercel.app | Free |
| **Total** | | **₹0/month** |
