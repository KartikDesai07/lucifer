// U0 Task 4: the phone's tab bar (the owner's HTML, values 2.6; design 5.4) and the More sheet's destinations (values
// 2.7): Home, Floor, Order, Orders and More for both roles; every other allowed page in the More grid, in the nav's
// order, a page with sub-pages listing them; the tabs lit like the HTML (accent on the current route, More on any
// page it holds). The nav's own data (components/layout/AppSidebar.tsx) is the one source: rows, filters, groups.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import { MENU_SECTIONS } from "@/lib/menu-sections";
import { TABLES_MANAGE_SECTIONS } from "@/lib/table-sections";
import { REPORT_SECTIONS, reportSectionPath } from "@/lib/report-sections";
import { VISIBLE_SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import { NAV_SECTIONS } from "@/components/layout/AppSidebar";
import { TAB_BAR_ITEMS, TabBarNav, isMoreActive, isMoreItemActive, isTabActive, moreItemsFor } from "@/components/layout/TabBar";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const ADMIN_ONLY_URLS = ["/tables/setup", "/staff", "/reports", "/printers", "/settings"];

// ── The four tabs ────────────────────────────────────────────────────────────

test("the tab bar's four tabs are the HTML's Home, Floor, Order, Orders, at our routes, in that order", () => {
  assert.deepEqual(
    TAB_BAR_ITEMS.map((t) => [t.title, t.url]),
    [
      ["Home", "/"],
      ["Floor", "/tables"],
      ["Order", "/pos"],
      ["Orders", "/orders"],
    ],
    "Home /, Floor /tables, Order /pos, Orders /orders",
  );
});

test("the tabs are the nav's own rows (one source for the words and the glyphs)", () => {
  const navItems = NAV_SECTIONS.flatMap((s) => s.items);
  for (const tab of TAB_BAR_ITEMS) {
    assert.ok(navItems.includes(tab), `the ${tab.title} tab is the nav's own ${tab.url} row, not a copy`);
    assert.ok(!tab.adminOnly && !tab.tokensOnly, `the ${tab.title} tab is open to both roles`);
  }
});

test("the active colour rule: a tab lights on its own route (Floor on /tables only, Home on / only)", () => {
  const lit = (pathname: string) => TAB_BAR_ITEMS.filter((t) => isTabActive(t, pathname)).map((t) => t.title);
  assert.deepEqual(lit("/"), ["Home"], "/ lights Home");
  assert.deepEqual(lit("/tables"), ["Floor"], "/tables lights Floor");
  assert.deepEqual(lit("/tables/setup"), [], "the tables setup page is not the Floor");
  assert.deepEqual(lit("/pos"), ["Order"], "/pos lights Order");
  assert.deepEqual(lit("/orders/65f0c0ffee"), ["Orders"], "an order's page lights Orders");
  assert.deepEqual(lit("/orders-archive"), [], "a sibling that shares a prefix lights nothing");
  assert.deepEqual(lit("/kitchen"), [], "the Kitchen is not a tab");
});

test("More lights on any page the More sheet holds (and its sub-pages), never on a tab's page", () => {
  const admin = moreItemsFor("admin", true);
  for (const pathname of ["/kitchen", "/requests", "/reports/sales", "/settings", "/settings/receipt", "/tables/setup", "/tables/qr", "/categories", "/customers/festival-cards", "/now-serving"]) {
    assert.equal(isMoreActive(pathname, admin), true, `More is lit on ${pathname}`);
  }
  for (const pathname of ["/", "/tables", "/pos", "/orders", "/orders/abc"]) {
    assert.equal(isMoreActive(pathname, admin), false, `More is not lit on ${pathname}`);
  }
  const reports = admin.find((m) => m.url === "/reports");
  assert.ok(reports, "landmark: an admin's More holds Reports");
  assert.equal(isMoreItemActive(reports!, "/reports/gst"), true, "the Reports tile lights on a report");
  assert.equal(isMoreItemActive(reports!, "/kitchen"), false, "and not elsewhere");
});

// ── The More sheet's destinations ────────────────────────────────────────────

test("moreItemsFor(staff): every page staff may open that is not a tab, in the nav's order, and no admin-only page", () => {
  const staff = moreItemsFor("staff", false);
  assert.deepEqual(
    staff.map((m) => m.url),
    ["/requests", "/kitchen", "/reservations", "/products", "/customers", "/expenses", "/events"],
    "Order Requests, Kitchen, Reservations, Menu, Customers, Expenses, Events",
  );
  for (const url of ADMIN_ONLY_URLS) assert.ok(!staff.some((m) => m.url === url), `staff never see ${url}`);
  assert.ok(!staff.some((m) => m.url === "/now-serving"), "Now Serving only while tokens are on");
  const menu = staff.find((m) => m.url === "/products");
  assert.deepEqual(menu?.sub, [], "staff see one Menu page (Items), so the tile opens it directly");
  assert.equal(staff.find((m) => m.url === "/reservations")?.title, "Reservations", "the HTML's More grid says Reservations");
});

test("moreItemsFor(admin): the nav's rows minus the four tabs; Now Serving follows the token switch", () => {
  const admin = moreItemsFor("admin", true);
  const navUrls = NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.url);
  const tabUrls = TAB_BAR_ITEMS.map((t) => t.url);
  assert.deepEqual(
    admin.map((m) => m.url),
    navUrls.filter((u) => !tabUrls.includes(u)),
    "every nav row except the tabs, in the nav's order",
  );
  for (const url of ADMIN_ONLY_URLS) assert.ok(admin.some((m) => m.url === url), `an admin's More holds ${url}`);
  assert.ok(admin.some((m) => m.url === "/now-serving"), "Now Serving while tokens are on");
  assert.ok(!moreItemsFor("admin", false).some((m) => m.url === "/now-serving"), "and not while they are off");
  for (const item of admin) {
    assert.ok(!tabUrls.includes(item.url), `${item.title} is not also a tab`);
  }
});

