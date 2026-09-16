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
| `MONGODB_URI` | `mongodb+srv://…` Atlas connection string. **Must include the database path** (`…mongodb.net/pos?…`) — a path-less SRV silently connects to a database named `test`, so the app and the seeder can end up in different databases. |
| `HEALTH_STATS_TOKEN` | any random 32-byte value. Unset, `/api/health?stats=1` returns cluster gauges to anonymous callers. |
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

`NEXTAUTH_URL` / `AUTH_URL` must be **ABSENT** — not merely "not needed". Auth.js v5
auto-detects the deployment URL and `trustHost: true` is set in `auth.config.ts`; if
either variable IS set, next-auth rewrites every request's origin to that value and
**login breaks everywhere**. Do not copy them in from a local `.env`.

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
# …repeat for NEXTAUTH_SECRET, TENANT_ID, ROOT_DOMAIN, HEALTH_STATS_TOKEN
#   image store (optional): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#   R2_BUCKET, NEXT_PUBLIC_R2_PUBLIC_BASE_URL — or IMAGE_STORE=cloudinary plus all
#   FOUR of CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET and
#   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME (the public one is REQUIRED to render them)

npm run deploy -- --profile <client>     # from the REPO ROOT, never from apps/cafe
```

**Every deploy command runs from the repo root**, and always with an explicit
`--profile`. `scripts/deploy.mjs` uploads the whole workspace (the app alone cannot
resolve the `@pos/shared` workspace package) and the project's Root Directory setting
selects what to build. A bare `npm run deploy` with no profile is refused on purpose,
so a client deploy can never land on the wrong project. **The Vercel CLI does NOT read
`.gitignore`**: what gets uploaded is decided by the repo-root `.vercelignore` plus the
CLI's own default exclusions (`.env.local`, `node_modules`, `.git`, `.vercel` …) — so
every secret-bearing path (`clients/`, `deploy.profiles.json`, every `.env*`) is listed
in `.vercelignore` too. Add there, not to `.gitignore`, when a new one appears.

### One command for a new cafe: `npm run go-live -- <client>`

Prefer the **owner console**: `npm run go-live:ui` (or double-click `go-live-ui.cmd`)
opens a local page at http://127.0.0.1:4848 that edits the same client files with a
form — cafe details, Vercel/Atlas logins and tokens, admin credentials, notes — and
runs Dry run / Go live / Redeploy / Health with a live log. Owner-only, loopback-only,
never part of the product.

**Web address (console ⚙ Platform → `clients/_platform.json`):** every cafe is served
at `<subdomain>.<apex>` on the ONE owner-controlled apex domain recorded there (no
per-client "own domain" any more). The Hosting card's Web address field takes just the
first label; the panel below it shows a status chip, the CNAME/TXT records to add at
the DNS provider, and a **Check DNS & verify** button. Go live/Update on Vercel attaches
and verifies the address but only **switches** TENANT_ID to it once DNS/TLS are ready
(`state: ready`; "reachable" means the address answers as one of this cafe's own
tenant ids, never just any site) — until then the cafe keeps serving its current host
and the console shows **HOLD**. On a real switch the old `*.vercel.app` address (and, after
a rename, the old `<sub>.<apex>` name) is left **redirecting** to the new one (so old printed QR codes and bookmarks keep working) and the after-switch
checklist appears: staff sign in again, counter PC → "Change server address…", Settings →
Telegram → Repair webhook, R2 bucket CORS → add the new origin. **More ▾ → Revert web
address…** removes the redirects first, then goes back to the `*.vercel.app` address (the
subdomain stays attached in Vercel until removed by hand). `--check-dns` on the CLI does
the same DNS/verify check without deploying.

**Fresh start on Vercel (Danger zone / `--fresh-start --confirm <slug> --confirm-project
<name>`):** deletes the client's Vercel project (all its `*.vercel.app` names, the web address,
env vars, deployments, WAF rules) and deploys fresh into the SAME account — database, images,
logins and secrets untouched. Guards (nothing is deleted before all pass): deploy lock, typed
slug, typed project name that must also equal what Vercel reports for the recorded id, token
reaches the project, no rollout running. The cafe is offline from the delete until the new
deploy finishes (≈ 3–5 min); the new project may get a suffixed `*.vercel.app` name — the web
address is the stable URL; re-add the 3 WAF rules by hand.

**Console layout:** sidebar Dashboard (KPIs + clients table + recent runs) · Clients ·
Rollouts · Archive · Platform; a client opens as tabs (Overview · Hosting · Database & images ·
POS setup · Contact & notes · Danger zone). Routes live in the URL hash (`#/client/<slug>/<tab>`).

