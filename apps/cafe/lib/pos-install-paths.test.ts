// Installable-POS (CB-1d.2) SOURCE pins — cross-slice wiring for the manifest
// route, middleware matcher, dashboard/root/m layouts, the wake-lock hook,
// generated icon bytes, the gen script, package.json's test chain, and the
// go-live runbook's reachability landmark. Modelled on lib/pos-layout-paths.
// test.ts (raw readFileSync, stripComments, node:test) — no React/route test
// framework exists here. lib/pos-install.test.ts (slice E) owns the pure
// pos-install.ts unit pins; lib/go-live-runbook.test.ts owns the deeper §A
// fact-table parity for the runbook doc.
//
// Every negative pin (asserts something is ABSENT) is paired with a positive
// landmark assert on the SAME source in the SAME test, per testing.md.
// Grep-gate needles that could match their own line are built by
// concatenation, never one literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  MANIFEST_THEME_COLOR,
  POS_ICON_192_PATH,
  POS_ICON_512_PATH,
  POS_ICON_MASKABLE_512_PATH,
  APPLE_TOUCH_ICON_PATH,
  POS_ICON_SIZE_SMALL_PX,
  POS_ICON_SIZE_LARGE_PX,
  APPLE_TOUCH_ICON_SIZE_PX,
  buildManifest,
} from "@/lib/pos-install";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MANIFEST_ROUTE = "apps/cafe/app/api/manifest/route.ts";
const MIDDLEWARE_FILE = "apps/cafe/middleware.ts";
const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const ROOT_LAYOUT = "apps/cafe/app/layout.tsx";
const M_LAYOUT = "apps/cafe/app/m/layout.tsx";
const WAKE_LOCK_HOOK = "apps/cafe/hooks/use-wake-lock.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const GEN_ICONS_SCRIPT = "apps/cafe/scripts/gen-pos-icons.mjs";
const CAFE_PACKAGE_JSON = "apps/cafe/package.json";
const GO_LIVE_CHECKLIST = "docs/GO-LIVE-CHECKLIST.md";
const PUBLIC_ICONS_DIR = "apps/cafe/public/icons";

// ── P1. app/api/manifest/route.ts ───────────────────────────────────────────

