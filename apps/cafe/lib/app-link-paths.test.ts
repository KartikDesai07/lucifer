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

// The router's push / replace calls in a source, whatever the router is called (final review m-c: the old pin matched
// only the name `router`, so `const nav = useRouter(); nav.push(…)` slipped through). A name counts as the router when
// it is bound from useRouter() or useContext(AppRouterContext), or typed AppRouterInstance; destructuring push / replace
// out of the router, and useRouter().push(…) itself, count too. A name copied to another name is not followed.
const ROUTER_SOURCE = String.raw`(?:useRouter\(\s*\)|useContext\(\s*AppRouterContext\s*\))`;
function routerNavCalls(src: string): string[] {
  const found: string[] = [];
  const names = new Set<string>(["router"]);
  for (const m of src.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*${ROUTER_SOURCE}`, "g"))) names.add(m[1]);
  for (const m of src.matchAll(/\b(\w+)\s*\??\s*:\s*(?:AppRouterInstance|ReturnType<typeof useRouter>)/g)) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${ROUTER_SOURCE}`, "g"))) {
    if (/\b(push|replace)\b/.test(m[1])) found.push(`{${m[1].trim()}} = router`);
  }
  for (const m of src.matchAll(new RegExp(String.raw`${ROUTER_SOURCE}\s*\??\.\s*(push|replace)\s*\(`, "g"))) found.push(`router().${m[1]}(`);
  for (const name of names) {
    for (const m of src.matchAll(new RegExp(String.raw`\b${name}\s*\??\.\s*(push|replace)\s*\(`, "g"))) found.push(`${name}.${m[1]}(`);
  }
  return found;
}

test("the router-call detector sees push / replace under any name, and never an array push or a string replace", () => {
  const caught = (src: string) => routerNavCalls(src).length > 0;
  assert.ok(caught(`const nav = useRouter(); nav.push("/x");`), "a router named nav");
  assert.ok(caught(`const r = useRouter();\n r?.replace("/x")`), "optional call on another name");
  assert.ok(caught(`const ctx = useContext(AppRouterContext); ctx.push("/x")`), "the context read directly");
  assert.ok(caught(`function go(to: AppRouterInstance) { to.replace("/x"); }`), "a parameter typed AppRouterInstance");
  assert.ok(caught(`const { push } = useRouter(); push("/x");`), "push destructured out of the router");
  assert.ok(caught(`useRouter().push("/x")`), "a call on useRouter() itself");
  assert.ok(caught(`router.push("/x")`), "the old pin's case, any origin");
  assert.ok(!caught(`const nav = useRouter(); navigateTo(nav, "/x"); rows.push(1); s.replace("a", "b");`), "an array push and a string replace are not the router");
  assert.ok(!caught(`const { prefetch } = useRouter(); prefetch("/x");`), "only push / replace are navigations");
});

test("PIN: only navigateTo (and the public menu) calls the router's push / replace, under any name", () => {
  const files = sourceFiles().filter((f) => f !== NAVIGATE && !isPublic(f));
  const offenders = files.flatMap((f) => routerNavCalls(code(f)).map((call) => `${f}: ${call}`));
  assert.deepEqual(offenders, [], `staff code must call navigateTo, not the router's push/replace: ${offenders.join(", ")}`);
  assert.ok(files.filter((f) => /\buseRouter\(/.test(code(f))).length >= 5, "landmark: the scan saw the staff files that hold a router");
  assert.match(code(NAVIGATE), /router\.push\(/, "landmark: navigateTo pushes");
  assert.match(code(NAVIGATE), /router\.replace\(/, "landmark: navigateTo replaces");
  assert.ok(routerNavCalls(code(NAVIGATE)).length >= 3, "landmark: the detector sees lib/navigate.ts's own calls (push, replace, the abandon replace)");
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
  assert.match(link, /beginNavigation\(href, label, /, "AppLink passes its label prop through to the decision");
  assert.match(link, /if \(prevented\) return;\s*const result = beginNavigation\(/, "a caller's own preventDefault in onNavigate stops AppLink before it starts a progress");
});

test("PIN: IntentLink is gone (AppLink absorbed it)", () => {
  assert.equal(existsSync(path.join(CAFE_ROOT, "components/layout/IntentLink.tsx")), false, "components/layout/IntentLink.tsx must not exist");
  const users = sourceFiles().filter((f) => /\bIntentLink\b/.test(code(f)));
  assert.deepEqual(users, [], `nothing may still use IntentLink: ${users.join(", ")}`);
});
