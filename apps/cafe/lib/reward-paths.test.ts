import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/source-pin-utils";

// CB-7 S1 source pins. (1) The reward engine's randomness is node:crypto only. (2) lib/reward-levels-config.ts
// reads process.env and lib/reward-rng.ts imports node:crypto, and this repo has no `server-only` package, so
// both are registered as SERVER_ONLY in client-graph-guard.test.ts (the transitive client import-graph walk) —
// a client gets server-computed booleans instead (plan section 2.11, B11). Pin (2) keeps that registration.
// Needles are built by concatenation so this file never contains the banned literal it scans for.

const ROOT = process.cwd();
const BANNED_RNG = "Math" + ".random";

const rewardLibFiles = readdirSync(path.join(ROOT, "lib"))
  .filter((f) => /^reward-.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => path.join(ROOT, "lib", f));
const rewardFiles = [...rewardLibFiles, path.join(ROOT, "models", "customer-reward-card.ts")];

test("SOURCE PIN: no reward-* lib file nor the card model uses the non-secure generator (raw bytes, comments included)", () => {
  assert.ok(rewardLibFiles.length >= 3, `landmark: the glob found reward-rng, reward-levels-config and this suite's siblings (${rewardLibFiles.length})`);
  assert.ok(rewardLibFiles.some((f) => f.endsWith("reward-rng.ts")), "landmark: reward-rng.ts is among them");
  for (const file of rewardFiles) {
    assert.equal(readFileSync(file, "utf8").includes(BANNED_RNG), false, `${path.relative(ROOT, file)} must not use ${BANNED_RNG}`);
  }
});

test("SOURCE PIN: reward-rng.ts draws from node:crypto (randomInt for rolls, randomBytes for ids)", () => {
  const src = stripComments(readFileSync(path.join(ROOT, "lib", "reward-rng.ts"), "utf8"));
  assert.ok(src.includes("randomInt"), "landmark: randomInt is used");
  assert.ok(src.includes("randomBytes"), "randomBytes is used for the card id");
  assert.ok(/from\s+"node:crypto"/.test(src), "imports from node:crypto");
});

test("SOURCE PIN: client-graph-guard lists reward-levels-config and reward-rng as SERVER_ONLY (no client chain may reach them)", () => {
  const guard = stripComments(readFileSync(path.join(ROOT, "lib", "client-graph-guard.test.ts"), "utf8"));
  const line = guard.split("\n").find((l) => l.includes("const SERVER_ONLY ="));
  assert.ok(line, "landmark: the guard still declares SERVER_ONLY");
  const re = new RegExp(line.slice(line.indexOf("/"), line.lastIndexOf("/") + 1).slice(1, -1));
  const cafe = (rel: string) => path.join(ROOT, rel).replace(/\\/g, "/");
  assert.ok(re.test(cafe("models/Customer.ts")), "landmark: the regex still matches a model");
  assert.ok(re.test(cafe("lib/reward-levels-config.ts")), "reward-levels-config.ts is server-only in the client graph walk");
  assert.ok(re.test(cafe("lib/reward-rng.ts")), "reward-rng.ts is server-only in the client graph walk");
  assert.equal(re.test(cafe("lib/reward-levels-label.ts")), false, "the regex is not a blanket reward-* ban");
});
