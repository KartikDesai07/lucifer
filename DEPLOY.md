# Deploy — Lucifer Cafe POS

**Primary:** Cloudflare Workers (free, commercial-OK, global edge) via the OpenNext adapter.
**Backup:** Vercel free (see the ⚠️ note before using it for live traffic).
**Database:** MongoDB Atlas M0 (one shared cluster — the same DB backs both hosts).

Both deploys serve the same app from one codebase. There is **no custom domain**, so the
client's URL is the free `*.workers.dev` address (and the `*.vercel.app` backup).

---

## 0. One-time prerequisites

- **MongoDB Atlas** → Network Access → add `0.0.0.0/0` (Cloudflare and Vercel both use
  dynamic egress IPs, so the whole range must be allowed).
- **Cloudinary** → unsigned upload preset `lucifer_cafe_products` exists.
- Accounts: a free **Cloudflare** account, and (for the backup) a free **Vercel** account.

## Environment variables

| Name | Where | Notes |
|------|-------|-------|
| `MONGODB_URI` | secret | `mongodb+srv://…` — SRV works on Workers (compat date ≥ 2025-03-20). |
| `NEXTAUTH_SECRET` | secret | `openssl rand -base64 33`. (`AUTH_SECRET` also works — Auth.js v5 reads either.) |
| `NEXTAUTH_URL` | var | The deployed URL, e.g. `https://lucifer-cafe.<acct>.workers.dev`. Optional — `trustHost:true` is set in `auth.config.ts` — but recommended once the URL is known. |
| `CLOUDINARY_CLOUD_NAME` | secret | |
| `CLOUDINARY_API_KEY` | secret | |
| `CLOUDINARY_API_SECRET` | secret | |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | build-time | Inlined into the client bundle at build from `.env.local` / build env. |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | build-time | `lucifer_cafe_products`. |

`NEXT_PUBLIC_*` are baked in at **build** time. When you run `npm run deploy` locally they
come from `.env.local`. On Cloudflare's Git CI, set them as **build** environment variables.

---

## 1. Cloudflare Workers (primary)

The config lives in `wrangler.jsonc` + `open-next.config.ts`. `compatibility_date` is
`2025-03-20` with `nodejs_compat` — that's what lets Mongoose open a TCP/TLS connection to Atlas.

### Option A — Cloudflare Git CI (recommended)

OpenNext's local build/preview is **not fully supported on native Windows** (the local
`preview:cf` boots `workerd`, which crashes on Windows). Building on Cloudflare's Linux CI
avoids this entirely and gives push-to-deploy.

1. Push the repo to GitHub (private is fine).
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a repository**.
3. Build command: `npx opennextjs-cloudflare build` · Deploy command: `npx opennextjs-cloudflare deploy`.
4. Add the env vars/secrets above in the project settings (mark secrets as encrypted; add the
   `NEXT_PUBLIC_*` as build variables).
5. Deploy. URL: `https://lucifer-cafe.<account>.workers.dev`.

### Option B — local CLI deploy

The OpenNext **build** works on Windows (validated — produces `.open-next/worker.js`); only the
local *preview* doesn't. Deploy uploads the built worker, so this works from Windows:

```bash
npx wrangler login                 # opens browser OAuth (your Cloudflare account)
npx wrangler secret put MONGODB_URI
npx wrangler secret put NEXTAUTH_SECRET
npx wrangler secret put CLOUDINARY_CLOUD_NAME
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
npm run deploy                     # = opennextjs-cloudflare build && … deploy
```

### Seed the admin on production (one-time)

```bash
# point a local shell at the PROD MongoDB, then seed:
MONGODB_URI="mongodb+srv://…prod…" SEED_ADMIN_PASSWORD="<strong>" npm run seed:admin
MONGODB_URI="mongodb+srv://…prod…" npm run seed:tables
```

---

## 2. Vercel (backup)

> ⚠️ **Read this first.** Vercel's **free (Hobby) plan prohibits commercial use** — and that
> explicitly includes any site that requests/processes payment. A restaurant POS is commercial,
> so running it on Vercel free (including as a live backup) is against Vercel's Fair Use terms
> and could be suspended. The compliant alternatives are **Vercel Pro ($20/mo)** or a **~$5/mo
> VPS**. This backup is set up per the owner's explicit decision; use it at your own risk.
>
> Note also: this backup shares the **same Atlas database** as Cloudflare, so it does not protect
> against a database outage — only against Cloudflare itself being unreachable. Failover is
> **manual** (point staff at the Vercel URL); automatic one-URL failover needs Cloudflare's paid
> Load Balancing.

The repo is Vercel-ready with no code changes (Node runtime, edge-safe middleware, env fallback).

1. Push the repo to GitHub.
2. Vercel → **Add New → Project → Import** the repo. Framework auto-detects as Next.js.
3. Add the env vars above in **Project Settings → Environment Variables**
   (`NEXT_PUBLIC_*` for all environments; secrets as needed). `NEXTAUTH_URL` is auto-detected
   on Vercel — leave it unset unless you add a custom domain.
4. Deploy. URL: `https://<project>.vercel.app`.

If a Mongoose bundling warning appears in the Vercel build, add
`serverExternalPackages: ['mongoose']` to `next.config.ts` (Vercel-only; it is **not** needed
for — and was deliberately left out to avoid disturbing — the validated Cloudflare build).

---

## 3. Failover runbook (manual)

- **Primary:** `https://lucifer-cafe.<account>.workers.dev`
- **Backup:** `https://<project>.vercel.app`
- Both read/write the **same** MongoDB Atlas database, so data is identical and consistent.
- **If Cloudflare is unreachable:** have staff open the Vercel URL instead. No data migration
  needed — same DB. Switch back when Cloudflare recovers.
- **If MongoDB is unreachable:** *both* URLs are down. This is the real single point of failure;
  Atlas M0 is internally a 3-node replica set with auto-failover, so this should be rare.

## 4. Backups

- Atlas M0 has **no automated backups**. Export weekly: Atlas UI → Collections → Export, or
  `mongodump --uri "$MONGODB_URI"`.
- Keep `.env.local` and the seeded admin password somewhere safe (not in git).

## 5. Post-deploy smoke test

- [ ] Login page loads · admin can log in
- [ ] Dashboard loads (KPIs + live floor)
- [ ] Add a product with image (Cloudinary upload works)
- [ ] POS: open a tab → fire KOT → settle; receipt prints
- [ ] Reports load with today's data
- [ ] No console errors; HTTPS enforced (automatic on both hosts)
