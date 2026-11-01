// U5 Task 1 (2026-11-01): the Menu's frame, header, switch, toolbar, rail and states, the owner's HTML Menu screen
// (docs/superpowers/specs/2026-10-31-menu-printer-html-values.md 0.2, 0.3, 1.2, 2, 3, 4; design
// docs/superpowers/specs/2026-10-31-menu-printer-match-html-design.md 5, 6.1-6.3, 6.8; owner Q1, Q5, Q8). Pure pins on
// lib/menu-layout.ts, renders of the quick links, the switch, the rail and the select on the Menu routes, then source
// pins on the markup (both pages, the header, the toast set, the title words).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { stripComments } from "./source-pin-utils";
import { POS_PAGE_CLASS } from "./pos-layout";
import { classesOf, tagOf, tagsOf } from "./class-tags.fixtures";
import {
  MENU_ADD_CLASS,
  MENU_BODY_CLASS,
  MENU_EMPTY_BOX_CLASS,
  MENU_LIST_SCROLLER_CLASS,
  MENU_PAGE_CLASS,
  MENU_RAIL_CLASS,
  MENU_RAIL_ROW_CLASS,
  MENU_RAIL_ROW_ON_CLASS,
  MENU_SELECT_TRIGGER_CLASS,
  MENU_VIEW_SWITCH_CLASS,
  isMenuPagePath,
} from "./menu-layout";
import { pageTitleFor } from "./page-titles";
import { toasterPropsFor, FLOOR_TOASTER_PROPS } from "@/components/layout/AppToaster";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { MenuViewSwitch } from "@/components/menu/MenuViewSwitch";
import { CategoryRail } from "@/components/menu/CategoryRail";
import type { Category } from "@/types";

