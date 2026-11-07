// Source pin for P2 N1: every staff navigation goes through AppLink (links) or navigateTo (code), so each tap can
// start the "page is opening" progress and (C3) be refused or full-loaded when the line is dead. A raw next/link
// or router.push/replace in staff code would skip all of that, silently. The public menu (app/m, components/public)
// is a different product and keeps plain Link / router.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCAN_DIRS = ["app", "components", "hooks", "lib"];
const APP_LINK = "components/layout/AppLink.tsx";
const NAVIGATE = "lib/navigate.ts";

const isPublic = (rel: string) => rel.startsWith("app/m/") || rel.startsWith("components/public/");

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(path.join(CAFE_ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(CAFE_ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(rel);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const d of SCAN_DIRS) walk(d, out);
  return out;
}

const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

test("PIN: only AppLink (and the public menu) imports next/link", () => {
  const files = sourceFiles();
  assert.ok(files.length > 200, `landmark: the scan found the staff source (${files.length} files)`);
  const offenders = files.filter(
    (f) => f !== APP_LINK && !isPublic(f) && /from\s+["']next\/link["']/.test(code(f)),
  );
  assert.deepEqual(offenders, [], `staff files must use AppLink, not next/link: ${offenders.join(", ")}`);
  assert.match(code(APP_LINK), /from\s+["']next\/link["']/, "landmark: AppLink itself wraps next/link");
});

test("PIN: only navigateTo (and the public menu) calls router.push / router.replace", () => {
  const offenders = sourceFiles().filter(
    (f) => f !== NAVIGATE && !isPublic(f) && /\brouter\.(push|replace)\(/.test(code(f)),
  );
  assert.deepEqual(offenders, [], `staff code must call navigateTo, not router.push/replace: ${offenders.join(", ")}`);
  assert.match(code(NAVIGATE), /router\.push\(/, "landmark: navigateTo pushes");
  assert.match(code(NAVIGATE), /router\.replace\(/, "landmark: navigateTo replaces");
});

test("PIN: AppLink never prefetches on sight and starts the progress through the shared decision", () => {
  const link = code(APP_LINK);
  assert.match(link, /prefetch=\{false\}/, "AppLink forces prefetch={false}");
  assert.ok(link.indexOf("prefetch={false}") > link.indexOf("{...rest}"), "prefetch={false} comes after the caller's props, so it cannot be overridden");
  assert.match(link, /useIntentPrefetch\(href\)/, "AppLink prefetches on intent (press / resting mouse) only");
  assert.match(link, /beginNavigation\(/, "AppLink's onNavigate asks the shared decision in lib/navigate.ts");
  assert.match(code(NAVIGATE), /progress\.start\(/, "the shared decision starts the progress");
  assert.match(code(NAVIGATE), /progress[^=]*= navProgress/, "the progress it starts is the page-wide navProgress by default");
  assert.match(link, /e\.preventDefault\(\)/, "a tap on the href already opening is cancelled");
});

test("PIN: IntentLink is gone (AppLink absorbed it)", () => {
  assert.equal(existsSync(path.join(CAFE_ROOT, "components/layout/IntentLink.tsx")), false, "components/layout/IntentLink.tsx must not exist");
  const users = sourceFiles().filter((f) => /\bIntentLink\b/.test(code(f)));
  assert.deepEqual(users, [], `nothing may still use IntentLink: ${users.join(", ")}`);
});
