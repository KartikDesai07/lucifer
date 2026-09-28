// Source pins for the staff sidebar's 2026-09-26 redesign (components/layout/
// AppSidebar.tsx + its extracted pieces). The sidebar is chrome on EVERY
// staff screen, so the behaviours a restyle could silently drop are pinned:
// who sees which row, the "you are here" announcement, the phone sheet's
// labels, a waiting request staying visible in the folded rail, and the
// brand fonts/colours reaching the portaled phone sheet. Same readSrc +
// stripComments idiom as lib/kitchen-paths.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const SETTINGS_GROUP = "apps/cafe/components/layout/SidebarSettingsGroup.tsx";
const REQUEST_BADGE = "apps/cafe/components/orders/RequestCountBadge.tsx";
const GLOBALS_CSS = "apps/cafe/app/globals.css";

/** The owner's tools. Everything else in the sidebar is for every signed-in role. */
const ADMIN_ONLY_URLS = ["/reports", "/settings", "/staff"];
const NAV_ENTRY_COUNT = 14;

test("PIN: the sidebar lists all 14 screens once each, and exactly Staff, Reports and Settings are admin-only", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const entries = [...src.matchAll(/\{\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)"[^}]*\}/g)].map((m) => ({
    title: m[1],
    url: m[2],
    adminOnly: /adminOnly:\s*true/.test(m[0]),
  }));
  // Mutation this catches: a regrouping that drops or duplicates a row — the
  // screen would then be unreachable from the nav, or listed twice.
  assert.equal(entries.length, NAV_ENTRY_COUNT, `expected ${NAV_ENTRY_COUNT} nav entries, found ${entries.map((e) => e.title).join(", ")}`);
  assert.equal(new Set(entries.map((e) => e.url)).size, NAV_ENTRY_COUNT, "every nav url must appear exactly once");
  // Mutation this catches: an admin tool losing adminOnly in a reshuffle —
  // every waiter would then see Staff / Reports / Settings in the sidebar.
  assert.deepEqual(
    entries.filter((e) => e.adminOnly).map((e) => e.url).sort(),
    ADMIN_ONLY_URLS,
    "exactly Staff, Reports and Settings carry adminOnly: true",
  );
  // And the filter that reads it is still applied to every section.
  assert.match(src, /items:\s*section\.items\.filter\(\(item\)\s*=>\s*!item\.adminOnly\s*\|\|\s*isAdmin\)/);
});

test("PIN: every sidebar link says which page is current — aria-current rides the same flag as the lit row", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const rowFlag = src.match(/const active = isActivePath\(pathname, item\.url\);/);
  assert.ok(rowFlag, "the row's lit state must come from isActivePath (lib/nav-active.ts)");
  // Mutation this catches: dropping aria-current — a screen reader user
  // would hear every row the same, with no "current page" anywhere.
  assert.match(src, /isActive=\{active\}/, "the row must light from the same `active` flag");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/, "the row's link must carry aria-current from that flag");

  const group = stripComments(readSrc(SETTINGS_GROUP));
  assert.match(group, /isActive=\{active\}/, "each Settings section row lights from its own `active` flag");
  assert.match(group, /aria-current=\{active \? "page" : undefined\}/, "and announces it with aria-current");
  // Review finding 2026-09-28: on the /settings hub the list auto-opens but
  // no section row matches — the Settings row itself must light and announce
  // the page, or nothing in the sidebar says where you are.
  assert.match(group, /const onHub = pathname === url;/);
  assert.match(group, /isActive=\{onHub \|\| \(onSettings && !settingsOpen\)\}/, "the Settings row lights on the hub even with its list open");
  assert.match(group, /aria-current=\{onHub \? "page" : undefined\}/, "and announces the hub as the current page");
});

test("PIN: the phone sheet always shows row labels, whatever the desktop rail was last folded to", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  // Mutation this catches: `collapsed = state === "collapsed"` alone — a
  // tablet folded in landscape then turned to portrait would open a sheet of
  // bare icons (the folded state is remembered per browser).
  assert.match(src, /const collapsed = state === "collapsed" && !isMobile;/);
});

test("PIN: a waiting order request stays visible in the folded rail — a red dot on the icon, where the primitive hides the count", () => {
  const src = stripComments(readSrc(REQUEST_BADGE));
  const dot = src.match(/<span[^>]*className="([^"]*)"[^>]*\/>/);
  assert.ok(dot, "RequestCountBadge must render a dot <span> beside the count badge");
  const classes = dot![1].split(/\s+/);
  // Hidden in the full sidebar (the count shows there), shown in the rail.
  assert.ok(classes.includes("hidden"), "the dot is hidden by default");
  assert.ok(classes.includes("group-data-[collapsible=icon]:block"), "the dot shows only in the folded rail");
  assert.ok(classes.includes("bg-brand-danger"), "the dot is the same red as the count badge");
  // Mutation this catches: the primitive's peer rules re-colouring the count
  // on an active or hovered row (ink on red, unreadable).
  assert.match(src, /peer-data-\[active=true\]\/menu-button:text-white/);
  assert.match(src, /peer-hover\/menu-button:text-white/);
});

test("PIN: the brand fonts sit on a child of <Sidebar>, not its className — the phone sheet renders the children but drops the className", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const open = src.indexOf('<Sidebar collapsible="icon"');
  assert.ok(open >= 0, 'landmark: AppSidebar renders <Sidebar collapsible="icon"');
  const openEnd = src.indexOf(">", open);
  assert.ok(!src.slice(open, openEnd).includes("brandFontVariables"), "the font variables must not ride Sidebar's className");
  const next = src.slice(openEnd, openEnd + 200);
  // A stripped JSX comment leaves a bare {} behind; allow it.
  assert.match(
    next,
    /^>\s*(?:\{\}\s*)*<div className=\{`\$\{brandFontVariables\} /,
    "the first child of <Sidebar> carries the font variables",
  );
});

test("PIN: the sidebar's colours come from the brand palette on :root (the phone sheet is portaled, so a wrapper could not reach it)", () => {
  const css = readSrc(GLOBALS_CSS);
  const root = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).find((body) => body.includes("--sidebar:"));
  assert.ok(root, "a :root block must declare --sidebar");
  for (const [name, token] of [
    ["sidebar", "brand-paper"],
    ["sidebar-foreground", "brand-ink"],
    ["sidebar-accent", "brand-wash"],
    ["sidebar-accent-foreground", "brand-ink"],
    ["sidebar-border", "brand-rule"],
    ["sidebar-ring", "brand-accent"],
  ] as const) {
    assert.match(root!, new RegExp(`--${name}:\\s*var\\(--${token}\\);`), `--${name} must be var(--${token})`);
  }
});
