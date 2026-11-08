// The build stamp: one id per build, the same in the server and the client bundle, reported by the pulse and
// compared by the page. Source pins (after stripComments, so a comment never satisfies one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

test("next.config.ts computes ONE stamp, memoised in the process environment for the build workers", () => {
  const src = code("apps/cafe/next.config.ts");
  assert.match(src, /const POS_BUILD\s*=\s*\(process\.env\.POS_BUILD_STAMP\s*\|\|=/, "POS_BUILD is stored back into process.env.POS_BUILD_STAMP");
  assert.match(src, /process\.env\.VERCEL_DEPLOYMENT_ID\s*\|\|\s*process\.env\.VERCEL_GIT_COMMIT_SHA\s*\|\|\s*`local-\$\{Date\.now\(\)\.toString\(36\)\}`/, "deployment id, then commit sha, then a local stamp");
  assert.equal(src.split("Date.now()").length - 1, 1, "the clock is read in exactly one place");
});

test("next.config.ts bakes the same value into env and the build id", () => {
  const src = code("apps/cafe/next.config.ts");
  assert.match(src, /env:\s*\{\s*NEXT_PUBLIC_POS_BUILD:\s*POS_BUILD\s*\}/, "the client bundle gets POS_BUILD");
  assert.match(src, /generateBuildId:\s*async\s*\(\)\s*=>\s*POS_BUILD/, "Next's build id is POS_BUILD");
});

test("lib/build-stamp.ts reads the inlined value", () => {
  assert.match(code("apps/cafe/lib/build-stamp.ts"), /process\.env\.NEXT_PUBLIC_POS_BUILD/, "POS_BUILD comes from NEXT_PUBLIC_POS_BUILD");
});

test("the pulse JSON carries build, and the hook feeds the store", () => {
  const route = code("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(route, /build:\s*POS_BUILD/, "the pulse answer carries build: POS_BUILD");
  assert.match(route, /import \{ POS_BUILD \} from "@\/lib\/build-stamp"/, "the route imports the stamp");
  const hook = code("apps/cafe/hooks/use-pos-pulse.ts");
  // Moved on purpose (post-verifier V1): each real answer is observed with its time (lib/suspect-prefetch.test.ts pins
  // the cache-event filter around it).
  assert.match(
    hook,
    /updatePending\.observe\(\(event\.query\.state\.data as PosPulseData \| undefined\)\?\.build,\s*POS_BUILD,\s*pulseAnsweredAt\)/,
    "the hook compares the pulse's build with the page's",
  );
  assert.equal(hook.split("updatePending.observe(").length - 1, 1, "exactly one observation");
});

test("navigate.ts's real default reads the store", () => {
  assert.match(code("apps/cafe/lib/navigate.ts"), /updatePending:\s*\(\)\s*=>\s*updatePending\.isPending\(\)/, "realDeps.updatePending reads updatePending.isPending()");
});
