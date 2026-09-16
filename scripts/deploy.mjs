#!/usr/bin/env node
// One-command deploy — DEPLOY ONLY, never touches git (no add/commit/push).
//
//   npm run deploy                          → profile "default"
//   npm run deploy -- --profile <name>      → a named profile (another cafe / account)
//   npm run deploy -- --preview             → preview deploy instead of production
//   npm run deploy -- --list                → show configured profiles
//
// Profiles live in deploy.profiles.json (repo root, GITIGNORED — may hold tokens).
// Copy deploy.profiles.example.json to start. Each profile targets one Vercel
// project in one account:
// The deploy always runs from the REPO ROOT (npm workspaces — see the cwd note
// further down); `app` names the workspace, and the Vercel project's own
// "Root Directory" setting must match it.
//   {
//     "default": {
//       "app": "apps/cafe",            // which workspace to deploy
//       "orgId": "team_…",             // + projectId → targets the project directly,
//       "projectId": "prj_…",          //   no `vercel link` needed (per-account deploys)
//       "scope": null,                  // optional --scope (team/user slug)
//       "tokenEnv": "VERCEL_TOKEN",    // env var holding the token (preferred), or
//       "token": null                   // an inline token (file is gitignored)
//     }
//   }
// Tier B note: every cafe = its own Vercel account (active + standby), so a cafe is
// simply two profiles here. Without a token the deploy uses the machine's logged-in
// Vercel CLI session (fine for the owner's own account).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireClientLock, LOCKS_DIR, lockMessage, releaseClientLock } from "./go-live/lock.mjs";
import { mergeProfile } from "./go-live/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES_FILE = path.join(ROOT, "deploy.profiles.json");

function fail(msg) {
  console.error(`\ndeploy: ${msg}\n`);
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let profileName = "default";
let preview = false;
let list = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--profile") profileName = args[++i] ?? fail("--profile needs a name");
  else if (a === "--preview") preview = true;
  else if (a === "--list") list = true;
  else fail(`unknown option "${a}" (valid: --profile <name>, --preview, --list)`);
}

// ── profiles ─────────────────────────────────────────────────────────────────
let profiles = {};
if (existsSync(PROFILES_FILE)) {
  try {
    profiles = JSON.parse(readFileSync(PROFILES_FILE, "utf8"));
  } catch {
    fail(`deploy.profiles.json is not valid JSON — fix it or delete it`);
  }
}

if (list) {
  const names = Object.keys(profiles);
  if (!names.length) {
    console.log("No profiles configured. Copy deploy.profiles.example.json → deploy.profiles.json");
  } else {
    for (const n of names) {
      const p = profiles[n];
      console.log(
        `${n.padEnd(16)} app=${p.app ?? "apps/cafe"}  project=${p.projectId ?? "(linked)"}  auth=${
          p.token ? "inline-token" : p.tokenEnv ? `env:${p.tokenEnv}` : "CLI login"
        }`,
      );
    }
  }
  process.exit(0);
}

// ── owner-console lock (clientsDir/recordsOwningProfile defined early: the
// "profile missing" rebuild below needs the same owning-record lookup) ───────
// A client record (clients/<slug>.json, gitignored) carrying `deployLock: true` is
// a cafe the owner marked "record only" or archived — never deploy it from here
// either. A profile belongs to a record when it IS the slug or `<slug>-<standby
// label>`. Profiles without a matching record (the v1 targets) are unaffected.
const clientsDir = process.env.GO_LIVE_CLIENTS_DIR ?? path.join(ROOT, "clients"); // same override index.mjs and the console honour
/** Every record — active or archived — that owns this profile name (slug, or "<slug>-<standby label>"). */
function recordsOwningProfile(name) {
  const out = [];
  for (const [dir, archived] of [[clientsDir, false], [path.join(clientsDir, "_archive"), true]]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const slug = file.slice(0, -".json".length);
      let record;
      try {
        record = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      } catch {
        if (slug === name) fail(`clients/${archived ? "_archive/" : ""}${file} is not valid JSON — fix it before deploying`);
        continue;
      }
      const labels = Array.isArray(record.standbyHosts) ? record.standbyHosts.map((h) => h && h.label).filter(Boolean) : [];
      if (slug === name || labels.some((l) => `${slug}-${l}` === name)) out.push({ slug, record, archived });
    }
  }
  return out;
}