**One deploy at a time per client, from anywhere:** every client-changing run (console job,
`node scripts/go-live/index.mjs <slug> …`, `deploy.mjs --profile <slug>`, a rollout target) takes
`clients/_locks/<slug>.lock` (pid inside; a dead pid is taken over automatically). A second start
is refused with the holder's action/pid. The top bar shows the running job or foreign lock with
**Stop…** (kills the console's own job) and **Force stop & unlock…** (typed slug; kills the other
process only if it is provably ours — a node process started when the lock says — then frees the
lock once it is gone); **↻ Refresh** re-reads the record, the current job and the locks.

**Interrupted first run (e.g. after Fresh start):** the deploy profile is written the moment the
project exists, `lastRun` shows `running` from the start (so a console closed mid-run leaves
`interrupted` visible), Redeploy stays disabled until the set-up finished (`generated.host`), and
**Update on Vercel** continues from where it stopped — a project with no production deployment yet
is deployed straight onto its web address (nothing serves, so there is no HOLD). `deploy.mjs`
rebuilds a missing profile from the client record when the set-up had finished, else points to
Update on Vercel. After the first seed the
console marks cafe details, admin login, tables and menu as **record-only** — that data
lives in the POS from then on (sidebar: Tables · Menu / Categories · Settings) and a
re-seed touches only what is still EMPTY (no products yet → starter menu; no tables →
starter tables; no admin; no settings); "Edit anyway" exists only for seeding a NEW,
empty database. Lifecycle lives under **More ▾**: *Clone as new client* (starter setup
only, no credentials), *Move hosting to another Vercel account* (path A = Vercel's own
**Transfer Project**, same URL; path B = forget the recorded project and let the next
run create a fresh one in the new account), *Reset demo database* (clients ticked
"Demo client" only — drops the database, seeds fresh; typed slug + database-name
guards, re-checked by `apps/cafe/scripts/reset-demo-db.ts`), and *Archive client*
(moves the file to `clients/_archive/`, restorable; ticks `deployLock` and parks ALL of its
deploy profiles — the primary `<slug>` and every `<slug>-<label>` — inside the record so
neither the console nor `npm run deploy` can deploy a retired cafe; nothing on Vercel/Atlas
changes — the dialog lists the retire steps: mongodump first, delete each Vercel project
(primary and every standby account), terminate the Atlas cluster, revoke the tokens/user).
`scripts/deploy.mjs` refuses a profile whose owning record (active or archived, by slug or
`<slug>-<label>`) is archived or carries `deployLock: true`, and a profile claimed by more
than one record. One project per client forever: the
recorded project id is adopted before any name lookup; a recorded project the token
cannot see stops the run unless a same-named project exists in that account (a Vercel
transfer) — it never creates a second project behind your back. **Standby hosts**
(Hosting → Standby hosts, or `standbyHosts[]` in the file): the same cafe deployed to
other Vercel accounts as warm spares — same database, images and auth secret (same POS
usernames/passwords; the session cookie is per address, so staff sign in once per host),
each with its own token, project (`<slug>-<label>`), `*.vercel.app` URL and deploy profile
(`npm run deploy -- --profile <slug>-<label>`); no seeding from a standby (the primary must
have seeded first); the web address stays on the primary. `npm run go-live -- <client>
--host <label>`. A standby label whose `<slug>-<label>` equals another client's slug is
refused. **Deploy update to ALL clients** (More ▾, or `npm run go-live -- --deploy-all
[--resume]`): every deployed, unlocked primary and standby is redeployed ONE AFTER ANOTHER
(plain `deploy.mjs --profile`, env and data untouched); a failed target is recorded and the
queue continues; the state lives in `clients/_rollout.json` after every step, so a PC that
switches off resumes with only the unfinished/failed targets. One driver at a time: a
`clients/_rollout.lock` (pid) stops the console and the CLI from deploying the same list
simultaneously — the console shows a CLI-driven rollout read-only, and a lock whose process
is gone is taken over (that is the resume). **Delete client** exists only
for records with no history (never deployed/seeded); anything else goes Archive → retire →
"Delete permanently" from the Archived list, always with the slug typed.

