// node --test scripts/go-live/deploy-lock.test.mjs — plan-locks-force.md §2/§5:
// scripts/deploy.mjs acquires the owning client's per-client lock before
// spawning `vercel deploy` (owner "deploy", action "redeploy"), honours
// GO_LIVE_LOCK_HELD (set by run.mjs on the child it spawns for a rollout target
// so that child does not re-lock what its parent already holds), and releases
// in `finally`.
//
// deploy.mjs's PROFILES_FILE and its clientsDir are both hardcoded to
// `path.join(ROOT, ...)` (no GO_LIVE_CLIENTS_DIR env-var redirect, unlike
// go-live/index.mjs) — so a spawn test cannot point it at a temp fixture
// without either editing deploy.mjs (out of scope: owned by the core
// implementer) or mutating the REAL repo-root clients/ and
// deploy.profiles.json (forbidden — this suite must never touch the real
// clients folder or leave temp state in the repo). Per the plan's own
// fallback ("if it cannot be redirected, do source pins only and say so"):
// this file is SOURCE PINS ONLY — no spawn test. Confirmed by reading the
// landed source below (deploy.mjs already has the lock wired in as of this
// test run).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_SRC = readFileSync(path.join(HERE, "..", "deploy.mjs"), "utf8");

test("PIN deploy.mjs: imports the per-client lock helpers from go-live/lock.mjs (positive landmark: the file's other lock.mjs-shaped needle) — plan §2", () => {
  // Built from parts so this pin's own source can't accidentally satisfy itself
  // if this test file were ever scanned by the same kind of grep.
  const importNeedle = "from " + '"./go-live/lock.mjs"';
  assert.ok(DEPLOY_SRC.includes(importNeedle), 'deploy.mjs must import from "./go-live/lock.mjs" (acquireClientLock/releaseClientLock/lockMessage/LOCKS_DIR) — not landed yet if this fails');
});

test("PIN deploy.mjs: acquires the owning record's lock (owner \"deploy\", action \"redeploy\") only when exactly one owner exists — plan §2", () => {
  assert.match(DEPLOY_SRC, /acquireClientLock/, "acquireClientLock must be called somewhere in deploy.mjs");
  assert.match(DEPLOY_SRC, /["']deploy["']/, 'the owner tag "deploy" must appear (acquireClientLock({ owner: "deploy", ... }))');
  assert.match(DEPLOY_SRC, /["']redeploy["']/, 'the action tag "redeploy" must appear (acquireClientLock({ action: "redeploy", ... }))');
  // Positive landmark: the existing single-owner gate this hooks into really exists.
  assert.match(DEPLOY_SRC, /owners\.length === 1/, "positive landmark: the existing 'exactly one owner' branch this lock call must sit inside");
});

test("PIN deploy.mjs: honours GO_LIVE_LOCK_HELD — a child spawned by run.mjs/rollout for THIS slug must skip acquiring its own lock", () => {
  assert.match(DEPLOY_SRC, /GO_LIVE_LOCK_HELD/, "deploy.mjs must read process.env.GO_LIVE_LOCK_HELD somewhere");
});

test("PIN deploy.mjs: a held lock prints lockMessage() and exits 1 BEFORE any vercel spawn — the lock check happens before the deploy, never after", () => {
  assert.match(DEPLOY_SRC, /lockMessage/, "lockMessage must be used to report a held lock");
  // Positive landmark + order: the lock-acquire code must appear textually before
  // the vercel spawnSync call, so a held lock can never let a deploy slip through.
  const lockIdx = DEPLOY_SRC.search(/acquireClientLock/);
  const spawnIdx = DEPLOY_SRC.indexOf('spawnSync("npx", vercelArgs');
  assert.ok(spawnIdx > 0, "positive landmark: the real vercel spawnSync call this order-pin is relative to");
  assert.ok(lockIdx > 0 && lockIdx < spawnIdx, "the lock acquire/check must run BEFORE the vercel spawn, not after");
});

test("PIN deploy.mjs: releases the lock in a finally block, so a deploy that throws or exits non-zero still frees it", () => {
  assert.match(DEPLOY_SRC, /releaseClientLock/, "releaseClientLock must be called");
  assert.match(DEPLOY_SRC, /finally\s*\{[\s\S]*releaseClientLock/, "releaseClientLock must run inside a finally block");
});

test("PIN deploy.mjs: the lock directory is <clientsDir>/LOCKS_DIR (lock.mjs's own \"_locks\" constant, not a re-typed literal)", () => {
  assert.match(DEPLOY_SRC, /path\.join\(clientsDir,\s*LOCKS_DIR\)/, "the lock folder must be built from the imported LOCKS_DIR constant, not a hand-typed \"_locks\" string that could drift from lock.mjs's own folder name");
});

// COVERAGE GAP (not this file's to fix — flagging per the plan's own §2 wording
// "the lock dir is GO_LIVE_CLIENTS_DIR ?? ROOT/clients + _locks"): deploy.mjs's
// `clientsDir` is HARDCODED to `path.join(ROOT, "clients")` — it never reads
// GO_LIVE_CLIENTS_DIR. index.mjs (`CLIENTS_DIR = process.env.GO_LIVE_CLIENTS_DIR
// ?? path.join(ROOT, "clients")`) and ui-server.mjs (`clientsDir` passed in by
// its caller) DO honour the override. Today this only matters for a live-leg
// script pointing GO_LIVE_CLIENTS_DIR at a scratch folder — such a run's
// deploy.mjs would look for records/locks in the REAL clients/ folder while
// index.mjs/ui-server.mjs look in the scratch one, and the two would never see
// each other's locks. No test file may inject its own clientsDir into
// deploy.mjs (it takes none), so this can only be pinned once deploy.mjs itself
// gains the override — flagging it here rather than asserting it works.
test("deploy.mjs resolves its clients folder like index.mjs and the console: GO_LIVE_CLIENTS_DIR ?? ROOT/clients (so all three see the same locks)", () => {
  assert.match(DEPLOY_SRC, /const clientsDir = process\.env\.GO_LIVE_CLIENTS_DIR \?\? path\.join\(ROOT, "clients"\)/);
});