// The empty-profile fallback exists for a fresh clone that has a `.vercel` link
// and no profiles file at all. It must NOT apply once profiles ARE configured:
// otherwise a bare `npm run deploy` (profileName "default") silently falls back
// to whatever the local link points at — which is how a deploy meant for one
// cafe can land on another. With profiles present, the target must be explicit.
const configuredNames = Object.keys(profiles);
let profile =
  profiles[profileName] ??
  (profileName === "default" && configuredNames.length === 0 ? {} : null);
if (!profile) {
  // The profile can be MISSING while the client is fully set up: an interrupted
  // first run (Fresh start, or a console session that closed mid-way) can attach
  // a domain and record a project before it ever reaches the profile write. Rather
  // than a flat "not found", rebuild it from the client record when that record
  // proves the project really is deployable — an ACTIVE owner only; an archived
  // one keeps failing below like before this change (never resurrect a retired cafe).
  const activeOwners = recordsOwningProfile(profileName).filter((o) => !o.archived);
  const owner = activeOwners.length === 1 ? activeOwners[0] : null;
  const slot = owner ? (owner.slug === profileName ? { vercel: owner.record.vercel, gen: owner.record.generated ?? {} } : (() => {
    const label = profileName.slice(owner.slug.length + 1);
    const h = (owner.record.standbyHosts ?? []).find((x) => x && x.label === label);
    return h ? { vercel: h.vercel, gen: h.generated ?? {} } : null;
  })()) : null;
  if (slot && slot.gen.projectId && slot.gen.orgId && slot.vercel && slot.vercel.token && slot.gen.host) {
    profiles = mergeProfile(profiles, profileName, { orgId: slot.gen.orgId, projectId: slot.gen.projectId, token: slot.vercel.token, teamId: slot.vercel.teamId ?? null });
    profile = profiles[profileName];
    writeFileSync(PROFILES_FILE, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
    console.log(`deploy: profile "${profileName}" was missing — rebuilt from clients/${owner.slug}.json`);
  } else if (slot && slot.gen.projectId && !slot.gen.host) {
    fail(`client "${owner.slug}" is not fully set up yet (project exists, env/deploy never finished) — run: node scripts/go-live/index.mjs ${owner.slug}   (console: Update on Vercel)`);
  } else {
    fail(
      `profile "${profileName}" not found in deploy.profiles.json.\n` +
        `Configured: ${configuredNames.join(", ") || "(none)"}\n` +
        `Every client deploy must name its target: npm run deploy -- --profile <name>`,
    );
  }
}
const owners = recordsOwningProfile(profileName);
if (owners.length > 1) {
  fail(`profile "${profileName}" is claimed by more than one client record (${owners.map((o) => (o.archived ? "_archive/" : "") + o.slug).join(", ")}) — resolve the name clash in the owner console before deploying.`);
}
let lockedSlug = null;
if (owners.length === 1) {
  const [owner] = owners;
  if (owner.archived) fail(`"${profileName}" belongs to the ARCHIVED client "${owner.slug}" — restore it in the owner console first if this deploy is intended.`);
  if (owner.record.deployLock === true) {
    fail(`deploys are LOCKED for "${profileName}" (clients/${owner.slug}.json → deployLock: true).\nUntick "Lock deploys" in the owner console (Status → Safety) and Save if this deploy is intended.`);
  }
  // Per-client lock (scripts/go-live/lock.mjs): a go-live/preview/redeploy already
  // running for this client — from the CLI, the console or a rollout — must block
  // a second one from anywhere. A run that spawned THIS deploy already holds the
  // lock itself (GO_LIVE_LOCK_HELD) and must not try to re-acquire it.
  if (process.env.GO_LIVE_LOCK_HELD !== owner.slug) {
    const locksDir = path.join(clientsDir, LOCKS_DIR);
    const acquired = acquireClientLock({ existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync }, locksDir, owner.slug, { pid: process.pid, action: "redeploy", owner: "deploy" }, path.join);
    if (!acquired.ok) fail(lockMessage(acquired.held));
    lockedSlug = owner.slug;
  }
}

// ── resolve target ───────────────────────────────────────────────────────────
const appDir = path.join(ROOT, profile.app ?? "apps/cafe");
if (!existsSync(appDir)) fail(`app directory not found: ${appDir}`);

const env = { ...process.env };
if (profile.orgId) env.VERCEL_ORG_ID = profile.orgId;
if (profile.projectId) env.VERCEL_PROJECT_ID = profile.projectId;

// Refuse to guess: with no explicit project target AND no local link, `--yes`
// would silently CREATE a brand-new Vercel project — never what we want.
// The link is looked for at the REPO ROOT because that is where we deploy from
// (see the cwd note below); a legacy per-app link still counts.
const hasLink =
  existsSync(path.join(ROOT, ".vercel", "project.json")) ||
  existsSync(path.join(appDir, ".vercel", "project.json"));
if (!env.VERCEL_PROJECT_ID && !hasLink) {
  fail(
    `no deploy target: profile "${profileName}" has no orgId/projectId and neither the repo root nor ${profile.app ?? "apps/cafe"} has a .vercel link.\n` +
      `Fix: put the project's orgId + projectId into deploy.profiles.json (see deploy.profiles.example.json).`,
  );
}

const token = profile.token ?? (profile.tokenEnv ? process.env[profile.tokenEnv] : undefined);
if (profile.tokenEnv && !token && !profile.token) {
  console.warn(`deploy: env ${profile.tokenEnv} is not set — falling back to the logged-in Vercel CLI session`);
}

// ── deploy (and nothing else) ────────────────────────────────────────────────
const vercelArgs = ["vercel", "deploy", "--yes"];
if (!preview) vercelArgs.push("--prod");
if (profile.scope) vercelArgs.push("--scope", profile.scope);
if (token) vercelArgs.push("--token", token);

const appRel = path.relative(ROOT, appDir).split(path.sep).join("/");

console.log(
  `deploy: ${preview ? "PREVIEW" : "PRODUCTION"} · profile "${profileName}" · ${appRel}` +
    (env.VERCEL_PROJECT_ID ? ` · project ${env.VERCEL_PROJECT_ID}` : " · (local .vercel link)"),
);
console.log(
  `deploy: uploading from the repo ROOT — the Vercel project's Root Directory must be set to "${appRel}".`,
);

// ── why cwd is the REPO ROOT, not the app directory ──────────────────────────
// This is an npm-workspaces monorepo and apps/cafe depends on `@pos/shared: "*"`,
// which exists ONLY as a workspace sibling (raw TS, no registry package, no build
// step). Deploying with cwd=apps/cafe uploads that folder alone, so the install
// resolves @pos/shared against the public registry and the build fails — proven
// on 2026-08-12 by a git-integration Preview build of the monorepo failing on a
// project whose Root Directory still pointed at the repo root.
// Deploying from the root uploads the whole workspace (root lockfile included);
// the PROJECT's "Root Directory" setting is what selects the app to build, and
// next.config's transpilePackages compiles the shared TS source.
let res;
try {
  res = spawnSync("npx", vercelArgs, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} finally {
  if (lockedSlug) releaseClientLock({ existsSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync }, path.join(clientsDir, LOCKS_DIR), lockedSlug, process.pid, path.join);
}
process.exit(res.status ?? 1);
