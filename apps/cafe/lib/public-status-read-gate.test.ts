import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  PUBLIC_ORDER_RATE_WINDOW_MS,
  PUBLIC_STATUS_REFRESH_COOLDOWN_MS,
  PUBLIC_STATUS_READ_MAX,
} from "@pos/shared/public";

// S4 — server-enforced refresh cooldown on GET /api/public/order-request/
// [shortCode], plus the quoted-money fields (subtotal/charge/chargeLabel)
// added to the status contract. DB-free, source-pin style, same
// readFileSync/stripComments idiom as lib/order-request-paths.test.ts and
// lib/public-rate-limit.test.ts (read there first).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const STATUS_ROUTE = "apps/cafe/app/api/public/order-request/[shortCode]/route.ts";
const SHARED_PUBLIC = "packages/shared/src/public.ts";
// The gate's MECHANISM (bucket shape, the 429 + Retry-After, the header value)
// lives in the sibling lib, not the route: that route sits at this repo's
// ~300-line budget, and lib/order-request-edit.ts is its established overflow
// home (see the route's own "Sibling-lib re-exports" import comment). These
// pins therefore read BOTH files — re-pointed when the helpers moved there,
// never loosened, so the mechanism stays pinned wherever it lives.
const EDIT_LIB = "apps/cafe/lib/order-request-edit.ts";

// Every ordering/positive-landmark pin composes this so a missing needle
// fails with a clear message instead of a confusing "-1 < -1" pass.
function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

// The GET handler's own body — everything up to the PATCH export. Sliced
// this way (rather than trusting a hand-picked line range) so the pins below
// stay correct if the file is edited above/below this section later.
function getBody(): string {
  const src = stripComments(readSrc(STATUS_ROUTE));
  const patchIdx = mustIndexOf(src, "export async function PATCH", "the PATCH export");
  return src.slice(0, patchIdx);
}

// statusReadGate's own body in the sibling lib — sliced between its signature
// and the next export so these pins cannot drift onto neighbouring helpers.
function gateBody(): string {
  const src = stripComments(readSrc(EDIT_LIB));
  const start = mustIndexOf(src, "export async function statusReadGate", "the statusReadGate export");
  const after = src.indexOf("export const REFRESH_AFTER_HEADER", start);
  assert.ok(after > start, "statusReadGate must be followed by the REFRESH_AFTER_HEADER export");
  return src.slice(start, after);
}

// ── 1. Derivation — the three constants cannot silently drift ──────────────

test("PIN: PUBLIC_ORDER_RATE_WINDOW_MS / PUBLIC_STATUS_REFRESH_COOLDOWN_MS === PUBLIC_STATUS_READ_MAX", () => {
  // Mutation this catches: hand-editing PUBLIC_STATUS_READ_MAX (or the
  // cooldown/window it's derived from) without keeping the 600_000/30_000=20
  // relationship intact — the cooldown's own "20 reads per window = 30s
  // average" comment would then be a lie.
  assert.equal(PUBLIC_ORDER_RATE_WINDOW_MS / PUBLIC_STATUS_REFRESH_COOLDOWN_MS, PUBLIC_STATUS_READ_MAX);
});

// ── 2/6. GET calls hitRateLimit, and isPublicCode runs BEFORE it ────────────

test("PIN: GET's own body runs the read gate, and isPublicCode(shortCode) is checked strictly BEFORE it — a malformed code must never burn a window slot", () => {
  const body = getBody();
  const codeIdx = mustIndexOf(body, "isPublicCode(shortCode)", "the isPublicCode shape check");
  const gateIdx = mustIndexOf(body, "statusReadGate(shortCode", "the statusReadGate call");
  assert.ok(codeIdx < gateIdx, "isPublicCode must be checked before the read gate is ever entered");
  // The gate is the ONLY thing metering this read, and it must actually meter:
  // the helper it delegates to has to spend a window slot, or the cooldown is
  // decorative (project lesson: a UI disable is not a fence).
  mustIndexOf(gateBody(), "hitRateLimit(", "the hitRateLimit call inside statusReadGate");
});

// ── 3. Bucket is keyed PER SHORTCODE, never per-source/IP ───────────────────

test("PIN: the read bucket is built from PUBLIC_STATUS_READ_BUCKET_PREFIX and includes shortCode (per-code), and is never keyed on a source/IP hash", () => {
  const libSrc = stripComments(readSrc(EDIT_LIB));
  const bucketStart = mustIndexOf(
    libSrc,
    "export function statusReadBucket",
    "the statusReadBucket export",
  );
  const bucketBody = libSrc.slice(bucketStart, bucketStart + 300);
  assert.match(
    bucketBody,
    /return `\$\{PUBLIC_STATUS_READ_BUCKET_PREFIX\}:\$\{shortCode\}`;/,
    "the bucket literal must be `${PUBLIC_STATUS_READ_BUCKET_PREFIX}:${shortCode}`",
  );
  // Negatives, paired with the positive landmark above (vision-guard). A
  // per-source/IP key would break PublicMyOrdersTab's 8-concurrent-code
  // fan-out AND PublicStatusTimeline's 4 sibling-code reads — those surfaces
  // read many DISTINCT codes at once, which distinct buckets tolerate and a
  // shared bucket would starve.
  const body = getBody();
  for (const [needle, label] of [
    ["x-forwarded-for", "x-forwarded-for"],
    ["hashSource", "hashSource"],
  ] as const) {
    assert.ok(!body.includes(needle), `the status GET must never key its read bucket on ${label}`);
    assert.ok(
      !bucketBody.includes(needle),
      `statusReadBucket must never key on ${label}`,
    );
  }
  assert.ok(!/req\.ip\b/.test(body), "GET must never read req.ip");
});