(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

test("isMenuPagePath: /products and /categories and what is below them, nothing else", () => {
  for (const p of ["/products", "/products/", "/categories", "/categories/", "/products/x"]) assert.equal(isMenuPagePath(p), true, `${p} is a Menu page`);
  for (const p of ["/", "/pos", "/productsx", "/categoriesx", "/orders", "/kitchen", "/settings/products", ""]) assert.equal(isMenuPagePath(p), false, `${p} is not`);
});

test("the frame (design 5): the POS page's height under the shell, a flex column that never scrolls itself, the page box is the query container", () => {
  assert.ok(MENU_PAGE_CLASS.includes(POS_PAGE_CLASS), "built on POS_PAGE_CLASS");
  hasAll(MENU_PAGE_CLASS, ["flex", "flex-col", "overflow-hidden", "@container/menu"], "MENU_PAGE_CLASS");
  // The 240px rail track from a 1000px page box (values 0.2 rail), else one column; the body fills the page.
  hasAll(MENU_BODY_CLASS, ["grid", "min-h-0", "flex-1", "grid-cols-[minmax(0,1fr)]", "@[1000px]/menu:grid-cols-[240px_minmax(0,1fr)]"], "MENU_BODY_CLASS");
  assert.ok(!tokens(MENU_BODY_CLASS).includes("@container/menu"), "the container is the page: a container cannot query itself, so the body grid could never see it");
});

test("the list column is the page's only scroller (design 5; values 0.3 pagePad, screenPadB): the HTML's paddings, the inset, U3's 8px bar", () => {
  hasAll(
    MENU_LIST_SCROLLER_CLASS,
    [
      "flex", "flex-col", "gap-3", "min-h-0", "min-w-0", "overflow-y-auto", "overflow-x-clip",
      "pt-5", "px-6", "pb-[calc(28px+env(safe-area-inset-bottom))]",
      "max-tab:pt-4", "max-tab:px-3.5", "max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]",
      "[&::-webkit-scrollbar]:w-2", "[&::-webkit-scrollbar]:h-0", "[&::-webkit-scrollbar-thumb]:rounded-[8px]", "[&::-webkit-scrollbar-thumb]:bg-border",
    ],
    "MENU_LIST_SCROLLER_CLASS",
  );
  assert.ok(!tokens(MENU_LIST_SCROLLER_CLASS).includes("overflow-x-hidden"), "pure clipping is overflow: clip (WebView 109 rule)");
});

test("the rail (values 3): 240px incl. its border from a 1000px page, own scroller, rows 36px that never shrink, the chosen row's tint", () => {
  hasAll(MENU_RAIL_CLASS, ["hidden", "@[1000px]/menu:flex", "flex-col", "min-h-0", "overflow-y-auto", "border-r", "border-border", "bg-card", "px-2.5", "py-3"], "MENU_RAIL_CLASS");
  hasAll(MENU_RAIL_ROW_CLASS, ["h-9", "flex-none", "w-full", "rounded-[8px]", "px-2.5", "text-[13.5px]", "pointer-fine:hover:bg-hover"], "MENU_RAIL_ROW_CLASS");
  hasAll(MENU_RAIL_ROW_ON_CLASS, ["bg-status-info-tint", "text-status-info-ink", "font-semibold"], "the chosen row (HTML --accent-t / --accent-i / 600)");
});

test("the view switch (values 2): a 36px track, links to /products and /categories, the current one lit with aria-current, the label hidden below 720", () => {
  hasAll(MENU_VIEW_SWITCH_CLASS, ["flex", "h-9", "gap-0.5", "rounded-[9px]", "bg-surface-3", "p-[3px]"], "MENU_VIEW_SWITCH_CLASS");
  for (const current of ["items", "categories"] as const) {
    const html = renderToStaticMarkup(createElement(MenuViewSwitch, { current }));
    assert.equal(tagsOf(html, "menu-view-switch").length, 1, `${current}: one switch`);
    const items = tagOf(html, "menu-view-items");
    const cats = tagOf(html, "menu-view-categories");
    assert.ok(items.includes('href="/products"') && cats.includes('href="/categories"'), `${current}: the two routes stay the two links`);
    const on = current === "items" ? items : cats;
    const off = current === "items" ? cats : items;
    assert.ok(on.includes('aria-current="page"') && !off.includes("aria-current"), `${current}: only the current link carries aria-current`);
    hasAll(classesOf(on).join(" "), ["bg-seg", "font-semibold!", "text-foreground"], `${current}: the lit link (SEG_ON, 600, --text)`);
    assert.ok(classesOf(off).includes("text-muted-foreground") && !classesOf(off).includes("bg-seg"), `${current}: the other is plain --text-2`);
    assert.match(html, /<span class="max-tab:hidden">(Items|Categories)<\/span>/, `${current}: labels hidden below 720 (values 0.3 viewLblD)`);
  }
});

test("Add (values 2): the accent button with the HTML's sizes; the kit select trigger takes the HTML's 38px look", () => {
  hasAll(MENU_ADD_CLASS, ["h-9", "gap-1.5", "px-3.5", "text-[13.5px]", "font-semibold", "bg-primary"], "MENU_ADD_CLASS");
  hasAll(MENU_SELECT_TRIGGER_CLASS, ["h-[38px]", "w-full", "rounded-[9px]", "border", "border-border", "bg-card", "text-[13.5px]", "font-medium", "pl-[34px]", "pr-8"], "MENU_SELECT_TRIGGER_CLASS");
  hasAll(MENU_EMPTY_BOX_CLASS, ["rounded-[14px]", "border-[1.5px]", "border-dashed", "border-border", "bg-card", "py-14", "px-4", "text-center"], "MENU_EMPTY_BOX_CLASS (values 4.7)");
});

// ── The shell's quick links, the toasts and the title on the Menu routes (owner Q5, Q8) ───────────────────────────────

const linksAt = (pathname: string): string => renderToStaticMarkup(createElement(PathnameContext.Provider, { value: pathname }, createElement(HeaderQuickTabs)));

test("on /products and /categories the shell's Tables and New order are drawn from 1280px only (owner Q8, the /kitchen rule); Q5: no New order on the phone", () => {
  for (const at of ["/products", "/categories", "/products/", "/categories/"]) {
    const html = linksAt(at);
    for (const name of ["header-tables", "header-new-order"]) {
      const have = classesOf(tagOf(html, name));
      assert.ok(have.includes("hidden") && have.includes("xl:inline-flex"), `${at}: ${name} is hidden below 1280px (got "${have.join(" ")}")`);
      assert.ok(!have.includes("inline-flex") && !have.includes("tab:inline-flex"), `${at}: ${name} never shows below 1280px`);
    }
  }
  assert.ok(classesOf(tagOf(linksAt("/orders"), "header-new-order")).includes("inline-flex"), "another page keeps its rule");
});

test("the Menu routes take the /tables + /kitchen toast set (each offset plus the bottom inset); both are titled Menu", () => {
  assert.equal(toasterPropsFor("/products"), FLOOR_TOASTER_PROPS, "/products: the inset set");
  assert.equal(toasterPropsFor("/categories"), FLOOR_TOASTER_PROPS, "/categories: the inset set");
  assert.notEqual(toasterPropsFor("/customers"), FLOOR_TOASTER_PROPS, "landmark: another page keeps the staff set");
  assert.equal(pageTitleFor("/products"), "Menu", "/products");
  assert.equal(pageTitleFor("/categories"), "Menu", "/categories");
});

// ── The rail, rendered ───────────────────────────────────────────────────────────────────────────────────────────────

const CATS = [
  { _id: "c1", name: "Starters", order: 1 },
  { _id: "c2", name: "Mains", order: 2 },
] as Category[];

test("CategoryRail: All items then the categories in their arranged order, the chosen row tinted, sold-out chip and count per row", () => {
  const counts = new Map([["c1", { items: 4, soldOut: 0 }], ["c2", { items: 7, soldOut: 2 }]]);
  const html = renderToStaticMarkup(createElement(CategoryRail, { categories: CATS, counts, allCount: 11, allSoldOut: 2, selectedId: "c2", onSelect: () => undefined }));
  const rows = tagsOf(html, "menu-rail-row");
  assert.equal(rows.length, 3, "All items + 2 categories");
  assert.ok(!classesOf(rows[0]).includes("bg-status-info-tint"), "All items is not chosen");
  assert.ok(classesOf(rows[2]).includes("bg-status-info-tint") && rows[2].includes('aria-pressed="true"'), "Mains is chosen");
  assert.ok(html.indexOf("Starters") < html.indexOf("Mains"), "arranged order");
  assert.equal(tagsOf(html, "menu-rail-soldout").length, 2, "a sold-out chip on All items and on Mains only");
  assert.ok(html.includes('title="2 sold out"'), "the chip's title (values 3)");
  assert.match(html, /<span[^>]*>11<\/span>/, "the All items count");
  assert.ok(html.includes('aria-label="Categories"'), "the aside is named");
});

// ── Source pins: the markup that uses them ────────────────────────────────────────────────────────────────────────────

test("PIN: both pages render the Menu frame and no paper shell; every select on these screens is the kit dropdown", () => {
  for (const file of ["app/(dashboard)/products/page.tsx", "app/(dashboard)/categories/page.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("MENU_PAGE_CLASS"), `${file}: the Menu frame`);
    assert.ok(!src.includes("MenuPageShell"), `${file}: the paper frame has left (design 5)`);
  }
  const toolbar = read("components/menu/ItemsToolbar.tsx");
  assert.ok(!/<select\b/.test(toolbar), "no native select in the toolbar");
  const select = read("components/menu/MenuSelect.tsx");
  assert.ok(select.includes("@/components/ui/select") && !/<select\b/.test(select), "MenuSelect is the kit's Select");
});

test("PIN: the header is the one MenuPageHeader on both routes (title Menu, phone floor 64px), admin-only actions; the toolbar holds the search, selects and Import CSV", () => {
  const header = read("components/menu/MenuPageHeader.tsx");
  assert.match(header, /title="Menu"/, "title Menu");
  assert.match(header, /phoneTitleMinPx=\{64\}/, "owner Q5: the title keeps 64px beside the switch and Add on a phone");
  assert.match(header, /actions=\{isAdmin && \(/, "staff get no actions, as today");
  assert.ok(!header.includes("eyebrow"), "the eyebrow goes (menu P7 / P62 / P63 move on purpose)");
  for (const file of ["app/(dashboard)/products/page.tsx", "app/(dashboard)/categories/page.tsx"]) {
    assert.match(read(file), /<MenuPageHeader\b/, `${file}: through the shared header`);
  }
  const toolbar = read("components/menu/ItemsToolbar.tsx");
  for (const word of ["Search items", "Clear search", "Import CSV", "All categories", "All items", "In stock", "Sold out", "Hidden on QR menu"]) {
    assert.ok(toolbar.includes(word) || read("lib/menu-view.ts").includes(word), `the HTML's word "${word}" is drawn`);
  }
  assert.match(toolbar, /isAdmin/, "Import CSV and Archived stay admin-only");
});

test("PIN: Archived round trip (review focus 1): the header line reads the ACTIVE list from the cache in the Archived view, with no new query", () => {
  const state = read("hooks/use-items-page-state.ts");
  assert.match(state, /getQueryData<Product\[\]>\(PRODUCT_KEYS\.all\)/, "the active list is read from the query cache");
  assert.ok(!/useProducts\(\s*\)/.test(state), "no second products query is opened for it");
  assert.match(state, /useEffect\(\(\) => setSelected\(new Set\(\)\), \[view\]\);/, "the selection clears on each view switch");
});