test("a group tile lists its sub-pages (Menu, Tables, Reports, Settings), from the same lists the nav reads", () => {
  const admin = moreItemsFor("admin", true);
  const sub = (url: string) => admin.find((m) => m.url === url)?.sub.map((s) => [s.title, s.href]);
  assert.deepEqual(sub("/products"), MENU_SECTIONS.map((s) => [s.title, s.href]), "Menu: Items, Categories");
  assert.deepEqual(sub("/tables/setup"), TABLES_MANAGE_SECTIONS.map((s) => [s.title, s.href]), "Tables: Setup, QR codes");
  assert.deepEqual(sub("/reports"), REPORT_SECTIONS.map((s) => [s.title, reportSectionPath(s.slug)]), "Reports: every report");
  assert.deepEqual(
    sub("/settings"),
    VISIBLE_SETTINGS_SECTIONS.map((s) => [s.title, settingsSectionPath(s.slug)]),
    "Settings: every visible section",
  );
  for (const url of ["/requests", "/kitchen", "/customers", "/staff", "/printers"]) {
    assert.deepEqual(sub(url), [], `${url} is a plain tile`);
  }
});

// ── The bar itself ───────────────────────────────────────────────────────────

function renderBar(pathname: string, moreActive = false): string {
  return renderToStaticMarkup(createElement(TabBarNav, { pathname, moreActive, moreOpen: false, onMore: () => {} }));
}