// ── 4. The 429 branch sets Retry-After ──────────────────────────────────────

test("PIN: the read-gate 429 branch sets a Retry-After header from decision.retryAfterSec", () => {
  const gate = gateBody();
  const allowedIdx = mustIndexOf(gate, "if (decision.allowed) return null", "the allow branch");
  const retryIdx = gate.indexOf("Retry-After", allowedIdx);
  assert.ok(retryIdx > allowedIdx, "the 429 branch must set a Retry-After header");
  assert.match(
    gate,
    /res\.headers\.set\("Retry-After", String\(decision\.retryAfterSec\)\)/,
    "Retry-After must be derived from decision.retryAfterSec",
  );
  // The gate must FAIL CLOSED on a spent window — it returns a 429 response
  // rather than null (which would let the read through unmetered).
  assert.match(gate, /failure\(RATE_LIMITED_MESSAGE, 429\)/, "a spent window must return a 429");
  // And the route must actually honour that return, not ignore it.
  const routeBody = getBody();
  const callIdx = mustIndexOf(routeBody, "const limited = await statusReadGate(", "the gate call");
  const dbIdx = mustIndexOf(routeBody, "OrderRequest.findOne", "the DB read");
  assert.ok(callIdx < dbIdx, "the read gate must run BEFORE the DB read, not after it");
  assert.match(
    routeBody.slice(callIdx, dbIdx),
    /if \(limited\) return limited;/,
    "GET must return the gate's 429 immediately rather than proceeding to the DB read",
  );
});

// ── 5. A successful response sets X-Refresh-After, derived from the constant ─

test("PIN: a successful GET sets X-Refresh-After, and its value derives from PUBLIC_STATUS_REFRESH_COOLDOWN_MS rather than a hardcoded number", () => {
  const libSrc = stripComments(readSrc(EDIT_LIB));
  // The header NAME is a named constant, and the VALUE is derived from the
  // shared cooldown — pinned where they are produced.
  assert.match(
    libSrc,
    /export const REFRESH_AFTER_HEADER = "X-Refresh-After";/,
    "REFRESH_AFTER_HEADER must be the literal X-Refresh-After header name",
  );
  const fnIdx = mustIndexOf(libSrc, "export function refreshAfterSeconds", "refreshAfterSeconds");
  const fnBody = libSrc.slice(fnIdx, fnIdx + 220);
  // Mutation this catches: hardcoding "30" (or any literal) instead of
  // deriving it from the shared constant — the header would then silently
  // drift from PUBLIC_STATUS_REFRESH_COOLDOWN_MS if the cooldown ever changes.
  assert.match(
    fnBody,
    /PUBLIC_STATUS_REFRESH_COOLDOWN_MS \/ 1000/,
    "refreshAfterSeconds must derive its value from PUBLIC_STATUS_REFRESH_COOLDOWN_MS",
  );
  assert.ok(
    !/return String\(\s*\d+\s*\)/.test(fnBody),
    "refreshAfterSeconds must not return a bare hardcoded number",
  );
  // ...and the GET must actually SET it on its success response, or the
  // constant is dead code and the diner's countdown never learns the cooldown.
  const body = getBody();
  const headerIdx = mustIndexOf(
    body,
    "res.headers.set(REFRESH_AFTER_HEADER, refreshAfterSeconds())",
    "the X-Refresh-After header set on the GET success path",
  );
  const successIdx = mustIndexOf(body, "noStore(success(data))", "the success response");
  assert.ok(headerIdx > successIdx, "the header must be set on the success response");
});

// ── 7. Contract: subtotal/charge on the type, and no diner-identifying field ─

test("PIN: PublicOrderRequestStatusData declares subtotal and charge, and the GET route source never mentions `mobile` or `name` while it DOES build `subtotal`", () => {
  const sharedSrc = stripComments(readSrc(SHARED_PUBLIC));
  const ifaceStart = mustIndexOf(
    sharedSrc,
    "export interface PublicOrderRequestStatusData {",
    "the PublicOrderRequestStatusData interface",
  );
  const ifaceEnd = sharedSrc.indexOf("}", ifaceStart);
  const ifaceBody = sharedSrc.slice(ifaceStart, ifaceEnd);
  assert.match(ifaceBody, /^\s*subtotal:\s*number;/m, "the interface must declare subtotal: number");
  assert.match(ifaceBody, /^\s*charge:\s*number;/m, "the interface must declare charge: number");

  const body = getBody();
  // Positive landmark FIRST (vision-guard): prove the slice actually builds
  // the field before trusting the negative pins below — a slice that found
  // nothing at all would pass "never mentions mobile" vacuously otherwise.
  mustIndexOf(body, "subtotal:", "the subtotal field assignment");
  assert.ok(!/\bmobile\b/.test(body), "GET's own body must never mention `mobile`");
  assert.ok(!/\bname\b/.test(body), "GET's own body must never mention `name`");
});
