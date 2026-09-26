#!/usr/bin/env node
// One command takes a new cafe live — no Vercel dashboard, no manual env vars.
// From PowerShell prefer the direct form `node scripts/go-live/index.mjs <client> …`
// (npm's `--` argument passing loses flags there); the npm form below works from
// cmd.exe / Git Bash and inside the .cmd wrappers.
//
//   npm run go-live -- <client>              clients/<client>.json → live
//   npm run go-live -- <client> --preview    preview deploy instead of production
//   npm run go-live -- <client> --skip-seed  don't touch the database (already seeded)
//   npm run go-live -- <client> --dry-run    validate the file and show the plan only
//   npm run go-live -- path/to/file.json     any client file by path
//   npm run go-live -- <client> --host standby
//                                            the same cafe on a STANDBY Vercel account (standbyHosts[].label);
//                                            same database/images/secrets, its own *.vercel.app URL
//   npm run go-live -- <client> --reset-demo --confirm <slug> --confirm-db <database>
//                                            DEMO ONLY: drop its database, seed fresh (file must say "demo": true;
//                                            the database name must be the one the file's URI points at)
//   npm run go-live -- <client> --seed-demo --confirm <slug> --confirm-db <database> [--images <dir>]
//                                            DEMO ONLY: drop its database and build 31 days of realistic demo data
//                                            (menu with photos, customers, orders, dues, events, reservations, QR
//                                            requests) — same guards as --reset-demo; --images points at a folder
//                                            of product photos on THIS pc (needs R2 keys on the client file to upload)
//   npm run go-live -- <client> --check-dns  re-check the web address's DNS/verification without deploying
//                                            anything (needs clients/_platform.json and a deployed client)
//   npm run go-live -- <client> --fresh-start --confirm <slug> --confirm-project <project-name>
//                                            delete this client's Vercel project (its domains, env vars and
//                                            deployments go with it) and deploy fresh into the SAME account —
//                                            database, images and logins are untouched
//
// The client file (gitignored clients/ folder — it holds LIVE credentials) is the
// only input: copy scripts/go-live/client.example.json (or demo.example.json for
// a demo café) to clients/<name>.json and fill in the token, the Atlas URI and
// the admin password. Everything else is automatic; re-running is safe.
// Every cafe is served at <subdomain>.<apex> — the apex domain is set once in
// clients/_platform.json (console: ⚙ Platform). Deploy-only: this never touches git.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, rmSync } from "node:fs";
import { createDnsCheck } from "./dns-check.mjs";
import { redactSecrets, secretsOf } from "./lib.mjs";
import { acquireClientLock, LOCKS_DIR, lockMessage, releaseClientLock } from "./lock.mjs";
import { runRolloutCli, summarize as summarizeRollout } from "./rollout.mjs";
import { checkWebAddress } from "./web-address.mjs";
import { runFreshStart } from "./fresh-start.mjs";
import { GoLiveError, runGoLive, runResetDemo, runSeedDemo } from "./run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Same override the owner console honours, so both always read one folder.
const CLIENTS_DIR = process.env.GO_LIVE_CLIENTS_DIR ?? path.join(ROOT, "clients");
const EXIT = { ok: 0, usage: 2, failed: 1 };
const FLAGS = new Set(["--preview", "--skip-seed", "--dry-run", "--reset-demo", "--seed-demo", "--confirm", "--confirm-db", "--host", "--deploy-all", "--resume", "--check-dns", "--fresh-start", "--confirm-project", "--images"]);

function usage(msg) {
  if (msg) console.error(`\ngo-live: ${msg}\n`);
  console.error("usage: npm run go-live -- <client|path.json> [--host <standby-label>] [--preview] [--skip-seed] [--dry-run] [--reset-demo --confirm <slug> --confirm-db <database>] [--seed-demo --confirm <slug> --confirm-db <database> [--images <dir>]] [--check-dns] [--fresh-start --confirm <slug> --confirm-project <project-name>]");
  console.error("       npm run go-live -- --deploy-all [--resume]      redeploy EVERY deployed client + standby, one after another (state in clients/_rollout.json)");
  process.exit(EXIT.usage);
}

