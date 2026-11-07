// Source pins for P2 N1's visible part: a tap shows the target screen's skeleton under a 2px line in the same frame,
// with the tapped row lit, and says "Still opening…" after 8 s. The page underneath stays mounted (hidden), so its
// queries, the pulse and printing keep running; the store settles when the new screen lands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import { DASHBOARD_HEADER_REM } from "@/lib/pos-layout";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(raw(rel));
const lines = (rel: string): number => raw(rel).split("\n").length - (raw(rel).endsWith("\n") ? 1 : 0);

const LAYOUT = "app/(dashboard)/layout.tsx";
const VIEW = "components/layout/NavProgressView.tsx";
const SKELETON = "components/layout/NavSkeleton.tsx";
const CSS = "app/nav-progress.css";
const APP_LINK = "components/layout/AppLink.tsx";
const HOOK = "hooks/use-nav-progress.ts";
const HEADER = "components/layout/Header.tsx";

// ── The shell ────────────────────────────────────────────────────────────────

test("PIN: the dashboard <main> holds the page inside NavProgressView, and the layout loads the view's stylesheet", () => {
  const layout = code(LAYOUT);
  assert.match(
    layout,
    /<main className="flex-1 p-4 pb-\[92px\] tab:pb-4 md:p-6">\s*<NavProgressView>\s*\{children\}\s*<\/NavProgressView>\s*<\/main>/,
    "<main> renders NavProgressView around the page, and nothing else",
  );
  assert.match(layout, /import \{ NavProgressView \} from "@\/components\/layout\/NavProgressView";/, "the view is the layout's import");
  assert.match(layout, /import\s+"\.\.\/nav-progress\.css";/, "the line's and the spinner's stylesheet is loaded with the staff shell");
});

test("PIN: app/(dashboard)/loading.tsx is gone, and no dashboard route brings a loading boundary back", () => {
  assert.ok(!existsSync(path.join(CAFE_ROOT, "app/(dashboard)/loading.tsx")), "the route-level skeleton is gone (the tap's skeleton covers every instrumented navigation)");
  const found: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(CAFE_ROOT, rel))) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(CAFE_ROOT, child)).isDirectory()) walk(child);
      else if (/^loading\.(tsx|ts|jsx|js)$/.test(name)) found.push(child);
    }
  };
  walk("app/(dashboard)");
  assert.deepEqual(found, [], `a loading boundary would hold the finished screen behind React's reveal throttle: ${found.join(", ")}`);
});

// ── The page wrapper and the skeleton ────────────────────────────────────────

