import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { SESSION_MAX_AGE_SECONDS, SESSION_KEEPALIVE_SECONDS } from "@pos/shared/constants";

// CB-U1 (.claude/plan/v2/cb-u1-wake-and-session-plan.md, Slice B) — the
// 30-day rolling login: constant values, apps/cafe/app/layout.tsx's
// SessionProvider wiring, the apps/hub parity pin (hub deliberately NOT
// rolled), and an installed-dist pin over @auth/core's session.js proving
// the JWT branch actually re-signs the cookie's expiry on every session
// action while `updateAge` is a dead knob there. Same readSrc + REPO_ROOT +
// stripComments idiom as lib/print-host-paths.test.ts / lib/print-queue.test.ts.
// No mongod, no connectDB, no mongoose connection anywhere in this file.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const CAFE_LAYOUT = "apps/cafe/app/layout.tsx";
const CAFE_DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const SESSION_KEEPALIVE = "apps/cafe/components/layout/SessionKeepalive.tsx";
const CAFE_AUTH_CONFIG = "apps/cafe/auth.config.ts";
const HUB_CONSTANTS = "apps/hub/lib/constants.ts";
const AUTH_CORE_SESSION_JS = "node_modules/@auth/core/lib/actions/session.js";
const AUTH_CORE_PKG_JSON = "node_modules/@auth/core/package.json";

// ── 1. Constant values ──────────────────────────────────────────────────────

test("SESSION_MAX_AGE_SECONDS is exactly 30 days in seconds", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
});

test("SESSION_KEEPALIVE_SECONDS is exactly 30 minutes in seconds", () => {
  assert.equal(SESSION_KEEPALIVE_SECONDS, 30 * 60);
});

test("SESSION_KEEPALIVE_SECONDS is far below SESSION_MAX_AGE_SECONDS — 48 keepalive ticks (1 cafe-day at 30-min cadence) still land comfortably inside one maxAge window, which is the whole point of a keepalive: it must fire often enough that a tab left open all day never approaches expiry", () => {
  assert.ok(
    SESSION_KEEPALIVE_SECONDS * 48 <= SESSION_MAX_AGE_SECONDS,
    "48 keepalive intervals (a full day at the 30-minute cadence) must still fit inside the 30-day maxAge many times over, or the keepalive would not meaningfully extend a daily-use session",
  );
});

// Tightened per CB-U1 review round 1 (F2): the ORIGINAL bound above only
// checks the cadence against the 30-day maxAge, which a badly-misconfigured
// hour-plus interval could still satisfy (e.g. 20 hours * 48 << 30 days) while
// being useless in practice — a tab closed and reopened between two such
// ticks could still roll past the session's OWN visible-use window. The
// keepalive's whole job is to beat a staff member's typical AWAY-from-the-
// tab gap, which is minutes, not hours: bounding it at one hour keeps the
// cadence meaningfully tied to how often a counter PC is actually glanced at,
// not just "eventually smaller than 30 days."
test("SESSION_KEEPALIVE_SECONDS is at most one hour (60 * 60 seconds) — a keepalive cadence looser than an hour would still pass the maxAge-ratio check above while being too infrequent to reliably beat a staff member's away-from-the-tab gap", () => {
  assert.ok(
    SESSION_KEEPALIVE_SECONDS <= 60 * 60,
    `SESSION_KEEPALIVE_SECONDS (${SESSION_KEEPALIVE_SECONDS}) must be at most 60*60 (one hour) — a looser cadence defeats the keepalive's purpose even though it would still satisfy the maxAge-ratio check`,
  );
});

// ── 2. apps/cafe/app/layout.tsx wiring ──────────────────────────────────────
//
// F1 fix (review round 1): SessionProvider's own refetchInterval was REJECTED
// as the keepalive — next-auth's fetchData() returns null on ANY transient
// error and _getSession then nulls the client session (status
// "unauthenticated", interval stops), live-probed on the installed dist. The
// root layout is back to a bare <SessionProvider session={session}> and the
// keepalive moved to components/layout/SessionKeepalive.tsx, mounted in the
// DASHBOARD layout only (see the pins below).

test("PIN (F1 regression guard): apps/cafe/app/layout.tsx's SessionProvider element is EXACTLY <SessionProvider session={session}> (no refetchInterval, no refetchWhenOffline prop) — landmark: <SessionProvider IS present", () => {
  const src = stripComments(readSrc(CAFE_LAYOUT));

  const tagStart = src.indexOf("<SessionProvider");
  assert.ok(tagStart >= 0, "positive landmark: <SessionProvider must be present");
  const tagEnd = src.indexOf(">", tagStart);
  assert.ok(tagEnd > tagStart, "expected to find the SessionProvider opening tag's closing >");
  const tagSlice = src.slice(tagStart, tagEnd + 1);

  assert.equal(
    tagSlice.replace(/\s+/g, " "),
    "<SessionProvider session={session}>",
    "app/layout.tsx's <SessionProvider> element must be exactly <SessionProvider session={session}> — the F1 fix reverted it to bare, moving the keepalive out to SessionKeepalive.tsx",
  );
  assert.ok(
    !src.includes("refetchInterval"),
    "app/layout.tsx must NOT contain refetchInterval anywhere — SessionProvider's own refetchInterval was rejected as the keepalive (F1): a transient fetchData() failure nulls the client session and stops the interval",
  );
});

