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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const profile = profiles[profileName] ?? (profileName === "default" ? {} : null);
if (!profile) {
  fail(`profile "${profileName}" not found in deploy.profiles.json (try --list)`);
}

// ── resolve target ───────────────────────────────────────────────────────────
const appDir = path.join(ROOT, profile.app ?? "apps/cafe");
if (!existsSync(appDir)) fail(`app directory not found: ${appDir}`);

const env = { ...process.env };
if (profile.orgId) env.VERCEL_ORG_ID = profile.orgId;
if (profile.projectId) env.VERCEL_PROJECT_ID = profile.projectId;

// Refuse to guess: with no explicit project target AND no local link, `--yes`
// would silently CREATE a brand-new Vercel project — never what we want.
const hasLink = existsSync(path.join(appDir, ".vercel", "project.json"));
if (!env.VERCEL_PROJECT_ID && !hasLink) {
  fail(
    `no deploy target: profile "${profileName}" has no orgId/projectId and ${profile.app ?? "apps/cafe"} has no .vercel link.\n` +
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

console.log(
  `deploy: ${preview ? "PREVIEW" : "PRODUCTION"} · profile "${profileName}" · ${path.relative(ROOT, appDir)}` +
    (env.VERCEL_PROJECT_ID ? ` · project ${env.VERCEL_PROJECT_ID}` : " · (local .vercel link)"),
);

const res = spawnSync("npx", vercelArgs, {
  cwd: appDir,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