test("PIN: the page wrapper is never unmounted: `contents` while shown, the hidden attribute while covered", () => {
  const view = code(VIEW);
  assert.match(
    view,
    /<div data-ui="nav-page" className=\{cover \? undefined : "contents"\} hidden=\{cover !== null\}>\s*\{children\}\s*<\/div>/,
    "the page sits in one wrapper that only hides",
  );
  assert.equal((view.match(/\{children\}/g) ?? []).length, 2, "the page is rendered in exactly one place (plus the view handing it to the frame)");
  assert.match(view, /return \(\s*<>\s*<div data-ui="nav-page"/, "the wrapper is the frame's first child, never behind a condition");
  assert.match(view, /<NavProgressFrame cover=\{cover\}>\{children\}<\/NavProgressFrame>/, "the view hands the page to the frame unconditionally");
});

test("render: no navigation shows the page in a layout-neutral wrapper and no skeleton", async () => {
  const { NavProgressFrame } = await import("@/components/layout/NavProgressView");
  const html = renderToStaticMarkup(createElement(NavProgressFrame, { cover: null }, createElement("p", null, "the page")));
  assert.equal(html, '<div data-ui="nav-page" class="contents"><p>the page</p></div>', "only the page, display: contents");
});

test("render: a covered page stays mounted under the hidden attribute, with the target's skeleton beside it", async () => {
  const { NavProgressFrame } = await import("@/components/layout/NavProgressView");
  const cover = { href: "/pos?table=T-1", label: "Order", startedAt: 0, fromPath: "/orders" };
  const html = renderToStaticMarkup(createElement(NavProgressFrame, { cover }, createElement("p", null, "the page")));
  assert.ok(html.startsWith('<div data-ui="nav-page" hidden=""><p>the page</p></div>'), `the page is still rendered, hidden: ${html.slice(0, 120)}`);
  assert.match(html, /<div data-ui="nav-skeleton" data-kind="board" aria-busy="true"/, "the board skeleton for /pos, busy");
  assert.match(html, /<p role="status" aria-live="polite" class="sr-only"><\/p>/, "the polite status region waits, empty, for the words");
  assert.ok(!html.includes("Still opening"), "the words wait for the 8 s timer");
  assert.ok(html.indexOf('data-ui="nav-still-opening"') < html.indexOf('data-ui="nav-skeleton"'), "the words sit above the skeleton");
});

test("render: each skeleton kind is a busy root; the list is the old loading.tsx's shape", async () => {
  const { NavSkeleton } = await import("@/components/layout/NavSkeleton");
  for (const kind of ["list", "board", "form"] as const) {
    const html = renderToStaticMarkup(createElement(NavSkeleton, { kind }));
    assert.ok(html.startsWith(`<div data-ui="nav-skeleton" data-kind="${kind}" aria-busy="true"`), `the ${kind} root is marked and busy: ${html.slice(0, 100)}`);
    assert.match(html, /h-7 w-48/, `the ${kind} skeleton keeps the title bar`);
    assert.match(html, /h-4 w-72/, `the ${kind} skeleton keeps the line under the title`);
  }
  const list = renderToStaticMarkup(createElement(NavSkeleton, { kind: "list" }));
  assert.equal((list.match(/h-12 w-full/g) ?? []).length, 6, "the list: six 48px rows");
  assert.match(list, /space-y-2 rounded-lg border p-4/, "in the old bordered panel");
  assert.ok(!code(SKELETON).includes("animate-[") && !/transition/.test(code(SKELETON)), "the skeleton's only motion is the kit's pulse (opacity)");
});

// ── "Still opening…" ─────────────────────────────────────────────────────────

// Moved on purpose (final review I1 / m-a, ruling R35): Back abandons the navigation (a late answer never replaces the
// screen the person stayed on), and Try again checks the line before a document load.
test("PIN: the exact words, Try again = retryNavigation, Back = abandonNavigation with the page's router", () => {
  const view = code(VIEW);
  assert.ok(view.includes('"Still opening…"'), "the exact words, one ellipsis character");
  assert.ok(!view.includes("Still opening..."), "never three dots");
  assert.match(view, />\s*Try again\s*</, "the exact words Try again");
  assert.match(view, />\s*Back\s*</, "the exact word Back");
  assert.match(view, /onClick=\{\(\) => retryNavigation\(cover\.href, cover\.label\)\}[^>]*>\s*Try again\s*</, "Try again: a full load online, the toast offline");
  assert.ok(!view.includes("window.location.assign"), "no bare document load in the view (offline it would show the browser's error page)");
  assert.match(view, /onClick=\{\(\) => abandonNavigation\(router\)\}[^>]*>\s*Back\s*</, "Back ends the wait AND drops the pending navigation");
  assert.match(view, /function StillOpeningActions\(\{ cover \}[^)]*\) \{\s*const router = useRouter\(\);/, "the router comes from useRouter in the component that renders Back");
  assert.match(view, /import \{[^}]*\buseRouter\b[^}]*\} from "next\/navigation";/, "next/navigation's useRouter");
  assert.equal((view.match(/<Button type="button" variant="outline" className="h-11 px-6"/g) ?? []).length, 2, "two real buttons, 44px tall");
  assert.match(view, /<p role="status" aria-live="polite"/, "the words reach a screen reader politely");
});

test("PIN: one timer per navigation, from the tap's start; never an interval or a request", () => {
  const view = code(VIEW);
  assert.match(view, /window\.setTimeout\(check, stillOpeningIn\(cover, Date\.now\(\)\)\)/, "the timer waits until 8 s after the tap");
  assert.match(view, /navProgress\.stillOpening\(Date\.now\(\)\)/, "the store says when the navigation is late");
  assert.match(view, /return \(\) => window\.clearTimeout\(timer\);\s*\}, \[cover\]\);/, "cleared when the navigation ends or changes");
  assert.ok(!/setInterval|fetch\(|useQuery/.test(view), "no recurring timer and no request");
});

// ── Settling ─────────────────────────────────────────────────────────────────

test("PIN: a layout effect on the pathname settles the store and marks the visit; a bfcache restore cancels", () => {
  const view = code(VIEW);
  assert.match(
    view,
    /useLayoutEffect\(\(\) => \{[^}]*?navProgress\.settle\(pathname\);\s*heldRoutes\.mark\(pathname, Date\.now\(\)\);\s*\}, \[pathname\]\);/,
    "before paint, on mount and on every pathname: settle, then mark the visit",
  );
  assert.match(
    view,
    /if \(event\.persisted\) navProgress\.cancel\(\);[\s\S]*?window\.addEventListener\("pageshow", onShow\)/,
    "a page restored from the back-forward cache never comes back under a skeleton",
  );
  assert.match(view, /window\.removeEventListener\("pageshow", onShow\)/, "the listener is removed with the view");
});