// ── 2b. NEW components/layout/SessionKeepalive.tsx (F1's replacement) ──────

test('PIN: components/layout/SessionKeepalive.tsx contains SESSION_KEEPALIVE_SECONDS * MS_PER_SECOND, the literal "/api/auth/session", credentials: "same-origin", navigator.onLine === false, a .catch(, and a `return null` — and does NOT contain useSession(, setSession, or signOut( (landmark: it DOES call setInterval()', () => {
  const src = stripComments(readSrc(SESSION_KEEPALIVE));

  // Positive landmarks first.
  assert.match(src, /setInterval\(/, "positive landmark: the component must call setInterval(");
  assert.match(src, /SESSION_KEEPALIVE_SECONDS\s*\*\s*MS_PER_SECOND/, "must compute the interval as SESSION_KEEPALIVE_SECONDS * MS_PER_SECOND");
  // Round-2 review: the multiplier's VALUE is load-bearing — a 1 here would turn
  // 2 keepalives/hour into 2/second per open staff tab (≈3.6M invocations/month
  // across five tabs, past the 1M Hobby ceiling) while the shape pin above
  // stayed green.
  assert.match(src, /const MS_PER_SECOND = 1000;/, "MS_PER_SECOND must be exactly 1000 — the seconds→ms multiplier is what keeps the keepalive at 2/hour, not 2/second");
  assert.ok(src.includes('"/api/auth/session"'), 'must fetch the literal "/api/auth/session" endpoint');
  assert.match(src, /credentials:\s*"same-origin"/, 'must set credentials: "same-origin"');
  assert.match(src, /navigator\.onLine\s*===\s*false/, "must skip the tick when navigator.onLine === false (offline ticks skipped)");
  assert.match(src, /\.catch\(/, "must swallow a failed fetch with .catch( — failures are ignored, the next tick retries");
  assert.match(src, /return null;?/, "the component must return null — it renders nothing");

  const bannedNeedles = ["useSession" + "(", "setSession", "signOut" + "("];
  for (const needle of bannedNeedles) {
    assert.ok(
      !src.includes(needle),
      `SessionKeepalive.tsx must NEVER contain "${needle}" — it is a raw same-origin fetch that never touches next-auth's client state, which is exactly what made SessionProvider's own refetchInterval unsafe (F1)`,
    );
  }
});

// ── 2c. Dashboard layout mounts <SessionKeepalive />, root layout does not ─

test("PIN: apps/cafe/app/(dashboard)/layout.tsx contains <SessionKeepalive /> EXACTLY ONCE, and apps/cafe/app/layout.tsx does NOT contain it at all — landmark: the dashboard layout DOES contain <PrintHostProvider>", () => {
  const dashboardSrc = stripComments(readSrc(CAFE_DASHBOARD_LAYOUT));
  const rootSrc = stripComments(readSrc(CAFE_LAYOUT));

  assert.ok(dashboardSrc.includes("<PrintHostProvider>"), "positive landmark: the dashboard layout must contain <PrintHostProvider>");

  const NEEDLE = "SessionKeepalive" + " />";
  const dashboardCount = dashboardSrc.split(NEEDLE).length - 1;
  assert.equal(dashboardCount, 1, `expected exactly one "${NEEDLE}" in the dashboard layout, found ${dashboardCount}`);

  assert.ok(
    !rootSrc.includes("SessionKeepalive"),
    "app/layout.tsx must NOT mount or import SessionKeepalive — it is a staff-screen-only component, mounted in the DASHBOARD layout, never on /login or /m",
  );
});

test('INVENTORY: files containing the needle \'"SessionKeepalive" + " />"\' (the JSX call-site shape) under apps/cafe/{app,components} are exactly ["app/(dashboard)/layout.tsx"] — SessionKeepalive.tsx itself declares the component (export function SessionKeepalive()), it never renders itself as JSX, so it does not appear in this inventory; a new call site is a deliberate decision, not an accident', () => {
  const NEEDLE = "SessionKeepalive" + " />";
  const roots = ["app", "components"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(NEEDLE)) {
        hits.push(path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/"));
      }
    }
  }
  for (const root of roots) walk(root);
  hits.sort();

  assert.deepEqual(
    hits,
    ["app/(dashboard)/layout.tsx"],
    `<SessionKeepalive /> call sites under apps/cafe/{app,components} must be exactly this one file; found: ${hits.join(", ")}`,
  );
});

// ── 3. apps/cafe/auth.config.ts still passes maxAge, no updateAge ──────────

test('PIN: apps/cafe/auth.config.ts still passes maxAge: SESSION_MAX_AGE_SECONDS inside strategy: "jwt", and contains NO updateAge anywhere (landmark: strategy: "jwt" IS present) — updateAge is a dead knob on the JWT branch (see the installed-dist pin below) and must never be added back as a false "fix"', () => {
  const src = stripComments(readSrc(CAFE_AUTH_CONFIG));
  assert.match(src, /strategy:\s*"jwt"/, 'positive landmark: session: { strategy: "jwt", ... } must still be present');
  assert.match(src, /maxAge:\s*SESSION_MAX_AGE_SECONDS/, "auth.config.ts must still pass maxAge: SESSION_MAX_AGE_SECONDS");
  assert.ok(!src.includes("updateAge"), "auth.config.ts must contain NO updateAge anywhere, not even in a comment — it is consulted only in @auth/core's database branch, never the JWT one this app uses");
});

// ── 4. apps/hub parity: hub is deliberately NOT rolled ─────────────────────

test("PIN: apps/hub/lib/constants.ts still declares its OWN SESSION_MAX_AGE_SECONDS = 8 * 60 * 60 — the Hub's short 8h owner-session lifetime is a deliberate, SEPARATE constant from the cafe's 30-day one; CB-U1 must never touch it", () => {
  const hubSrc = stripComments(readSrc(HUB_CONSTANTS));
  assert.match(hubSrc, /export const SESSION_MAX_AGE_SECONDS = 8 \* 60 \* 60;/, "apps/hub/lib/constants.ts must still declare SESSION_MAX_AGE_SECONDS = 8 * 60 * 60 — untouched by the cafe's rolling-login change");
  // Positive cross-check that the two really are different values, so this
  // pin cannot pass vacuously if the two constants were ever unified.
  assert.notEqual(8 * 60 * 60, SESSION_MAX_AGE_SECONDS, "the hub's 8h session and the cafe's 30-day session must remain genuinely different constants");
});

// ── 5. Installed-dist pin: @auth/core's session.js JWT branch ─────────────

test('PIN (installed-dist, @auth/core 0.41.2): the JWT branch of node_modules/@auth/core/lib/actions/session.js (if (sessionStrategy === "jwt") { ... } up to the "// Retrieve session from database" marker) calls jwt.encode(, fromDate(sessionMaxAge), and sessionStore.chunk(, and contains NO updateAge — proving the rolling-session story (every session action re-signs the cookie with a fresh maxAge-based expiry, and updateAge is a dead knob here); landmark: updateAge DOES appear later, in the database branch. Pinned against @auth/core 0.41.2 — if this ever reddens on an upgrade, RE-DERIVE the rolling-session story from the new dist before touching this assertion, do not just retarget the string', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, AUTH_CORE_PKG_JSON), "utf8")) as { version: string };
  assert.ok(
    pkg.version.startsWith("0.41."),
    `@auth/core has moved to ${pkg.version} (pinned against 0.41.2) — an upgrade must re-derive the rolling-session story (does the JWT branch still re-sign the cookie's expiry on every session action? is updateAge still a database-branch-only knob?) before touching this assertion`,
  );

  const src = readSrc(AUTH_CORE_SESSION_JS);
  const jwtBranchStart = src.indexOf('if (sessionStrategy === "jwt")');
  assert.ok(jwtBranchStart >= 0, 'expected to find if (sessionStrategy === "jwt") in session.js');
  const dbMarker = "// Retrieve session from database";
  const dbMarkerAt = src.indexOf(dbMarker, jwtBranchStart);
  assert.ok(dbMarkerAt > jwtBranchStart, 'expected to find the "// Retrieve session from database" marker after the JWT branch');

  const jwtBranch = src.slice(jwtBranchStart, dbMarkerAt);
  assert.match(jwtBranch, /jwt\.encode\(/, "the JWT branch must call jwt.encode( — it re-signs the token on every session action");
  assert.match(jwtBranch, /fromDate\(sessionMaxAge\)/, "the JWT branch must call fromDate(sessionMaxAge) — the fresh expiry is derived from maxAge, not updateAge");
  assert.match(jwtBranch, /sessionStore\.chunk\(/, "the JWT branch must call sessionStore.chunk( — this is what re-sets the cookie with the fresh expiry");
  assert.ok(!jwtBranch.includes("updateAge"), "the JWT branch must contain NO updateAge — it is a dead knob here, consulted only in the database branch below");

  // Positive landmark: updateAge DOES appear later, in the database branch —
  // proves this test is reading real, un-blinded source, not an empty slice.
  const restOfFile = src.slice(dbMarkerAt);
  assert.match(restOfFile, /updateAge/, "positive landmark: updateAge must appear somewhere AFTER the database marker (the database branch actually consults it) — otherwise this file may have been blinded");
});