// ── --deploy-all: the code-update rollout over every client ────────────────
if (process.argv.includes("--deploy-all")) {
  const records = () => readdirSync(CLIENTS_DIR).filter((f) => f.endsWith(".json") && /^[a-z0-9][a-z0-9-]*\.json$/.test(f)).map((f) => {
    try { return { name: f.slice(0, -".json".length), client: JSON.parse(readFileSync(path.join(CLIENTS_DIR, f), "utf8")) }; } catch { return null; }
  }).filter(Boolean);
  try {
    const state = runRolloutCli({ resume: process.argv.includes("--resume") }, { fs: { existsSync, readFileSync, writeFileSync, rmSync }, join: path.join, spawn: spawnSync, log: (l) => console.log(l), now: () => Date.now(), dir: CLIENTS_DIR, root: ROOT, env: process.env, records });
    const s = summarizeRollout(state);
    console.log(`\n${s.failed ? "⚠️ " : "✅"} rollout finished: ${s.ok} ok · ${s.failed} failed · ${s.skipped} skipped${s.cancelled ? ` · ${s.cancelled} cancelled` : ""} (${s.total} targets)`);
    for (const t of state.targets) if (t.status !== "ok" && t.status !== "skipped") console.log(`   ✗ ${t.profile}: ${t.error || t.status}`);
    if (s.failed) console.log("   fix the cause, then: npm run go-live -- --deploy-all --resume   (re-runs only the failed ones)");
    process.exit(s.failed ? EXIT.failed : EXIT.ok);
  } catch (err) {
    console.error(`\nrollout FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT.failed);
  }
}

const rawArgs = process.argv.slice(2);
// `--confirm <slug>`, `--confirm-db <database>`, `--confirm-project <name>`, `--host <label>` and `--images <dir>` take a value; everything else is a bare flag.
const valueFlags = ["--confirm", "--confirm-db", "--host", "--confirm-project", "--images"];
const values = Object.fromEntries(valueFlags.map((f) => { const i = rawArgs.indexOf(f); return [f, i >= 0 ? rawArgs[i + 1] : undefined]; }));
const valueIdx = new Set(valueFlags.map((f) => rawArgs.indexOf(f) + 1).filter((i) => i > 0));
const args = rawArgs.filter((_a, i) => !valueIdx.has(i));
const confirmValue = values["--confirm"];
const confirmDbValue = values["--confirm-db"];
const hostValue = values["--host"];
const confirmProjectValue = values["--confirm-project"];
const imagesValue = values["--images"];
const flags = new Set(args.filter((a) => a.startsWith("--")));
for (const f of flags) if (!FLAGS.has(f)) usage(`unknown option "${f}"`);
if (flags.has("--reset-demo") && (!confirmValue || !confirmDbValue)) usage("--reset-demo needs --confirm <slug> --confirm-db <database name> (the guards; both are re-checked against the file)");
if (flags.has("--seed-demo") && (!confirmValue || !confirmDbValue)) usage("--seed-demo needs --confirm <slug> --confirm-db <database name> (the guards; both are re-checked against the file)");
if (flags.has("--fresh-start") && (!confirmValue || !confirmProjectValue)) usage("--fresh-start needs --confirm <slug> --confirm-project <project-name> (both are re-checked against the file)");
if (flags.has("--fresh-start") && hostValue) usage("--fresh-start is for the primary hosting only — run it without --host");
const names = args.filter((a) => !a.startsWith("--"));
if (names.length !== 1) usage(names.length === 0 ? "name the client (clients/<name>.json)" : "one client at a time");
const clientPath = names[0].endsWith(".json") ? path.resolve(ROOT, names[0]) : path.join(CLIENTS_DIR, `${names[0]}.json`);
// The lock key is the FILE NAME (matches deploy.mjs's own slug derivation and
// the console's profile names) — it works even when the file is missing or
// broken, which is exactly when a lock must still be checkable.
const slug = path.basename(clientPath, ".json");
const locksDir = path.join(path.dirname(clientPath), LOCKS_DIR);

const deps = {
  fs: { existsSync, readFileSync, writeFileSync, readdirSync },
  spawn: (cmd, cmdArgs, opts) => spawnSync(cmd, cmdArgs, { ...opts, stdio: "inherit", shell: process.platform === "win32" && cmd === "npm" }),
  // Captures output instead of streaming to the terminal — the ONLY way to parse
  // wrangler's own printed URL / detect its exit code. Every captured line still
  // reaches deps.log (the CLI prints it, the console redacts it with
  // secretsOf) — this just adds a seam to read it first.
  spawnCapture: (cmd, cmdArgs, opts) => {
    const res = spawnSync(cmd, cmdArgs, { ...opts, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" });
    // `error` is set (and status is null) when the process could not be started at all (ENOENT…).
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error ?? null };
  },
  fetch: globalThis.fetch,
  randomBytes,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
  env: process.env,
  dnsCheck: createDnsCheck(),
};

// ── per-client lock: one deploy at a time for this client, from ANYWHERE ────
// --dry-run reads and validates only (never touches Vercel) and --deploy-all
// drives its own rollout lock — neither locks a single client here.
const lockedAction = flags.has("--reset-demo")
  ? "reset-demo"
  : flags.has("--seed-demo")
    ? "seed-demo"
    : flags.has("--check-dns")
    ? "check-dns"
    : flags.has("--fresh-start")
      ? "fresh-start"
      : flags.has("--dry-run")
        ? null
        : flags.has("--preview")
          ? "preview"
          : "go-live";
let lockHeld = false;
if (lockedAction) {
  const acquired = acquireClientLock({ existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync }, locksDir, slug, { pid: process.pid, action: lockedAction, owner: "cli" }, path.join);
  if (!acquired.ok) {
    console.error(`\ngo-live: ${lockMessage(acquired.held)}\n`);
    process.exit(EXIT.failed);
  }
  lockHeld = true;
  // Reentrancy: a child `deploy.mjs` spawned by this run must not re-acquire
  // the same client's lock — we already hold it for the whole run.
  deps.env = { ...deps.env, GO_LIVE_LOCK_HELD: slug };
}

function printRecordsTable(records) {
  console.log("    TYPE   NAME     VALUE");
  for (const r of records) console.log(`    ${r.type.padEnd(6)} ${r.name.padEnd(8)} ${r.value}`);
}

function realtimeLine(r) {
  if (r.state === "on") return `on — ${r.workerName} (client's Cloudflare) · ${r.url}/join`;
  if (r.state === "off") return "off (record has no Cloudflare block)";
  if (r.state === "standby") return "polling (standby)";
  return "not set up — the cafe polls (Hosting → Realtime to enable)";
}

function printSummary(s) {
  if (s.dryRun) {
    console.log(`\ngo-live DRY RUN — "${s.slug}"${s.hostLabel !== "primary" ? ` (standby "${s.hostLabel}")` : ""} is valid. Plan: ${s.steps.join(" → ")}. Project "${s.projectName}", host ${s.host}.`);
    return;
  }
  const line = "─".repeat(64);
  if (s.freshStart) {
    console.log(`\n${line}\n  FRESH START — "${s.slug}"\n${line}`);
    console.log(`  Deleted project  ${s.deletedProject.name} (${s.deletedProject.id})`);
    console.log(`  Deleted domains  ${s.deletedProject.domains.length ? s.deletedProject.domains.join(", ") : "(none)"}`);
    console.log("  WAF: re-add the 3 rules (Vercel → Project → Security → WAF, for /m and /api/public/*)");
  }
  console.log(`\n${line}\n  ${s.health.ok ? "✅ LIVE" : s.health.ok === null ? "🟡 DEPLOYED" : "⚠️  DEPLOYED, health check failed"}  ${s.url}${s.hostLabel !== "primary" ? `   (standby "${s.hostLabel}")` : ""}\n${line}`);
  console.log(`  Vercel account  ${s.account}\n  Project         ${s.projectName} (${s.projectId})\n  Tenant          TENANT_ID=${s.tenantId}  ROOT_DOMAIN=${s.rootDomain}`);
  console.log(`  Env vars        ${s.envCount} saved on the project (image store: ${s.imageStore})\n  Admin login     ${s.adminUsername} / the password from the client file (${s.adminNote})`);
  console.log(`  Health          ${s.health.ok ? "ok: true · db: up" : s.health.reason}`);
  if (s.realtime) console.log(`  Realtime        ${realtimeLine(s.realtime)}`);
  if (s.dns.pending) {
    console.log(`\n  DNS — add this record at the domain's DNS provider, then open the URL:\n    ${s.dns.record}`);
    for (const c of s.dns.challenges) console.log(`    ${c.type}  ${c.domain}  →  ${c.value}`);
  }
  if (s.webAddress) {
    console.log(`\n  Web address   https://${s.webAddress.host} · ${s.webAddress.state}`);
    if (!s.webAddress.live) {
      printRecordsTable(s.webAddress.records);
      console.log(`    Add these at your DNS provider, then:\n      Check DNS & verify (console) or  node scripts/go-live/index.mjs ${s.slug} --check-dns`);
    }
  }
  if (s.switched) {
    console.log(`\n  SWITCHED  https://${s.previousHost}  →  https://${s.host}`);
    console.log("    After the switch:");
    console.log("      1) staff sign in again on the new address");
    console.log("      2) counter PC: menu → Change server address…");
    console.log("      3) POS Settings → Telegram → Repair webhook");
    console.log("      4) R2 bucket CORS: add https://" + s.host);
    console.log(`      5) old printed QR codes: keep working via the redirect (${s.webAddress && s.webAddress.redirects && s.webAddress.redirects.every((r) => r.ok) ? "ok" : "check the redirect below"}), else reprint`);
  }
  if (s.held) {
    console.log(`\n  HOLD  address not switched — ${s.previousHost ?? s.host} keeps serving`);
  }
  console.log(`\n  Redeploy later  ${s.redeploy}\n  Still manual    Vercel → Project → Security → WAF: 3 rules for /m and /api/public/*  (GO-LIVE-CHECKLIST §1)${s.imageStore === "r2" ? "\n                  R2 bucket CORS: allow PUT + content-type from " + s.url : ""}\n${line}\n`);
}

function printWebAddressCheck(r, slug) {
  console.log(`\ngo-live --check-dns — "${slug}"`);
  if (r.state === "no-subdomain" || r.state === "no-project") {
    console.log(`  ${r.message}\n`);
    return;
  }
  console.log(`  ${r.host} · ${r.state}`);
  if (r.live) {
    console.log("  This address is live and serving.");
  } else if (r.state === "ready") {
    // DNS + https are fine; only TENANT_ID has not been switched to it yet.
    console.log(`  DNS and https are ready — run go-live for "${slug}" (console: Update on Vercel) to switch the cafe to this address.`);
  } else {
    printRecordsTable(r.records);
    console.log(`\n  Next step: add these records at your DNS provider, then run this check again.`);
  }
  console.log("");
}

const task = (flags.has("--reset-demo")
  ? runResetDemo({ root: ROOT, clientPath, confirm: confirmValue, confirmDb: confirmDbValue }, deps).then((r) => ({ ...r, resetDemo: true }))
  : flags.has("--seed-demo")
    ? runSeedDemo({ root: ROOT, clientPath, confirm: confirmValue, confirmDb: confirmDbValue, imagesDir: imagesValue ?? null }, deps).then((r) => ({ ...r, seedDemo: true }))
    : flags.has("--check-dns")
      ? checkWebAddress({ clientPath }, deps).then((r) => ({ ...r, checkDns: true }))
      : flags.has("--fresh-start")
        ? runFreshStart({ root: ROOT, clientPath, confirm: confirmValue, confirmProject: confirmProjectValue }, deps)
        : runGoLive({ root: ROOT, clientPath, host: hostValue, preview: flags.has("--preview"), skipSeed: flags.has("--skip-seed"), dryRun: flags.has("--dry-run") }, deps)
).finally(() => {
  if (lockHeld) releaseClientLock({ existsSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync }, locksDir, slug, process.pid, path.join);
});

task.then(
  (summary) => {
    if (summary.resetDemo) {
      console.log(`\n✅ DEMO RESET  "${summary.slug}" — database "${summary.dbName}" is fresh (settings · admin ${summary.adminUsername} · tables · starter menu).${summary.host ? ` Live at https://${summary.host} — Vercel untouched.` : ""}\n`);
      process.exit(EXIT.ok);
    }
    if (summary.seedDemo) {
      const line = "─".repeat(64);
      console.log(`\n${line}\n  DEMO DATA  "${summary.slug}"\n${line}`);
      console.log(`  Database        ${summary.dbName}`);
      console.log(`  Images folder   ${summary.imagesDir ?? "none — photos skipped"}`);
      console.log(`  Admin login     ${summary.adminUsername} / the password from the client file`);
      console.log(`${summary.host ? `  Live at         https://${summary.host}\n` : ""}  Open the cafe → Dashboard/Orders/Customers/Reports to review.\n${line}\n`);
      process.exit(EXIT.ok);
    }
    if (summary.checkDns) {
      printWebAddressCheck(summary, names[0]);
      process.exit(EXIT.ok);
    }
    printSummary(summary);
    process.exit(summary.dryRun || summary.health.ok !== false ? EXIT.ok : EXIT.failed);
  },
  (err) => {
    // Never let a provider/driver error carry a secret into the terminal or the console log.
    let secrets = [];
    try { secrets = secretsOf(JSON.parse(readFileSync(clientPath, "utf8"))); } catch { /* unreadable file: nothing to redact */ }
    const clean = (text) => redactSecrets(text, secrets);
    if (err instanceof GoLiveError) {
      console.error(`\ngo-live FAILED at step "${err.step}": ${clean(err.message)}`);
      if (err.hint) console.error(`  → ${clean(err.hint)}`);
      if (!["read", "validate", "guard"].includes(err.step)) console.error("  Re-running the same command continues from where it stopped.");
      console.error("");
    } else {
      console.error(`\ngo-live FAILED: ${clean(err instanceof Error ? err.message : String(err))}\n`);
    }
    process.exit(EXIT.failed);
  },
);