Everything in this section (project, Root Directory, env vars, profile, deploy,
health check) plus the first-run seed is one command, driven by ONE file:

```bash
cp scripts/go-live/client.example.json clients/<name>.json   # or demo.example.json
#  fill in: vercel.token (client's Vercel → Settings → Tokens), mongodbUri (Atlas
#  SRV ending in /pos), admin.password, cafe.name … — see the _readme in the file
node scripts/go-live/index.mjs <name>            # or double-click go-live.cmd
node scripts/go-live/index.mjs <name> --dry-run  # validate + show the plan only
# `npm run go-live -- <name> …` is the same thing, but from PowerShell npm drops the
# flags after `--` — use the node form there.
```

What it does, in order: validates the file · seeds the cafe's database (settings,
admin, tables, starter menu — never overwriting existing data) · creates the Vercel
project with **Root Directory = `apps/cafe`** (or adopts it if it exists) · reads the
domain Vercel actually assigned and derives `TENANT_ID`/`ROOT_DOMAIN` from it (or
attaches the custom `domain` you named) · mints `NEXTAUTH_SECRET`/`AUTH_SECRET` +
`HEALTH_STATS_TOKEN` once · saves every env var on the project via the API · writes
the `deploy.profiles.json` profile · runs `scripts/deploy.mjs --profile <name>` ·
polls `/api/health` until `ok:true, db:"up"` with the right tenant. Re-running is safe
and continues where it stopped. `clients/<name>.json` holds live credentials: it is
gitignored and `.vercelignore`d — keep it out of chat, mail and screenshots. Still
manual afterwards: the 3 WAF rules and, with R2, the bucket CORS rule (checklist §1).

### Demo data

For a client ticked `"demo": true`, **Danger zone → Reset & seed demo data…** (or
`--seed-demo`) drops its database and builds a month of realistic content to show
prospective clients: a full menu (categories, 100+ products, photos), 40
customers with dues, ~31 days of orders (dine-in and takeaway, cash/online/split/
due payments, a few voids and cancellations, 3 open tabs today), events,
reservations, and QR self-order requests. Staff logins (`priya` / `rahul` /
`amit`) share the seeded admin's password. Vercel is not touched — same
project, same URL, same env.

```bash
node scripts/go-live/index.mjs <demo-client> --seed-demo --confirm <slug> --confirm-db <database> [--images <dir>]
```

- `--images <dir>` (or the console's "Images folder on this PC" field) points at
  a folder of product photos on this machine; uploading them needs the R2 keys
  set on the client file's `image` block — without R2 configured, or without
  `--images`, the photos are skipped and the rest of the demo still builds.
- Same three guards as **Reset demo database**: the file must say `"demo": true`,
  the typed slug must equal it, and the typed database name must equal the one
  the file's `mongodbUri` points at right now.
- Re-running **drops and rebuilds from scratch** — never point this at a live
  cafe's database.

### Do NOT use GitHub auto-deploy for a client

Client deploys are **CLI-only**, deliberately. Git integration means every push to
the tracked branch ships to a live cafe — on 2026-08-12 a branch push auto-triggered
a build on the v1 project and only its stale Root Directory stopped it from becoming
a production deploy of untested code. It is also impractical here: the repo lives on
a personal GitHub account, so a client's own Vercel account cannot import it without
being granted access to that account's repo.

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
