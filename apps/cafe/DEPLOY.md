# Deploy — POS Software

**Host:** Vercel (free Hobby tier) — Next.js 15 on Vercel's Node.js runtime.
**Database:** MongoDB Atlas M0 (free).
**Images:** the cafe's own **Cloudflare R2** bucket (presigned PUTs via `/api/upload`;
the default since F2.11). `IMAGE_STORE=cloudinary` keeps a deploy on its single
per-cafe Cloudinary account instead — existing Cloudinary images render/delete
fine either way (refs are store-tagged).

**Live:** `https://<client-slug>.<ROOT_DOMAIN>` — a bare `*.vercel.app` host does
**not** work (see the `ROOT_DOMAIN` row below).

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
- **Cloudflare R2** (the cafe's own free account): create a bucket, an R2 API token
  (Object Read & Write, scoped to that bucket), and enable public access for reads
  (an `r2.dev` public bucket URL or a custom domain).
  - **CORS (required for browser uploads):** on the bucket, allow the app origin(s)
    with methods `PUT`, and headers `content-type` (Cloudflare dashboard → R2 →
    bucket → Settings → CORS policy). Example:
    ```json
    [{ "AllowedOrigins": ["https://<client-slug>.<root-domain>"],
       "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"] }]
    ```
- *(alternative)* a **Cloudinary** account with API key/secret + cloud name, and
  `IMAGE_STORE=cloudinary` set.
- A free **Vercel** account.

## Environment variables

Set these in the **Vercel Project → Settings → Environment Variables** (or via the
CLI, below). All except the public one are secrets.

| Name | Notes |
|------|-------|
| `MONGODB_URI` | `mongodb+srv://…` Atlas connection string. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 33`. (`AUTH_SECRET` also works.) |
| `ROOT_DOMAIN` | **required for any real deployment** — the apex the cafe's host sits under, so `<slug>.<ROOT_DOMAIN>` resolves. Unset, only `localhost`, `*.localhost` and `<sub>---<branch>.vercel.app` previews resolve, and every other host — including a bare `*.vercel.app` — is 404'd in `middleware.ts`. **To ship on Vercel's own free domain, set it to `vercel.app`** (probe-verified): then `<project-slug>.vercel.app` resolves with the project slug as the tenant id, while Vercel's per-deployment preview URLs still 404 (their subdomain ≠ `TENANT_ID`). |
| `TENANT_ID` | the cafe's slug. When set, the middleware 404s any host whose subdomain doesn't match it, so a misrouted domain can never serve the wrong cafe; it also stamps the heartbeat. Leave unset only for local dev. |
| `R2_ACCOUNT_ID` | Cloudflare account id (the hex id in the R2 S3 endpoint). |
| `R2_ACCESS_KEY_ID` | from the bucket-scoped R2 API token. |
| `R2_SECRET_ACCESS_KEY` | |
| `R2_BUCKET` | the cafe's bucket name. |
| `R2_KEY_PREFIX` | optional — only for a shared bucket (`tenant/<id>/`); leave unset for the normal bucket-per-cafe shape. |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | the bucket's public base (`https://pub-….r2.dev` or the custom domain); inlined at build, needed to render R2 images. **Changing it later requires a new deployment** — a dashboard edit alone has no effect. |
| `IMAGE_STORE` | optional — `cloudinary` to keep uploading to Cloudinary; default is `r2`. |
| `CLOUDINARY_CLOUD_NAME` | only if on Cloudinary — server-side (signing/delete of legacy images too). |
| `CLOUDINARY_API_KEY` | 〃 |
| `CLOUDINARY_API_SECRET` | 〃 |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | only if any Cloudinary images exist; inlined at build to render them. |

`NEXTAUTH_URL` / `AUTH_URL` are **not needed** — Auth.js v5 auto-detects the Vercel
deployment URL, and `trustHost: true` is set in `auth.config.ts`.

---

## 1. Deploy via the Vercel CLI (what this project uses)

One-time, in the Vercel dashboard: **Project → Settings → Build and Deployment →
Root Directory = `apps/cafe`** (this app lives in a monorepo). Rehearse the first
deploy with `npm run deploy -- --preview` before promoting to production — see
`docs/GO-LIVE-CHECKLIST.md` §1 for why that rehearsal matters.

```bash
npx vercel login            # browser auth (your Vercel account)
npx vercel link --yes       # create + link the project (Next.js auto-detected)

# set the env vars (one-time) — e.g. pipe each value:
printf '%s' "<value>" | npx vercel env add MONGODB_URI production
# …repeat for NEXTAUTH_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
#   R2_SECRET_ACCESS_KEY, R2_BUCKET, NEXT_PUBLIC_R2_PUBLIC_BASE_URL
#   (+ the CLOUDINARY_* trio and IMAGE_STORE=cloudinary if staying on Cloudinary)

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

> Taking a **new cafe** live? This smoke test is one step inside
> `docs/GO-LIVE-CHECKLIST.md`, which owns the full sequence (seeding, Settings,
> floor plan, menu import, staff, the on-device printer leg, handover). Run this
> section, then continue there.

- [ ] Open the URL → login page loads
- [ ] `GET /api/health` → HTTP 200 `{ "ok": true, "db": "up", … }` (a 503 with `"db": "down"` = app up, cluster unreachable)
- [ ] Log in as admin
- [ ] Dashboard KPIs + live floor populate (exercises the summary/aggregate)
- [ ] Add a product with an image (browser PUTs to the cafe's own R2 bucket; needs the bucket CORS rule above)
- [ ] POS: open a tab → fire KOT → settle; receipt prints
- [ ] Orders page date filter + search work
- [ ] Reports load with data

## 3. Backups

Atlas M0 has **no automatic backups**. This repo carries an encrypted nightly
`mongodump` workflow (`.github/workflows/db-backup.yml` → R2) plus a keep-alive
job — but GitHub only runs workflows that have been **committed and pushed**, so
confirm both appear in the repository's Actions tab with a run history before
treating them as a safety net. Setup and the restore drill:
`docs/GO-LIVE-CHECKLIST.md` §9.

Manual fallback, and what to do until those jobs are live: export weekly via
Atlas UI → Collections → Export, or `mongodump --uri "$MONGODB_URI"`.

Do **not** retain a client's credentials. Their `.env.local` holds a live Atlas
SRV and the seeded admin password is one-time: both are cleared off the dev box
at `docs/GO-LIVE-CHECKLIST.md` §2, the client's own password is unrecoverable by
design, and anything you must keep belongs in the owner's vault — never a local
file, and never git.

## 4. Going further (optional)

- **Custom domain:** Vercel → Project → Domains → add your domain.
- **Always-on / no cold starts:** Vercel Pro, or a ~$5/mo Railway/Fly/VPS (Mongoose
  works the same on all — `lib/db.ts` is host-agnostic).
