import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CR2.3 §20 — structural pins on the staff-attention pulse + D9 auto-print
// claim, mirroring lib/order-request-paths.test.ts's readFileSync/
// stripComments technique. Covers ONLY what is NOT already pinned:
//   - order-request-paths.test.ts: badge/layout/pos/requests reachability,
//     use-pos-pulse.ts's single refetchInterval + refetchIntervalInBackground.
//   - print-paths.test.ts: queueKotRound's optional `round` param.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Forbid/require CODE shapes, so this strips comments before matching — a
// comment explaining a rule (e.g. "no pruneOrderRequests here") would
// otherwise trip the very pin meant to enforce it (measured-baseline lesson).

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (CODE_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

function relPath(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

// Brace-balanced scan (mirrors print-paths.test.ts's matchingBraceEnd) — a
// plain indexOf("}...") stops at the FIRST closing brace, which can belong to
// a nested literal and truncate the captured block before later code.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

const PULSE_ROUTE = "apps/cafe/app/api/order-requests/pulse/route.ts";
const POS_PULSE_LIB = "apps/cafe/lib/pos-pulse.ts";
const ORDER_REQUEST_MODEL = "apps/cafe/models/OrderRequest.ts";
const ACCEPT_CORE = "apps/cafe/lib/order-request-accept-core.ts";
const ALERT_SOUND = "apps/cafe/lib/alert-sound.ts";
const REQUEST_ALERT_BAR = "apps/cafe/components/orders/RequestAlertBar.tsx";
const SELF_ORDER_ALERT_SHARED = "packages/shared/src/self-order-alert.ts";

// ── a. Pulse route: auth before read, never a write ────────────────────────

test("PIN: GET /api/order-requests/pulse checks auth BEFORE calling readPosPulse, and neither the route nor lib/pos-pulse.ts ever calls pruneOrderRequests — a 20s hot path must never write", () => {
  const routeSrc = stripComments(readSrc(PULSE_ROUTE));
  const authIdx = mustIndexOf(routeSrc, "requireAuth()", "the auth check");
  const readIdx = mustIndexOf(routeSrc, "readPosPulse()", "the readPosPulse call");
  assert.ok(authIdx < readIdx, "requireAuth() must be checked before readPosPulse() runs");

  // Mutation this catches: a pruneOrderRequests call creeping into the
  // hottest poll in the app — the tray GET and the public POST already
  // prune; this route (and its own lib) must stay read-only.
  assert.ok(!/pruneOrderRequests\(/.test(routeSrc), "the pulse route must never call pruneOrderRequests");
  const libSrc = stripComments(readSrc(POS_PULSE_LIB));
  assert.ok(!/pruneOrderRequests\(/.test(libSrc), "lib/pos-pulse.ts must never call pruneOrderRequests");
});

// ── b. Both pulse queries are bounded by the shared constants ──────────────

test("PIN: readPosPulse's two queries both carry .limit( and .lean(), and the limits are the IMPORTED shared constants (PULSE_OPEN_SCAN_LIMIT / PULSE_SELF_ORDER_LIMIT), never a hand-rolled literal", () => {
  const src = stripComments(readSrc(POS_PULSE_LIB));
  assert.match(
    src,
    /import \{\s*PULSE_OPEN_SCAN_LIMIT,\s*PULSE_SELF_ORDER_LIMIT,\s*PULSE_SELF_ORDER_WINDOW_MS,/,
    "pos-pulse.ts must import the pulse constants from @pos/shared/self-order-alert",
  );

  const openStart = mustIndexOf(src, "const openRows = await OrderRequest.find(", "query A's own declaration");
  const selfStart = mustIndexOf(src, "const selfRows = await OrderRequest.find(", "query B's own declaration");
  assert.ok(openStart < selfStart, "query A (openRows) must be declared before query B (selfRows)");
  const queryABody = src.slice(openStart, selfStart);
  const queryBBody = src.slice(selfStart);

  assert.match(queryABody, /\.limit\(PULSE_OPEN_SCAN_LIMIT\)/, "query A must limit() on PULSE_OPEN_SCAN_LIMIT");
  assert.match(queryABody, /\.lean\(\)/, "query A must .lean()");
  assert.match(queryBBody, /\.limit\(PULSE_SELF_ORDER_LIMIT\)/, "query B must limit() on PULSE_SELF_ORDER_LIMIT");
  assert.match(queryBBody, /\.lean\(\)/, "query B must .lean()");
  // Mutation this catches: swapping a constant for a bare number, decoupling
  // the route's cap from the shared contract the client also reasons about.
  assert.ok(!/\.limit\(\d/.test(src), "no query in readPosPulse may pass a raw numeric literal to .limit(");
});

// ── c. claimKotPrint: full CAS, checked result, order-read-before-CAS ──────

test('PIN: claimKotPrint reads the Order BEFORE the CAS, the CAS carries all four terms (_id, status:"accepted", actor:SELF_ORDER_RECEIVER, kotPrintedAt:{$exists:false}), and its result is CHECKED (a null claim returns claimed:false, never assumed to have landed)', () => {
  const src = stripComments(readSrc(POS_PULSE_LIB));
  const fnStart = mustIndexOf(src, "export async function claimKotPrint", "claimKotPrint");
  const fnBody = src.slice(fnStart);

  const orderReadIdx = mustIndexOf(fnBody, "await Order.findOne(", "the pre-CAS Order read");
  const casIdx = mustIndexOf(fnBody, "await OrderRequest.findOneAndUpdate(", "the claim CAS");
  assert.ok(orderReadIdx < casIdx, "the Order must be read strictly before the claim CAS runs");

  const casEnd = fnBody.indexOf(");", casIdx);
  const casBlock = fnBody.slice(casIdx, casEnd);
  // Mutation this catches (per-term): dropping ANY term reopens the race the CAS closes.
  assert.match(casBlock, /_id:\s*id/, "the CAS must match on _id: id");
  assert.match(casBlock, /status:\s*"accepted"/, 'the CAS must guard status: "accepted"');
  assert.match(casBlock, /actor:\s*SELF_ORDER_RECEIVER/, "the CAS must guard actor: SELF_ORDER_RECEIVER");
  assert.match(casBlock, /kotPrintedAt:\s*\{\s*\$exists:\s*false\s*\}/, "the CAS must guard kotPrintedAt: { $exists: false }");

  // Mutation this catches: treating a null findOneAndUpdate result as success.
  assert.match(fnBody, /if \(!claimed\) return \{ claimed: false, reason: "raced" \};/, "a lost CAS race must be CHECKED, never assumed to have succeeded");
});

// ── d. No writer ever unsets the D9 markers ─────────────────────────────────

test("PIN: no file under apps/cafe's app/lib/hooks trees ever $unsets kotPrintedAt or acceptedKotRound — the D9 marker is set once and read once; unsetting either on a later write would reopen the claim to a second racer", () => {
  const dirs = ["apps/cafe/app", "apps/cafe/lib", "apps/cafe/hooks"];
  const files: string[] = [];
  for (const dir of dirs) walk(path.join(REPO_ROOT, dir), files);
  assert.ok(files.length > 0, "the app/lib/hooks trees must contain files to check");

  const BANNED = ["kotPrintedAt", "acceptedKotRound"];
  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    for (const field of BANNED) {
      // Dynamic-assignment form (this repo's PATCH-route idiom: unset.field = "").
      assert.ok(
        !new RegExp(`unset(?:\\.${field}\\b|\\[["']${field}["']\\])`).test(src),
        `${rel} must never assign unset.${field} (or unset["${field}"]) — that is how the D9 marker would get cleared on a later write`,
      );
    }
    // Literal-object form (`$unset: { field: ... }`) — $unset values here are
    // always flat ("" or 1), so a non-nested brace match is safe.
    const unsetLiteralRe = /\$unset:\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = unsetLiteralRe.exec(src))) {
      for (const field of BANNED) {
        assert.ok(
          !new RegExp(`\\b${field}\\b`).test(m[1]),
          `${rel} declares a literal $unset block naming ${field} — the D9 marker must never be unset`,
        );
      }
    }
  }
});

// ── e. Writer allow-list fence (reciprocal-CAS lesson) ──────────────────────

test("PIN: the exact set of apps/cafe production files that write OrderRequest (.create/.updateOne/.findOneAndUpdate/.deleteMany) matches this list — a NEW writer must be added here deliberately, with the kotPrintedAt/acceptedKotRound marker semantics re-audited (CR1.3's reciprocal-CAS lesson: hardening one writer's CAS while a new writer skips the same guard reopens the exact race the guard exists to close)", () => {
  const EXPECTED_WRITERS = [
    "apps/cafe/app/api/order-requests/[id]/reject/route.ts",
    "apps/cafe/app/api/public/order-request/[shortCode]/route.ts",
    "apps/cafe/app/api/public/order-request/[shortCode]/cancel/route.ts",
    "apps/cafe/app/api/public/order-request/route.ts",
    "apps/cafe/lib/order-request-accept-core.ts",
    "apps/cafe/lib/order-request-accept.ts",
    "apps/cafe/lib/order-request-intake.ts",
    "apps/cafe/lib/pos-pulse.ts",
  ].sort();

  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe"), files);
  const WRITE_PATTERN = /OrderRequest\.(create|updateOne|findOneAndUpdate|deleteMany)\(/;

  const actualWriters = files
    .filter((fileAbs) => {
      const rel = relPath(fileAbs);
      // Test files and the live-leg ops script legitimately mirror every one
      // of these call shapes to stage fixtures — not a PRODUCTION write path.
      if (rel.endsWith(".test.ts")) return false;
      if (rel.startsWith("apps/cafe/scripts/")) return false;
      const src = stripComments(readFileSync(fileAbs, "utf8"));
      return WRITE_PATTERN.test(src);
    })
    .map(relPath)
    .sort();

  assert.deepEqual(
    actualWriters,
    EXPECTED_WRITERS,
    `the real OrderRequest-writer set (${actualWriters.join(", ")}) drifted from the pinned allow-list (${EXPECTED_WRITERS.join(", ")}) — if this is a deliberate new writer, re-audit it against every kotPrintedAt/acceptedKotRound guard before updating this list`,
  );
});

// ── f. No schema default on either D9 marker ────────────────────────────────

test("PIN: models/OrderRequest.ts declares acceptedKotRound and kotPrintedAt with NO `default:` — omit-empty, mirroring the resolution block's own discipline (a still-pending or not-yet-printed request must carry neither key at all)", () => {
  const src = readSrc(ORDER_REQUEST_MODEL); // full source — these are schema field lines, not banned prose
  const acceptedKotRoundLine = mustIndexOf(src, "acceptedKotRound: { type: Number },", "the acceptedKotRound field decl");
  const kotPrintedAtLine = mustIndexOf(src, "kotPrintedAt: { type: Date },", "the kotPrintedAt field decl");
  const acceptedKotRoundDecl = src.slice(acceptedKotRoundLine, src.indexOf("\n", acceptedKotRoundLine));
  const kotPrintedAtDecl = src.slice(kotPrintedAtLine, src.indexOf("\n", kotPrintedAtLine));
  assert.ok(!/default/.test(acceptedKotRoundDecl), "acceptedKotRound must declare no default");
  assert.ok(!/default/.test(kotPrintedAtDecl), "kotPrintedAt must declare no default");
});

// ── g. finalizeAccept's stamp is guarded by !replayed + $exists:false ──────

test("PIN: finalizeAccept's acceptedKotRound updateOne appears ONLY inside an `if (!replayed)` guard, and its own filter carries acceptedKotRound: { $exists: false } — a replayed accept must never re-stamp a round several KOT rounds ahead of the one it actually caused", () => {
  const src = stripComments(readSrc(ACCEPT_CORE));
  const guardIdx = mustIndexOf(src, "if (!replayed) {", "the !replayed guard");
  const openBraceIdx = src.indexOf("{", guardIdx);
  const closeBraceIdx = matchingBraceEnd(src, openBraceIdx);
  const guardBody = src.slice(openBraceIdx, closeBraceIdx + 1);

  assert.match(guardBody, /OrderRequest\.updateOne\(/, "the !replayed guard must contain the acceptedKotRound updateOne");
  assert.match(guardBody, /acceptedKotRound:\s*\{\s*\$exists:\s*false\s*\}/, "the filter must guard acceptedKotRound: { $exists: false } — idempotent under a retried finalize");
  assert.match(guardBody, /\$set:\s*\{\s*acceptedKotRound:\s*order\.kotRounds\s*\}/, "the stamp must set acceptedKotRound to order.kotRounds AT THIS MOMENT — never re-derived later");

  // Mutation this catches: a second stamp OUTSIDE this guard, letting a
  // replay re-stamp a round the replay itself never caused.
  const outsideGuard = src.slice(0, guardIdx) + src.slice(closeBraceIdx + 1);
  assert.ok(!/acceptedKotRound:\s*order\.kotRounds/.test(outsideGuard), "no acceptedKotRound stamp may exist outside the !replayed guard");
});

// ── h. alert-sound.ts: gesture-gated resume, no ambient Notification ───────

test("PIN: alert-sound.ts calls resume() ONLY inside unlockAlertSound, constructs the AudioContext ONLY inside that same function (never at module scope), and no file under apps/cafe ever calls `new Notification(`", () => {
  const src = stripComments(readSrc(ALERT_SOUND));
  const fnStart = mustIndexOf(src, "export function unlockAlertSound", "unlockAlertSound");
  const fnOpenBrace = src.indexOf("{", fnStart);
  const fnCloseBrace = matchingBraceEnd(src, fnOpenBrace);
  const fnBody = src.slice(fnOpenBrace, fnCloseBrace + 1);
  const outsideFn = src.slice(0, fnOpenBrace) + src.slice(fnCloseBrace + 1);

  // Mutation this catches: a `.resume()` added to some OTHER function — Chrome
  // only honors resume() called synchronously inside a real gesture handler.
  assert.match(fnBody, /\.resume\(\)/, "unlockAlertSound must call .resume()");
  assert.ok(!/\.resume\(\)/.test(outsideFn), "no function other than unlockAlertSound may call .resume()");

  assert.match(fnBody, /new AudioContext\(\)/, "unlockAlertSound must construct the AudioContext");
  assert.ok(!/new AudioContext\(\)/.test(outsideFn), "the AudioContext must never be constructed outside unlockAlertSound (never eagerly, at module scope, on import)");

  const files: string[] = [];
  walk(path.join(REPO_ROOT, "apps/cafe"), files);
  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    if (rel.endsWith(".test.ts")) continue;
    const fileSrc = stripComments(readFileSync(fileAbs, "utf8"));
    // Mutation this catches: a second, ungoverned alert channel (the browser
    // Notification API, which needs its own permission prompt) creeping in.
    assert.ok(!/new Notification\(/.test(fileSrc), `${rel} must never call new Notification(`);
  }
});

// ── i. RequestAlertBar renders the shared limitation constant, not a copy ─

test("PIN: RequestAlertBar imports SELF_ORDER_ALERT_LIMITATION from @pos/shared/self-order-alert and renders it — the exact wording lives in exactly ONE place, never duplicated as a hardcoded string", () => {
  const src = stripComments(readSrc(REQUEST_ALERT_BAR));
  assert.match(src, /import \{ SELF_ORDER_ALERT_LIMITATION \} from "@pos\/shared\/self-order-alert";/, "RequestAlertBar must import SELF_ORDER_ALERT_LIMITATION");
  assert.match(src, /\{SELF_ORDER_ALERT_LIMITATION\}/, "RequestAlertBar must render {SELF_ORDER_ALERT_LIMITATION}");

  // Mutation this catches: inlining the wording as a literal string too — a
  // future edit to the shared constant would then silently stop reaching here.
  const sharedSrc = readSrc(SELF_ORDER_ALERT_SHARED);
  const limitationMatch = sharedSrc.match(/SELF_ORDER_ALERT_LIMITATION =\s*\n?\s*"([^"]+)"/);
  assert.ok(limitationMatch, "could not read SELF_ORDER_ALERT_LIMITATION's own string literal from source");
  assert.ok(!src.includes(limitationMatch![1]), "RequestAlertBar must not carry the limitation text as its own hardcoded string — only via the imported constant");
});
