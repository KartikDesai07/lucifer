# Phase 9 — Deploy to Vercel + Production Setup

**Status:** ⏳ Pending  
**Prerequisites:** Phase 8 complete (everything works, 0 errors)  
**Estimated time:** 0.5 day

---

## Goal

Lucifer Cafe POS live on Vercel. Accessible from any device on the cafe network.
MongoDB Atlas connected. Cloudinary working. Admin can log in on production URL.

---

## Pre-Deploy Checklist

- [ ] `npm run build` passes locally with 0 errors
- [ ] `npm run lint` passes with 0 errors
- [ ] All env vars documented in `.env.example`
- [ ] `.env.local` NOT committed to git
- [ ] MongoDB Atlas account active
- [ ] Cloudinary account active with unsigned upload preset
- [ ] Git repository pushed to GitHub

---

## Steps

### Step 9.1 — Prepare for Vercel deployment

Final `next.config.ts`:
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' }
    ]
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ]
      }
    ]
  }
}

export default nextConfig
```

### Step 9.2 — MongoDB Atlas production setup
1. In Atlas: create production M0 cluster (free tier)
2. Database access: create user `lucifer-prod` with strong password
3. Network access: add `0.0.0.0/0` (Vercel uses dynamic IPs — must allow all)
4. Get connection string: `mongodb+srv://lucifer-prod:PASSWORD@cluster.mongodb.net/lucifer-cafe-prod`

### Step 9.3 — Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (first time — sets up project)
vercel deploy --prod

# Follow prompts:
# Link to existing project? No → create new
# Project name: lucifer-cafe
# Framework: Next.js (auto-detected)
# Root: ./
```

### Step 9.4 — Set environment variables in Vercel
In Vercel dashboard → Project → Settings → Environment Variables:

```
MONGODB_URI             = mongodb+srv://lucifer-prod:...@cluster.../lucifer-cafe-prod
NEXTAUTH_SECRET         = (generate: openssl rand -base64 32)
NEXTAUTH_URL            = https://lucifer-cafe.vercel.app

CLOUDINARY_CLOUD_NAME   = your-cloud-name
CLOUDINARY_API_KEY      = your-api-key
CLOUDINARY_API_SECRET   = your-api-secret
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME     = your-cloud-name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET  = lucifer_cafe_products
```

Apply to: Production + Preview + Development

### Step 9.5 — Run seed on production
```bash
# One-time: seed admin account on production MongoDB
# Temporarily add production MONGODB_URI to local .env.local
# Run seed script pointing to production DB:
MONGODB_URI="mongodb+srv://...prod..." npm run seed

# Then restore local MONGODB_URI
```

Or: use MongoDB Atlas Data Explorer to insert the admin document manually.

### Step 9.6 — Redeploy with env vars
```bash
vercel deploy --prod
```

### Step 9.7 — Production smoke test
- [ ] Open production URL
- [ ] See login page
- [ ] Login with admin credentials
- [ ] Dashboard loads with empty state
- [ ] Add a category
- [ ] Add a product with image (Cloudinary upload works)
- [ ] Place an order from POS
- [ ] Print receipt (browser print dialog)
- [ ] Reports show today's data

### Step 9.8 — Custom domain (optional)
If user has a domain:
1. Vercel dashboard → Settings → Domains
2. Add domain: `pos.lucifercafe.com` (example)
3. Add DNS CNAME record at domain registrar
4. Update `NEXTAUTH_URL` to new domain

### Step 9.9 — Performance verification
After deploy, check:
- Lighthouse score (aim for 90+ performance)
- Time to first byte < 500ms
- API routes respond < 3s (Vercel serverless cold start + MongoDB)
- Images load from Cloudinary CDN quickly

---

## Production Maintenance Notes

### If MongoDB Atlas M0 fills up (512MB)
- Export old orders to CSV
- Delete orders older than 6 months
- Or upgrade to M2 ($9/month) for 2GB

### If Vercel hobby plan hits limits
- Hobby plan: 100GB bandwidth, unlimited invocations
- For a single cafe: should never hit limits
- Monitor in Vercel dashboard: Usage tab

### Cloudinary free tier monitoring
- 25 credits/month = ~25MB of transformations
- Product images: use c_fill,w_300,h_300 to keep small
- Monitor: Cloudinary dashboard → Usage

### Backup strategy (basic)
- MongoDB Atlas: auto daily backups on M2+ (paid)
- For free M0: weekly manual export via Atlas GUI or mongodump
- Add reminder in MEMORY.md

---

## Checkpoint Criteria (Final)

- [ ] Production URL accessible
- [ ] Login works on production
- [ ] Product image uploads to Cloudinary
- [ ] POS creates orders (check MongoDB Atlas)
- [ ] Receipt prints correctly
- [ ] Reports load with data
- [ ] No console errors in production
- [ ] HTTPS enforced (Vercel auto)
- [ ] Admin password changed from default

---

## 🎉 Project Complete

Once all checkboxes above are checked, Lucifer Cafe POS v1.0 is live.

**Production URL:** https://lucifer-cafe.vercel.app  
**Stack:** Next.js 15 + MongoDB Atlas + Cloudinary + Vercel  
**Monthly cost:** ₹0 (100% free tier)

---

## Post-Launch Improvements (Future Sessions)

Implement these when the user asks, one at a time:
1. Stock tracking with low-stock alerts
2. Daily shift summary (open/close day)
3. Expense tracking (daily expenses)
4. Multiple receipt formats (A4 invoice)
5. Order search by customer phone
6. Automatic daily email report (send to admin email)
7. PWA (installable on tablet/phone as an app)
8. Keyboard shortcuts for POS (F1 = new order, etc.)
