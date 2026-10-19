import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { isActivePath } from "./nav-active";

// 2026-10-11 (owner, PetPooja-style): the top bar's quick links to the Floor and the POS. U0 Task 3 (values 2.5,
// design 5.3) draws them as the HTML's header buttons, in the design's order: Tables (outline) then New order (the
// HTML's primary button and word). They must open exactly the pages the sidebar's Floor and Order rows open, mark the
// current page the same way, and sit in the header every dashboard screen renders.

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const TABS = "components/layout/HeaderQuickTabs.tsx";
const SIDEBAR = "components/layout/AppSidebar.tsx";
const HEADER = "components/layout/Header.tsx";

const TABLES_TAB = '{ title: "Tables", url: "/tables", icon: NavFloor, exact: true }';
const NEW_ORDER_TAB = '{ title: "New order", url: "/pos", icon: GlyphPlus, primary: true }';
// U0 Task 2: the nav takes the owner's HTML words and glyphs ("Order", the HTML's floor grid); the targets are the same.
const SIDEBAR_NEW_ORDER = '{ title: "Order", url: "/pos", icon: NavOrder }';
const SIDEBAR_FLOOR = '{ title: "Floor", url: "/tables", icon: NavFloor, exact: true }';

function tabsMatchSidebar(tabs: string, sidebar: string): boolean {
  return tabs.includes(NEW_ORDER_TAB) && tabs.includes(TABLES_TAB) && sidebar.includes(SIDEBAR_NEW_ORDER) && sidebar.includes(SIDEBAR_FLOOR);
}

test("PIN: Tables opens the Floor (/tables, exact) and New order opens /pos — the sidebar's own two rows", () => {
  const tabs = read(TABS);
  const sidebar = read(SIDEBAR);
  assert.equal(tabsMatchSidebar(tabs, sidebar), true, "both buttons go where the sidebar's rows go");
  // Vision guard: a drifted target on either side flips it.
  assert.equal(tabsMatchSidebar(tabs.replace('url: "/tables", icon: NavFloor', 'url: "/tables/setup", icon: NavFloor'), sidebar), false, "a drifted Tables target is caught");
  assert.equal(tabsMatchSidebar(tabs, sidebar.replace('{ title: "Floor", url: "/tables"', '{ title: "Floor", url: "/floor"')), false, "a drifted Floor row is caught");
  assert.equal(tabsMatchSidebar(tabs.replace(NEW_ORDER_TAB, '{ title: "New order", url: "/orders", icon: GlyphPlus, primary: true }'), sidebar), false, "a drifted New order target is caught");
  assert.ok(tabs.indexOf(TABLES_TAB) < tabs.indexOf(NEW_ORDER_TAB), "Tables comes first, New order second (design 5.3)");
});

test("PIN: a button marks the current page like the sidebar — New order on /pos and its sub-pages, Tables on /tables only", () => {
  const tabs = read(TABS);
  assert.match(tabs, /const active = tab\.exact \? pathname === tab\.url : isActivePath\(pathname, tab\.url\);/, "the sidebar's active rule");
  assert.match(tabs, /data-active=\{active\}/, "the state is on the element");
  assert.match(tabs, /aria-current=\{active \? "page" : undefined\}/, "and told to a screen reader");
  // The rule the line above encodes, run on real paths: Tables (exact) stays unmarked on its admin sub-pages.
  const lights = (url: string, exact: boolean, pathname: string): boolean => (exact ? pathname === url : isActivePath(pathname, url));
  assert.equal(lights("/pos", false, "/pos"), true, "/pos marks New order");
  assert.equal(lights("/tables", true, "/tables"), true, "/tables marks Tables");
  assert.equal(lights("/tables", true, "/tables/setup"), false, "exact keeps Tables unmarked on Setup / QR codes");
  assert.equal(lights("/tables", false, "/tables/setup"), true, "landmark: without exact, Setup would mark Tables");
});

test("PIN: every dashboard screen gets the two buttons — the shared Header renders them, and only two of them", () => {
  const header = read(HEADER);
  assert.ok(header.includes('import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";'), "the header imports them");
  assert.equal(header.split("<HeaderQuickTabs />").length - 1, 1, "rendered once");
  const tabs = read(TABS);
  assert.equal(tabs.split("{ title: ").length - 1, 2, "exactly the two buttons the owner asked for");
});

test("PIN: on a phone Tables hides (the tab bar has Floor) and New order shows only its plus (values 2.5)", () => {
  const tabs = read(TABS);
  assert.match(tabs, /tab\.primary \? "inline-flex" : "hidden tab:inline-flex"/, "Tables is hidden below 720px, New order always shows");
  assert.match(tabs, /<span className="hidden tab:inline">\{tab\.title\}<\/span>/, "the label shows from 720px");
  assert.match(tabs, /aria-label=\{tab\.title\}/, "the plus alone still has a name");
});
