import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { isActivePath } from "./nav-active";

// 2026-10-11 (owner, PetPooja-style): the top bar's "New Order" and "Tables" tabs. They must open exactly the pages the
// sidebar's New Order and Floor rows open, light the same way, and sit in the header every dashboard screen renders.

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const TABS = "components/layout/HeaderQuickTabs.tsx";
const SIDEBAR = "components/layout/AppSidebar.tsx";
const HEADER = "components/layout/Header.tsx";

const NEW_ORDER_TAB = '{ title: "New Order", url: "/pos", icon: ShoppingCart }';
const TABLES_TAB = '{ title: "Tables", url: "/tables", icon: LayoutGrid, exact: true }';
const SIDEBAR_NEW_ORDER = '{ title: "New Order", url: "/pos", icon: ShoppingCart }';
const SIDEBAR_FLOOR = '{ title: "Floor", url: "/tables", icon: LayoutGrid, exact: true }';

function tabsMatchSidebar(tabs: string, sidebar: string): boolean {
  return tabs.includes(NEW_ORDER_TAB) && tabs.includes(TABLES_TAB) && sidebar.includes(SIDEBAR_NEW_ORDER) && sidebar.includes(SIDEBAR_FLOOR);
}

test("PIN: New Order opens /pos and Tables opens the Floor (/tables, exact) — the sidebar's own two rows", () => {
  const tabs = read(TABS);
  const sidebar = read(SIDEBAR);
  assert.equal(tabsMatchSidebar(tabs, sidebar), true);
  // Vision guard: a drifted target on either side flips it.
  assert.equal(tabsMatchSidebar(tabs.replace('url: "/tables", icon: LayoutGrid', 'url: "/tables/setup", icon: LayoutGrid'), sidebar), false);
  assert.equal(tabsMatchSidebar(tabs, sidebar.replace('{ title: "Floor", url: "/tables"', '{ title: "Floor", url: "/floor"')), false);
  assert.equal(tabsMatchSidebar(tabs.replace(NEW_ORDER_TAB, '{ title: "New Order", url: "/orders", icon: ShoppingCart }'), sidebar), false);
});

test("PIN: a tab lights like the sidebar — New Order on /pos and its sub-pages, Tables on /tables only", () => {
  const tabs = read(TABS);
  assert.match(tabs, /const active = tab\.exact \? pathname === tab\.url : isActivePath\(pathname, tab\.url\);/);
  assert.match(tabs, /data-active=\{active\}/);
  assert.match(tabs, /aria-current=\{active \? "page" : undefined\}/);
  // The rule the line above encodes, run on real paths: Tables (exact) stays dark on its admin sub-pages.
  const lights = (url: string, exact: boolean, pathname: string): boolean => (exact ? pathname === url : isActivePath(pathname, url));
  assert.equal(lights("/pos", false, "/pos"), true);
  assert.equal(lights("/tables", true, "/tables"), true);
  assert.equal(lights("/tables", true, "/tables/setup"), false, "exact keeps Tables dark on Setup / QR codes");
  assert.equal(lights("/tables", false, "/tables/setup"), true, "landmark: without exact, Setup would light Tables");
});

test("PIN: every dashboard screen gets the tabs — the shared Header renders them, and only two of them", () => {
  const header = read(HEADER);
  assert.ok(header.includes('import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";'));
  assert.equal(header.split("<HeaderQuickTabs />").length - 1, 1, "rendered once");
  const tabs = read(TABS);
  assert.equal(tabs.split("{ title: ").length - 1, 2, "exactly the two tabs the owner asked for");
});

test("PIN: a tab may shrink below its label width (min-w-0 + shrink), so a narrow bar truncates instead of overflowing", () => {
  // s89f review: the nav's [contain:inline-size] keeps the header from widening, but without min-w-0 + shrink on each
  // Link its automatic minimum is the full label, the span never truncates, and the links paint over Token / Refresh.
  const tabs = read(TABS);
  const classOf = (src: string): string => src.match(/const TAB_CLASS =\s*([\s\S]*?);\n/)?.[1] ?? "";
  // Whole class tokens only: "shrink" must not be satisfied by the icon's own "[&>svg]:shrink-0".
  const tokensOf = (src: string): string[] => classOf(src).split(/[\s"+]+/).filter(Boolean);
  const holds = (src: string): boolean => tokensOf(src).includes("min-w-0") && tokensOf(src).includes("shrink");
  assert.ok(classOf(tabs).length > 0, "landmark: TAB_CLASS was read");
  assert.equal(holds(tabs), true);
  assert.equal(holds(tabs.replace("h-9 min-w-0 shrink", "h-9 shrink")), false, "vision guard: dropping min-w-0 flips it");
  assert.equal(holds(tabs.replace("h-9 min-w-0 shrink", "h-9 min-w-0")), false, "vision guard: dropping shrink flips it");
});