test("PIN: app/api/manifest/route.ts reads Settings read-only, is force-dynamic, serves the manifest content-type, and is GET-only", () => {
  const src = stripComments(readSrc(MANIFEST_ROUTE));

  assert.match(src, /readSettings\(/, "must call the read-only readSettings, never getSettings (which upserts on every anonymous fetch)");
  assert.match(src, /export const dynamic = "force-dynamic"/, "must opt out of static generation so Settings changes are visible");
  assert.match(src, /MANIFEST_CONTENT_TYPE/, "must serve the manifest content-type constant, not a spelled-out literal");
  assert.match(src, /buildManifest\(/, "must build the manifest body via the shared pure builder");
  assert.match(src, /export async function GET\(/, "must export a GET handler");

  // Negative: never the upserting getSettings — paired with the positive
  // readSettings landmark above (same test, same source).
  const getSettingsNeedle = "get" + "Settings(";
  assert.ok(
    !src.includes(getSettingsNeedle),
    "must never call getSettings — it upserts and bumps updatedAt on every anonymous/cookie-less manifest fetch",
  );

  // Negative: no console.* — paired with the buildManifest landmark above.
  const consoleNeedle = "console" + ".";
  assert.ok(!src.includes(consoleNeedle), "must never log — a broken manifest fetch must fail silently to the fallback name");

  // Negative: GET-only — no other HTTP verb exported. Paired with the GET
  // landmark above.
  assert.ok(
    !/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/.test(src),
    "the manifest route must export GET only",
  );

  // Negative: no hardcoded cafe/tenant name literal ("Lucifer") — the product
  // is generic; branding comes only from Settings via readSettings above.
  const bannedNameNeedle = "Luci" + "fer";
  assert.ok(!src.includes(bannedNameNeedle), "must never hardcode a cafe name — branding comes from Settings only");
});

// ── P2. middleware.ts matcher excludes icons/ but still excludes api ───────

test("PIN: middleware.ts's matcher line excludes both api and icons/ from the auth guard", () => {
  const src = stripComments(readSrc(MIDDLEWARE_FILE));
  const matcherLineMatch = src.match(/matcher:\s*\[[^\]]*\]/);
  assert.ok(matcherLineMatch, "middleware.ts must export a config.matcher array");
  const matcherLine = matcherLineMatch![0];

  // Positive landmark on the SAME extracted line: the api exclusion must
  // still be present (this pin only ADDS icons/, never regresses api).
  assert.match(matcherLine, /api\|/, "matcher must still exclude api routes from the auth guard");

  // The icons/ exclusion under test, checked on that same isolated line so a
  // match elsewhere in the file (e.g. a comment) can't produce a false pass.
  assert.match(matcherLine, /icons\//, "matcher must exclude icons/ so cookie-less PWA install-icon fetches are never redirected to /login");
});

// ── P3. app/(dashboard)/layout.tsx wires the manifest link + icons ─────────

test("PIN: app/(dashboard)/layout.tsx imports pos-install and declares manifest/apple/icon metadata plus the themeColor viewport", () => {
  const src = stripComments(readSrc(DASHBOARD_LAYOUT));

  assert.match(src, /from\s+"@\/lib\/pos-install"/, 'must import from "@/lib/pos-install"');
  assert.match(src, /themeColor:\s*MANIFEST_THEME_COLOR/, "viewport must set themeColor from the shared constant");

  // generateMetadata has TWO return statements (the try branch and the DB-down
  // catch branch) and BOTH must declare the link and both icon entries — a
  // single match anywhere in the file would let the fallback branch silently
  // drop the tab icon on every dashboard route (review RC3, 2026-09-04).
  // Next replaces metadata.icons wholesale per segment (not a deep merge), so
  // the dashboard must re-declare its own tab icon entry, not rely on root's.
  const RETURN_BRANCHES = 2;
  const count = (re: RegExp): number => (src.match(re) ?? []).length;
  assert.equal(count(/return\s*\{/g), RETURN_BRANCHES, "landmark: generateMetadata must have exactly two object-returning branches (try + catch)");
  assert.equal(count(/manifest:\s*MANIFEST_PATH/g), RETURN_BRANCHES, "manifest: MANIFEST_PATH must appear once per return branch");
  assert.equal(
    count(/apple:\s*\[\s*\{\s*url:\s*APPLE_TOUCH_ICON_PATH\s*\}\s*\]/g),
    RETURN_BRANCHES,
    "apple: [{ url: APPLE_TOUCH_ICON_PATH }] must appear once per return branch",
  );
  assert.equal(count(/icon:\s*\[/g), RETURN_BRANCHES, "icon: [ must be re-declared once per return branch — Next replaces metadata.icons per segment, not merges it");

  // Landmark (already pinned elsewhere; kept here only as a stable anchor
  // that this is still the same layout file the other pins target).
  assert.match(src, /interactiveWidget:\s*"resizes-content"/, "landmark: the dashboard viewport's keyboard-resize behavior");
});

// ── P4. root layout and /m layout carry NEITHER manifest nor wake-lock ─────

test("PIN: app/layout.tsx never advertises the install manifest or the wake lock — diners/public routes must not see an install prompt", () => {
  const src = stripComments(readSrc(ROOT_LAYOUT));

  // Positive landmark first (root layout still owns generateMetadata).
  assert.match(src, /export async function generateMetadata\(/, "landmark: root layout still exports generateMetadata");

  assert.ok(!src.includes("manifest:"), "root layout must never declare a manifest: metadata field");
  assert.ok(!src.includes("pos-install"), "root layout must never import from pos-install");
  assert.ok(!src.includes("useWakeLock"), "root layout must never call useWakeLock");
});

test("PIN: app/m/layout.tsx never advertises the install manifest or the wake lock — the public QR diner flow must not see an install prompt", () => {
  const src = stripComments(readSrc(M_LAYOUT));

  // Positive landmark first (confirmed against the real file, not guessed):
  // the /m layout's actual default export.
  assert.match(src, /export default async function PublicMenuLayout\(/, "landmark: /m layout still exports PublicMenuLayout");

  assert.ok(!src.includes("manifest:"), "/m layout must never declare a manifest: metadata field");
  assert.ok(!src.includes("pos-install"), "/m layout must never import from pos-install");
  assert.ok(!src.includes("useWakeLock"), "/m layout must never call useWakeLock");
});

// ── P5. hooks/use-wake-lock.ts ──────────────────────────────────────────────

test("PIN: hooks/use-wake-lock.ts is a client hook wired to shouldRequestWakeLock, the Wake Lock API, and visibilitychange, with no logging/timer/toast side effects", () => {
  const raw = readSrc(WAKE_LOCK_HOOK);
  const firstNonEmptyLine = raw.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstNonEmptyLine, '"use client";', 'the hook must open with "use client"');

  const stripped = stripComments(raw);
  assert.match(stripped, /export function useWakeLock\(enabled: boolean\)/, "must export useWakeLock(enabled: boolean)");
  assert.match(stripped, /visibilitychange/, "must listen for visibilitychange (a request while hidden rejects)");
  assert.match(stripped, /"wakeLock" in navigator/, "must feature-detect the Wake Lock API before using it");
  assert.match(stripped, /shouldRequestWakeLock\(/, "must gate every request through the shared pure predicate");
  assert.match(stripped, /wakeLock\.request\("screen"\)/, "must request the screen wake lock");
  assert.match(stripped, /"release"/, "must listen for the sentinel's release event to clear local active state");

  // Negatives, all vision-guarded by the visibilitychange landmark above.
  const consoleNeedle = "console" + ".";
  assert.ok(!stripped.includes(consoleNeedle), "must never log");
  const setTimeoutNeedle = "set" + "Timeout";
  assert.ok(!stripped.includes(setTimeoutNeedle), "must never poll via setTimeout — visibilitychange is the only re-request trigger");
  const setIntervalNeedle = "set" + "Interval";
  assert.ok(!stripped.includes(setIntervalNeedle), "must never poll via setInterval");
  const toastNeedle = "to" + "ast";
  assert.ok(!stripped.includes(toastNeedle), "must never surface a toast — a lock failure is a silent, fail-soft degrade");
});

// ── P6. reachability: the pos page mounts the hook, the layout does not ────

test("PIN: app/(dashboard)/pos/page.tsx mounts useWakeLock (page-level only, never the dashboard layout)", () => {
  const pageSrc = stripComments(readSrc(POS_PAGE));
  assert.match(pageSrc, /from\s+"@\/hooks\/use-wake-lock"/, 'pos/page.tsx must import from "@/hooks/use-wake-lock"');
  assert.match(pageSrc, /useWakeLock\(/, "pos/page.tsx must call useWakeLock");

  const layoutSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  // Positive landmark on the layout file first (already established as the
  // manifest-wiring file by P3; re-asserted here since this test reads it
  // independently for the negative check below).
  assert.match(layoutSrc, /manifest:\s*MANIFEST_PATH/, "landmark: dashboard layout still wires the manifest link");
  assert.ok(
    !layoutSrc.includes("useWakeLock"),
    "the dashboard layout must never mount useWakeLock itself — page-level only, so Reports/Settings never hold the lock",
  );
});

// ── P7. icon bytes match the manifest's declared paths and pixel sizes ─────

function iconFsPath(publicPath: string): string {
  // publicPath is e.g. "/icons/pos-192.png" -> apps/cafe/public/icons/pos-192.png
  const rel = publicPath.replace(/^\/icons\//, "");
  return path.join(REPO_ROOT, PUBLIC_ICONS_DIR, rel);
}

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("PIN: generated icon files exist, are valid PNGs, and their pixel dimensions match the manifest's declared constants", () => {
  const expectations: Array<{ publicPath: string; expectedPx: number; label: string }> = [
    { publicPath: POS_ICON_192_PATH, expectedPx: POS_ICON_SIZE_SMALL_PX, label: "pos-192" },
    { publicPath: POS_ICON_512_PATH, expectedPx: POS_ICON_SIZE_LARGE_PX, label: "pos-512" },
    { publicPath: POS_ICON_MASKABLE_512_PATH, expectedPx: POS_ICON_SIZE_LARGE_PX, label: "pos-maskable-512" },
    { publicPath: APPLE_TOUCH_ICON_PATH, expectedPx: APPLE_TOUCH_ICON_SIZE_PX, label: "apple-touch-icon" },
  ];

  for (const { publicPath, expectedPx, label } of expectations) {
    const fsPath = iconFsPath(publicPath);
    assert.ok(existsSync(fsPath), `${label}: expected generated icon file at ${fsPath}`);
    const buf = readFileSync(fsPath);
    assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${label}: must start with the PNG signature`);
    const { width, height } = readPngDimensions(buf);
    assert.equal(width, expectedPx, `${label}: width must equal ${expectedPx}px`);
    assert.equal(height, expectedPx, `${label}: height must equal ${expectedPx}px`);
  }
});

test("PIN: every icon src in buildManifest(...).icons maps to a file that actually exists on disk", () => {
  const manifest = buildManifest("Any Cafe Name");
  assert.ok(manifest.icons && manifest.icons.length > 0, "landmark: buildManifest must produce a non-empty icons array");
  for (const icon of manifest.icons!) {
    const fsPath = iconFsPath(icon.src);
    assert.ok(existsSync(fsPath), `manifest icon src ${icon.src} must map to an existing file at ${fsPath}`);
  }
});

// ── P8. scripts/gen-pos-icons.mjs mirrors the manifest theme colour ────────

test("PIN: scripts/gen-pos-icons.mjs's icon mark colour mirrors MANIFEST_THEME_COLOR — the mark colour and the manifest theme colour are one fact", () => {
  const src = readSrc(GEN_ICONS_SCRIPT);
  assert.ok(existsSync(path.join(REPO_ROOT, GEN_ICONS_SCRIPT)), "landmark: the icon generator script must exist");
  assert.ok(
    src.includes(MANIFEST_THEME_COLOR),
    `gen-pos-icons.mjs must contain the literal value of MANIFEST_THEME_COLOR (${MANIFEST_THEME_COLOR}) — the icon mark colour and the manifest theme colour must never drift apart`,
  );
});

// ── P9. package.json test chain includes both new suites ───────────────────

test("PIN: apps/cafe/package.json's test script includes lib/pos-install.test.ts and lib/pos-install-paths.test.ts", () => {
  const pkg = JSON.parse(readSrc(CAFE_PACKAGE_JSON)) as { scripts?: Record<string, string> };
  const testScript = pkg.scripts?.test ?? "";

  // Positive landmark: an existing, already-wired suite must still be present
  // (proves we parsed the real chain, not an empty/truncated string).
  assert.ok(testScript.includes("lib/branding-paths.test.ts"), "landmark: the test chain must still include lib/branding-paths.test.ts");

  assert.ok(testScript.includes("lib/pos-install.test.ts"), "the test chain must include lib/pos-install.test.ts");
  assert.ok(testScript.includes("lib/pos-install-paths.test.ts"), "the test chain must include lib/pos-install-paths.test.ts");
});

// ── P10. docs/GO-LIVE-CHECKLIST.md reachability landmark ───────────────────

test("PIN: docs/GO-LIVE-CHECKLIST.md documents the install step for the counter device (reachability landmark; go-live-runbook.test.ts owns the deeper §A fact-table parity)", () => {
  const src = readSrc(GO_LIVE_CHECKLIST);
  assert.match(
    src,
    /### Installing the POS on the counter device/,
    "the checklist must document an install-on-counter-device subsection",
  );
});
