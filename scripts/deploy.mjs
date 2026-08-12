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

// The empty-profile fallback exists for a fresh clone that has a `.vercel` link
// and no profiles file at all. It must NOT apply once profiles ARE configured:
// otherwise a bare `npm run deploy` (profileName "default") silently falls back
// to whatever the local link points at — which is how a deploy meant for one
// cafe can land on another. With profiles present, the target must be explicit.
const configuredNames = Object.keys(profiles);
const profile =
  profiles[profileName] ??
  (profileName === "default" && configuredNames.length === 0 ? {} : null);
if (!profile) {
  fail(
    `profile "${profileName}" not found in deploy.profiles.json.\n` +
      `Configured: ${configuredNames.join(", ") || "(none)"}\n` +
      `Every client deploy must name its target: npm run deploy -- --profile <name>`,
  );
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
const res = spawnSync("npx", vercelArgs, {
  cwd: ROOT,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(res.status ?? 1);