test("render: four tab links and the More button, the current tab in the accent colour, the rest in --text-2", () => {
  const html = renderBar("/orders");
  const tabs = [...html.matchAll(/<a\b[^>]*data-ui="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 4, `four tab links (got ${tabs.length})`);
  const orders = tabs.find((t) => t.includes('href="/orders"'));
  assert.ok(orders, "landmark: the Orders tab");
  assert.match(orders!, /aria-current="page"/, "the current tab announces the page");
  assert.match(orders!, /data-active="true"/, "and is lit");
  for (const t of tabs.filter((x) => x !== orders)) {
    assert.match(t, /data-active="false"/, "the other tabs are not lit");
    assert.ok(!t.includes("aria-current"), "and announce nothing");
  }
  assert.match(orders!, /\btext-muted-foreground\b/, "a tab is --text-2 (#52525B) at rest");
  assert.match(orders!, /data-\[active=true\]:text-primary/, "and --accent (#0F62FE) when lit");
  assert.match(orders!, /\bh-14\b/, "56px tall");
  assert.match(orders!, /gap-\[3px\]/, "3px between the glyph and the label");
  assert.match(orders!, /text-\[11px\]/, "11px labels");
  assert.match(orders!, /\bfont-medium\b/, "weight 500");
});

test("render: the More button is a button named More that opens the sheet, lit on a page the sheet holds", () => {
  const more = /<button\b[^>]*data-ui="tab-more"[^>]*>([\s\S]*?)<\/button>/.exec(renderBar("/kitchen", true));
  assert.ok(more, "the More button renders");
  assert.match(more![0], /type="button"/, "a plain button");
  assert.match(more![0], /aria-haspopup="dialog"/, "it opens a dialog (the More sheet)");
  const text = more![1].replace(/<[^>]+>/g, "").trim();
  assert.equal(text, "More", "its accessible name is More");
  assert.match(more![0], /data-active="true"/, "lit while the current page is one of its pages");
  assert.match(/<button\b[^>]*data-ui="tab-more"[^>]*>/.exec(renderBar("/"))![0], /data-active="false"/, "not lit on Home");
});

test("render: the bar is the HTML's glass strip (fixed, 5 columns, border-top, 2px top padding, phone only)", () => {
  const nav = /<nav\b[^>]*data-ui="tab-bar"[^>]*>/.exec(renderBar("/"))?.[0] ?? "";
  assert.ok(nav.length > 0, "the bar is a <nav>");
  for (const cls of ["fixed", "inset-x-0", "bottom-0", "z-[12]", "grid", "grid-cols-5", "border-t", "border-border", "bg-glass", "pt-0.5", "pb-[env(safe-area-inset-bottom)]", "tab:hidden"]) {
    assert.ok(nav.split(/[\s"]/).includes(cls), `the bar carries ${cls}`);
  }
  assert.ok(nav.includes("[backdrop-filter:saturate(180%)_blur(20px)]"), "the HTML's backdrop filter, in the HTML's order");
  assert.match(nav, /aria-label="Main"/, "the phone's main navigation (the side nav is hidden below 720px)");
});

// ── Where it mounts, and what it replaces ────────────────────────────────────

test("PIN: the dashboard layout mounts one tab bar, and a phone's page keeps 92px clear at its foot (values 2.1 screenPadB)", () => {
  const layout = read("app/(dashboard)/layout.tsx");
  assert.equal(count(layout, "<TabBar />"), 1, "one <TabBar />");
  assert.match(layout, /import \{ TabBar \} from "@\/components\/layout\/TabBar";/, "imported from components/layout/TabBar");
  const master = [layout.indexOf("<MasterDataProvider>"), layout.indexOf("</MasterDataProvider>")];
  const bar = layout.indexOf("<TabBar />");
  assert.ok(master[0] < bar && bar < master[1], "inside the master-data provider (it reads the role and the settings)");
  assert.match(layout, /<main className="flex-1 p-4 pb-\[92px\] tab:pb-4 md:p-6">/, "the page's foot clears the 59px bar by 33px on a phone");
});

test("PIN: nothing on a phone opens the old nav sheet any more (the header's menu button and the sheet are gone)", () => {
  const header = read("components/layout/Header.tsx");
  assert.ok(!header.includes("PhoneMenuButton"), "no menu button in the header");
  assert.ok(!header.includes("setOpenMobile"), "the header opens nothing");
  const sidebar = read("components/ui/sidebar.tsx");
  assert.ok(!/<Sheet\b/.test(sidebar), "the nav renders no sheet");
  assert.match(sidebar, /if \(isMobile\) return null;/, "below 720px the nav renders nothing (the tab bar takes over)");
});
