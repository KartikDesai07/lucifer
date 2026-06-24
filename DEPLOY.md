# Deploy — Lucifer Cafe POS

**Host:** Vercel (free Hobby tier) — Next.js 15 on Vercel's Node.js runtime.
**Database:** MongoDB Atlas M0 (free).
**Images:** Cloudinary (signed uploads via `/api/upload`).

**Live:** https://lucifer-liard.vercel.app

> **Why Vercel, not Cloudflare Workers?** Workers' per-request I/O isolation makes a
> cached MongoDB socket unusable across requests (intermittent 500s — see the
> migration notes). Vercel runs the app on real Node.js, where Mongoose's global
> connection cache (`lib/db.ts`) works reliably. No app code is Cloudflare-specific.
>
> ⚠️ **Commercial-use note:** Vercel's free **Hobby** plan is officially for
> non-commercial use; a paying restaurant POS is commercial. For a single small cafe
> the practical risk is low (Vercel warns before acting), but if it ever grows or
> Vercel flags it, upgrade to **Pro ($20/mo)** or move to a ~$5/mo always-on host
> (Railway/Fly/VPS — all run this app unchanged).

---

## 0. One-time prerequisites

- **MongoDB Atlas** → Network Access → add `0.0.0.0/0` (Vercel uses dynamic egress IPs).
- **Cloudinary** account with the API key/secret + cloud name.
- A free **Vercel** account.

## Environment variables

Set these in the **Vercel Project → Settings → Environment Variables** (or via the
CLI, below). All except the public one are secrets.

| Name | Notes |
|------|-------|
| `MONGODB_URI` | `mongodb+srv://…` Atlas connection string. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 33`. (`AUTH_SECRET` also works.) |
| `CLOUDINARY_CLOUD_NAME` | server-side (signing/delete). |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | inlined into the client bundle at build; needed to render product images. |

`NEXTAUTH_URL` / `AUTH_URL` are **not needed** — Auth.js v5 auto-detects the Vercel
deployment URL, and `trustHost: true` is set in `auth.config.ts`.

---

## 1. Deploy via the Vercel CLI (what this project uses)

```bash
npx vercel login            # browser auth (your Vercel account)
npx vercel link --yes       # create + link the project (Next.js auto-detected)

# set the 6 env vars (one-time) — e.g. pipe each value:
printf '%s' "<value>" | npx vercel env add MONGODB_URI production
# …repeat for NEXTAUTH_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
#   CLOUDINARY_API_SECRET, NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME

npm run deploy              # = vercel --prod  (builds remotely + promotes to prod)
```

The CLI uploads the source (respecting `.gitignore`, so `.env.local` is **not**
uploaded) and builds on Vercel. Subsequent deploys: just `npm run deploy`.

### Alternative — GitHub auto-deploy

Push the repo to a GitHub repo, then **vercel.com → Add New → Project → Import** it.
Set the env vars in the dashboard. Every push to the main branch then auto-deploys.

### Seed the admin (one-time, only if a fresh DB)

If `MONGODB_URI` points at a DB that already has your admin/data, skip this. For a
brand-new DB:

```bash
MONGODB_URI="mongodb+srv://…" SEED_ADMIN_PASSWORD="<strong>" npm run seed:admin
MONGODB_URI="mongodb+srv://…" npm run seed:tables
```

---

## 2. Post-deploy smoke test

- [ ] Open the URL → login page loads
- [ ] `GET /api/health` → `{ "status": "ok", "db": "connected" }`
- [ ] Log in as admin
- [ ] Dashboard KPIs + live floor populate (exercises the summary/aggregate)
- [ ] Add a product with an image (Cloudinary upload works)
- [ ] POS: open a tab → fire KOT → settle; receipt prints
- [ ] Orders page date filter + search work
- [ ] Reports load with data

## 3. Backups

Atlas M0 has **no automatic backups**. Export weekly: Atlas UI → Collections →
Export, or `mongodump --uri "$MONGODB_URI"`. Keep `.env.local` + the admin password
somewhere safe (not in git).

## 4. Going further (optional)

- **Custom domain:** Vercel → Project → Domains → add your domain.
- **Always-on / no cold starts:** Vercel Pro, or a ~$5/mo Railway/Fly/VPS (Mongoose
  works the same on all — `lib/db.ts` is host-agnostic).
