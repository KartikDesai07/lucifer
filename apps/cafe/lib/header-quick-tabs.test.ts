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
// current page the same way, and sit in the header every dashboard screen renders — but /pos (U1: none) and /tables
// (U3 Task 1, owner Q1 2026-10-28: Tables is that page, so only New order, in the HTML Floor button's look).

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

// Moved on purpose (U3 Task 1; owner Q1 2026-10-28, design 4 and 6.9): "every dashboard screen gets both buttons"
// becomes "every one but /pos and /tables" — the Floor does not link to itself. The pair itself stays exactly two.
test("PIN: every dashboard screen but /pos and /tables gets the two buttons — the shared Header renders them, and only two of them", () => {
  const header = read(HEADER);
  assert.ok(header.includes('import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";'), "the header imports them");
  assert.equal(header.split("<HeaderQuickTabs />").length - 1, 1, "rendered once");
  const tabs = read(TABS);
  assert.equal(tabs.split("{ title: ").length - 1, 2, "exactly the two buttons the owner asked for");
  // The two exceptions, and nothing else: /pos draws none (U1), /tables leaves out Tables only (Q1). The rendered
  // behaviour on real paths is pinned in lib/floor-layout.test.ts.
  assert.match(tabs, /if \(isPosPath\(pathname\)\) return null;/, "none on /pos");
  assert.match(tabs, /if \(floor && tab\.url === FLOOR_PATH\) return null;/, "Tables is not drawn on /tables");
  assert.equal(tabs.split("return null;").length - 1, 2, "no other page drops a button");
});

// U2 Task 1 (Orders values 1.2, design 6.1): the HTML's Orders header keeps New order's label on the phone too, so on
// /orders the label shows at every width; U3 Task 1 (Floor values 1.2, owner Q1) the same on /tables. Every other page
// keeps U0's plus alone below 720px.
// Moved on purpose (U4 Task 1; owner Q8 2026-10-30, Kitchen design 6.1): on /kitchen both links keep today's look and
// place from 1280px (the owner's PC width) and are not drawn below it (tablets and phones). The rendered behaviour is
// pinned in lib/kitchen-layout.test.ts.
test("PIN: on a phone Tables hides (the tab bar has Floor) and New order shows only its plus (values 2.5), except on /orders and /tables; on /kitchen both show from 1280px only", () => {
  const tabs = read(TABS);
  assert.match(tabs, /import \{ isKitchenPath \} from "@\/lib\/kitchen-layout";/, "the quick links read the Kitchen's route through isKitchenPath");
  assert.match(tabs, /const kitchen = isKitchenPath\(pathname\);/, "one flag for the Kitchen");
  assert.match(
    tabs,
    /kitchen \? "hidden xl:inline-flex" : tab\.primary \? "inline-flex" : "hidden tab:inline-flex"/,
    "on /kitchen both from 1280px only (Q8); elsewhere Tables is hidden below 720px, New order always shows",
  );
  assert.match(tabs, /const labelClass = isOrdersPath\(pathname\) \|\| floor \? "inline" : "hidden tab:inline";/, "the label shows from 720px, and at every width on /orders and /tables");
  assert.match(tabs, /<span className=\{labelClass\}>\{tab\.title\}<\/span>/, "the label takes that class");
  assert.match(tabs, /aria-label=\{tab\.title\}/, "the plus alone still has a name");
});