test("PIN (C4 m1): Back / Forward ends the wait (Next drops the pending navigation; a same-path entry changes no pathname)", () => {
  const view = code(VIEW);
  assert.match(view, /const onPop = \(\) => navProgress\.cancel\(\);/, "a popstate cancels the navigation in progress");
  assert.match(view, /window\.addEventListener\("popstate", onPop\);/, "listened beside pageshow");
  assert.match(view, /window\.removeEventListener\("popstate", onPop\);/, "and removed with the view");
});

test("PIN (C4 m2): the window scroll kept at the tap comes back when the same page shows again, never on a landing", () => {
  const view = code(VIEW);
  assert.match(
    view,
    /navProgress\.subscribe\(\(\) => \{\s*const next = navProgress\.get\(\);\s*if \(next !== null && kept\.current === null\) kept\.current = \{ path: next\.fromPath, y: window\.scrollY \};/,
    "kept from the store's own tap notice, before the skeleton hides the page (display: none clamps the scroll)",
  );
  assert.match(
    view,
    /useLayoutEffect\(\(\) => \{\s*if \(cover !== null\) return;\s*const was = kept\.current;\s*kept\.current = null;\s*if \(was !== null && was\.path === pathname\) window\.scrollTo\(0, was\.y\);\s*\}, \[cover, pathname\]\);/,
    "restored before paint only when the page that was covered shows again (Back, a dropped navigation, bfcache)",
  );
});

test("PIN (C4 m4): the spinner's wide rule and the `wide` variant name the same width and the same collapse flag", async () => {
  const { NAV_WIDE_MIN_PX } = await import("@/lib/pos-layout");
  const ours = /@media \(min-width: (\d+)px\) \{\s*html:not\(\[data-nav-collapsed\]\) \[data-ui="nav"\]/.exec(code(CSS));
  const variant = /@custom-variant wide \{\s*@media \(width >= ([\d.]+)rem\) \{\s*&:where\(html:not\(\[data-nav-collapsed\]\) \*\)/.exec(code("app/globals.css"));
  assert.ok(ours && variant, "landmark: both rules were read");
  assert.equal(Number(ours![1]), Number(variant![1]) * 16, "app/nav-progress.css's wide width equals app/globals.css's `wide` (rem × 16)");
  assert.equal(Number(ours![1]), NAV_WIDE_MIN_PX, "and the nav's own wide width (lib/pos-layout.ts)");
});

test("PIN (C4 m7): the skeleton kind is read from the href once (skeletonKindOf normalises it)", () => {
  const view = code(VIEW);
  assert.match(view, /<NavSkeleton kind=\{skeletonKindOf\(cover\.href\)\} \/>/, "one call");
  assert.ok(!/navTargetPath/.test(view), "no second normalisation in the view");
});

// ── The line under the header ────────────────────────────────────────────────

test("PIN: the 2px line is a named progressbar, drawn by the header on every staff page, /pos included", () => {
  const view = code(VIEW);
  assert.match(view, /data-ui="nav-line"/, "the line's marker");
  assert.match(view, /role="progressbar"/, "an indeterminate progressbar");
  assert.match(view, /aria-label=\{`Opening \$\{cover\.label\}`\}/, "named Opening {label}");
  assert.match(view, /const cover = coverOf\(useNavProgress\(\), pathname\);/, "the view and the line read one covering rule");
  assert.equal((view.match(/coverOf\(useNavProgress\(\), pathname\)/g) ?? []).length, 2, "both the view and the line use it");
  const header = code(HEADER);
  assert.match(header, /<NavProgressLine pos=\{pos\} \/>\s*<\/header>/, "the header's last child, out of its flex row (absolute)");
});

test("PIN: the new stylesheet: no :has(), motion is transform / opacity only, none with reduced motion", () => {
  const css = code(CSS);
  assert.ok(!css.includes(":has("), "WebView 109 has no :has()");
  assert.ok(!/\btransition\s*:/.test(css), "no transitions");
  const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
  assert.equal(frames.length, 2, `two animations, the line's run and the spinner's turn (got ${frames.length})`);
  for (const [, name, body] of frames) {
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.ok(props.length > 0, `landmark: ${name} has steps`);
    assert.deepEqual(props.filter((p) => p !== "transform" && p !== "opacity"), [], `${name} animates transform / opacity only`);
  }
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? "";
  assert.equal((reduced.match(/animation: none;/g) ?? []).length, 2, "reduced motion stops both animations");
  assert.match(css, /\[data-ui="nav-line"\]\[data-pos\] \{[^}]*top: calc\(3\.5rem - 2px\);/, "on /pos the line sits at the static header's foot");
  assert.equal(DASHBOARD_HEADER_REM, 3.5, "the /pos header is 3.5rem tall (lib/pos-layout.ts)");
});

test("PIN: the spinner shows on nav rows only (the sidebar, the tab bar, the More sheet), never on in-page links", () => {
  const css = code(CSS);
  const selectors = [...css.matchAll(/([^{}]*\[data-opening="true"\][^{}]*)\{/g)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 2, `landmark: the spinner rules (got ${selectors.length})`);
  for (const sel of selectors) {
    assert.ok(/\[data-ui="nav"\]/.test(sel), `scoped to the nav containers: ${sel}`);
    if (!/^html:not\(\[data-nav-collapsed\]\)/.test(sel)) {
      assert.match(sel, /^:is\(\[data-ui="nav"\], \[data-ui="tab-bar"\], \[data-ui="more-grid"\]\) \[data-opening="true"\]/, `the three containers: ${sel}`);
    }
  }
  assert.match(css, /width: 12px;\s*height: 12px;/, "a 12px spinner");
});

// ── The lit row ──────────────────────────────────────────────────────────────

test("PIN: AppLink sets data-opening from its own subscription, so a tap re-renders only the tapped row", () => {
  const link = code(APP_LINK);
  assert.match(link, /const opening = useNavOpening\(href\);/, "one boolean per link");
  assert.match(link, /data-opening=\{opening \? "true" : undefined\}/, "the marker only while true");
  assert.ok(link.indexOf("data-opening=") > link.indexOf("{...rest}"), "after the caller's props, so it cannot be overridden");
  const hook = code(HOOK);
  assert.match(
    hook,
    /export function useNavOpening\(href: string\): boolean \{\s*return useSyncExternalStore\(navProgress\.subscribe, \(\) => navProgress\.get\(\)\?\.href === href, \(\) => false\);/,
    "the per-link boolean: is my href the one opening?",
  );
});

test("PIN: the opening row takes its active colour (nav rows, flyout rows, tabs, More tiles)", () => {
  const classes = code("components/brand/brand-classes.ts");
  const navActive = /const NAV_ACTIVE =\s*"([^"]*)"/.exec(classes)?.[1] ?? "";
  for (const t of ["data-[opening=true]:bg-nav-on", "data-[opening=true]:text-white"]) assert.ok(navActive.split(" ").includes(t), `NAV_ACTIVE: ${t}`);
  const flyout = /export const BRAND_NAV_FLYOUT_ITEM_CLASS =\s*"([^"]*)"/.exec(classes)?.[1] ?? "";
  for (const t of ["data-[opening=true]:bg-accent", "data-[opening=true]:text-accent-foreground"]) assert.ok(flyout.split(" ").includes(t), `the flyout row: ${t}`);
  assert.match(code("components/layout/TabBar.tsx"), /const TAB_CLASS = cn\(\s*"[^"]*\bdata-\[opening=true\]:text-primary\b/, "a tab: the accent colour");
  const tile = /const TILE_CLASS = cn\(\s*"([^"]*)"/.exec(code("components/layout/ProfileSheet.tsx"))?.[1] ?? "";
  for (const t of ["data-[opening=true]:bg-accent", "data-[opening=true]:text-accent-foreground"]) assert.ok(tile.split(" ").includes(t), `a More tile: ${t}`);
});

test("PIN (R8): the files over the cap do not grow; the new files stay under it", () => {
  assert.ok(lines("components/layout/AppSidebar.tsx") <= 306, "AppSidebar.tsx stays at or under 306 lines");
  assert.ok(lines("components/layout/ProfileSheet.tsx") <= 339, "ProfileSheet.tsx stays at or under 339 lines");
  assert.ok(lines("app/globals.css") <= 797, "app/globals.css does not grow (the spinner lives in app/nav-progress.css)");
  for (const rel of [VIEW, SKELETON, CSS, "lib/nav-skeleton.ts", HEADER, "components/layout/TabBar.tsx"]) {
    assert.ok(lines(rel) <= 300, `${rel} is at most 300 lines`);
  }
});

// ── A hidden page is not measured ────────────────────────────────────────────

test("PIN: the header slot never measures a page hidden under the skeleton (no actions flipping into the header)", () => {
  const slot = code("components/layout/page-header-slot.tsx");
  assert.match(
    slot,
    /const measure = useCallback\(\(\) => \{[^}]*?if \(bodyRow && bodyRow\.getClientRects\(\)\.length === 0\) return;/,
    "a body row with no boxes keeps the last placement",
  );
});
