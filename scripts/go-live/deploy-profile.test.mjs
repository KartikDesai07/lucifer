// node --test scripts/go-live/deploy-profile.test.mjs — plan-resume-after-fresh.md
// §3: `scripts/deploy.mjs --profile <name>` for a name MISSING from
// deploy.profiles.json must not just say "not found" any more when the ACTIVE
// owning record (recordsOwningProfile: slug === name, or a standby
// "<slug>-<label>") proves the project already exists — the whole point of
// this fix round is that "Redeploy" must work again after an interrupted run
// left the profile un-written (see run.test.mjs's resume-after-interrupted-run
// pins for the run.mjs half of this story).
//
// Source pins only (like deploy-lock.test.mjs): deploy.mjs's clientsDir is
// hardcoded to path.join(ROOT, "clients") with no GO_LIVE_CLIENTS_DIR redirect
// (deploy-lock.test.mjs's own flagged coverage gap), so a spawn test cannot
// point it at a temp fixture without mutating the REAL repo-root clients/ —
// forbidden. This file pins the exact strings/imports/order the plan specifies
// against the raw source instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_SRC = readFileSync(path.join(HERE, "..", "deploy.mjs"), "utf8");

test("PIN deploy.mjs: imports mergeProfile from ./go-live/lib.mjs (positive landmark: the deploy-lock.test.mjs pin for the ./go-live/lock.mjs import, proving this file really does import siblings under go-live/)", () => {
  const mergeProfileImportNeedle = "mergeProfile" + " } from " + '"./go-live/lib.mjs"';
  const lockImportNeedle = "from " + '"./go-live/lock.mjs"'; // the existing, already-landed sibling import
  assert.ok(DEPLOY_SRC.includes(lockImportNeedle), "positive landmark: deploy.mjs already imports from ./go-live/lock.mjs — proves this scan reads the real file, not an empty one");
  assert.ok(
    DEPLOY_SRC.includes(mergeProfileImportNeedle) || (/import\s*\{[^}]*\bmergeProfile\b[^}]*\}\s*from\s*["']\.\/go-live\/lib\.mjs["']/.test(DEPLOY_SRC)),
    'deploy.mjs must import mergeProfile from "./go-live/lib.mjs" — not landed yet if this fails (plan §3: the rebuilt profile is built with the SAME mergeProfile shape run.mjs uses, not a hand-rolled object)',
  );
});

test("PIN deploy.mjs: contains the exact rebuild log line \"was missing — rebuilt from clients/\" (plan §3's literal wording — the owner-facing message a rebuilt profile must print)", () => {
  const needle = "was missing" + " — rebuilt from clients/";
  assert.ok(DEPLOY_SRC.includes(needle), `deploy.mjs must contain the literal string ${JSON.stringify(needle)} — not landed yet if this fails`);
});

test("PIN deploy.mjs: contains the exact unfinished-setup message \"is not fully set up yet\" (plan §3: a recorded project with NO host — env/deploy never finished — exits 1 with this wording, not the generic 'not found' message)", () => {
  const needle = "is not fully set up yet";
  assert.ok(DEPLOY_SRC.includes(needle), `deploy.mjs must contain the literal string ${JSON.stringify(needle)} — not landed yet if this fails`);
  // The unfinished message must point the owner at the exact recovery command the plan specifies
  // (built from the owning slug, not a literal placeholder — e.g. `${owner.slug}` interpolated in).
  assert.match(DEPLOY_SRC, /run:\s*node scripts\/go-live\/index\.mjs \$\{[^}]+\.slug\}/, 'the unfinished-setup message must name the recovery command "node scripts/go-live/index.mjs <slug>" (slug interpolated from the owning record)');
  assert.match(DEPLOY_SRC, /console:\s*Update on Vercel/, "the unfinished-setup message must also name the console's equivalent action, \"Update on Vercel\"");
});

test("PIN deploy.mjs: the pre-existing plain 'not found' message survives untouched — a name with NO owning record at all (the peer's v1-style profiles) keeps today's exact behaviour", () => {
  // Positive landmark: the CURRENT not-found message this pin protects really exists,
  // read from source rather than assumed from memory (a baseline claim must be measured).
  assert.match(DEPLOY_SRC, /profile "\$\{profileName\}" not found in deploy\.profiles\.json/, "the existing not-found message text must still be present verbatim — a profile with no owning record must fall through to it unchanged");
});

test("PIN deploy.mjs: the rebuild/unfinished logic sits in the SAME lookup path as the existing 'not found' fail() — i.e. it runs only once a profile lookup has already missed, using recordsOwningProfile, not a brand-new independent code path", () => {
  // Positive landmark: recordsOwningProfile already exists (the lock feature's own helper) —
  // the rebuild logic is expected to reuse it rather than re-scanning clients/ a second way.
  assert.match(DEPLOY_SRC, /function recordsOwningProfile/, "positive landmark: the existing recordsOwningProfile() helper this fix must reuse");
  const profileMissIdx = DEPLOY_SRC.search(/profiles\[profileName\]\s*\?\?/);
  const rebuiltNeedleIdx = DEPLOY_SRC.indexOf("was missing" + " — rebuilt from clients/");
  assert.ok(profileMissIdx >= 0, "positive landmark: the existing profile-lookup line this order-pin is relative to");
  assert.ok(rebuiltNeedleIdx > profileMissIdx, "the rebuild branch must be reached AFTER the initial profiles[profileName] lookup has already missed — never rebuild a profile that is already on file");
});
