# DB hygiene — keep-alive, backups, heartbeat (F2 Step F2.9)

Operational glue that keeps a federation of free Atlas M0 clusters alive,
backed up, and observable. Three legs:

| Leg | Where | Cadence |
|-----|-------|---------|
| Keep-alive ping | `.github/workflows/db-keepalive.yml` → `keepalive.mjs` | **every 3–5 days — that workflow's cron is the single source of truth** |
| Backups | `.github/workflows/db-backup.yml` → `backup-manifest.mjs` + `mongodump` | nightly 03:00 IST (old immutable archives: weekly, staggered) |
| Runtime heartbeat | `GET /api/health?stats=1` (`apps/cafe/lib/heartbeat.ts`, contract in `@pos/shared/heartbeat`) | pulled by F3's Cloudflare Worker; no cafe cron (#26) |

## GitHub configuration

Repo **secrets**:

- `CORE_MONGODB_URI` — the CORE cluster SRV URI (falls back to `MONGODB_URI`).
  Ledger/standby URIs are enumerated from the CORE `clusterRegistry` doc at
  run time — growth never touches CI config.
- `BACKUP_PASSPHRASE` — encrypts every archive (openssl AES-256-CBC, PBKDF2).
  Losing it makes every backup unreadable; store it in the owner vault.
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — any
  S3-compatible store works (Cloudflare R2 free 10 GB, Backblaze B2, …).

Repo **variables** (optional): `TENANT_ID` (object-key prefix, default `dev`),
`BACKUP_RETENTION_DAYS` (default 14 — size the bucket: N clusters × nightly
gzip dumps × retention must stay inside the store's free tier).

## Restore drill (do this at least once)

```sh
# 1. fetch an artifact
aws s3 cp "s3://$R2_BUCKET/db-backups/<tenant>/<tag>/<date>.archive.gz.enc" . \
  --endpoint-url "$R2_ENDPOINT"

# 2. decrypt (same parameters the workflow used)
openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 210000 \
  -in "<date>.archive.gz.enc" -out restore.archive.gz -pass env:BACKUP_PASSPHRASE

# 3. restore into a SCRATCH cluster — never a live one
mongorestore --uri "mongodb+srv://.../scratch" --gzip --archive=restore.archive.gz
```

CI already proves each artifact decrypts back to the exact dump bytes
(`openssl -d | cmp`); the full `mongorestore` round-trip is this manual drill
(also reachable via the workflow's `force_all` dispatch input, which dumps
every cluster regardless of the stagger).

## Honest boundaries & caveats

- **RPO = the last successful nightly dump** (phase-F2 §6): M0 has no PITR.
  Settled orders are immutable, so per-cluster dumps are effectively
  consistent for the ledger.
- **Recently-retired archives stay nightly for 8 days** (`lib.mjs`): F2.7's
  non-revoking roll-forward lets trailing writes land on a retiring ledger, so
  its final days must not wait a week for their first backup. Older archives
  are immutable → weekly slots.
- **GitHub cron is best-effort** and schedules are disabled after ~60 days of
  repo inactivity. The Hub's stale-backup alert (>36 h, F3.11) is the
  watchdog; until F3, check the Actions tab after quiet stretches.
- **Keep-alive is superseded by F3**: once the Cloudflare failover Worker
  polls `/api/health?stats=1` per tenant, that poll's per-cluster `db.stats()`
  touch covers the auto-pause dodge (F3 §3.3) → delete `db-keepalive.yml`.
  The backup workflow stays (F3.11 only adds the staleness alert on top).
- **F3 vault**: registry-stored URIs are plaintext today (`encryptUriForStore`
  is identity). When the AES-256-GCM vault lands, these scripts fail fast on
  ciphertext (`assertDialableUri`) until the vault decrypt (+ its key as a
  repo secret) is wired in — a deliberate loud stop, never a silent skip.
- **Manual signup boundary** (phase-F2 §2.12): nothing here creates Atlas
  accounts; scripts only touch clusters already in the registry doc.
- `/api/health?stats=1` can be gated with the `HEALTH_STATS_TOKEN` env var on
  the cafe deployment (header `x-stats-token`); F3 sets it and hands it to the
  Worker. Unset = open (bootstrap/dev). Failed probes surface as
  `state:"error"` only — raw driver messages never leave the server (the F2.7
  `statsError` caveat).

## Local runs

```sh
node --test scripts/db-hygiene/lib.test.mjs          # pure logic, no DB
CORE_MONGODB_URI="mongodb+srv://…" node scripts/db-hygiene/keepalive.mjs
CORE_MONGODB_URI="mongodb+srv://…" node scripts/db-hygiene/backup-manifest.mjs /tmp/m.json
```

The driver resolves from the monorepo root install locally; CI installs it via
`npm install --prefix scripts/db-hygiene` (this folder is deliberately outside
the npm workspaces so workflows never install the whole monorepo).
