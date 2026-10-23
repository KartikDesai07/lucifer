// U2 Task 1 (2026-10-23): the /orders page frame and the shell header's /orders variant, the owner's HTML Orders screen
// (docs/superpowers/specs/2026-10-22-orders-html-values.md: values 1 header, 2 body grid and list column, 21.1 regions;
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md 5 layout, 6.1 header). Pure pins on lib/orders-layout.ts,
// then source pins on the markup that renders it (the page, the header, the header's quick links).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { POS_PAGE_CLASS } from "./pos-layout";
import {
  ORDERS_BODY_CLASS,
  ORDERS_DETAIL_COLUMN_CLASS,
  ORDERS_LIST_COLUMN_CLASS,
  ORDERS_PAGE_CLASS,
  ORDERS_SCROLLER_CLASS,
  ORDERS_TOP_CLASS,
  isOrdersPath,
} from "./orders-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

const PAGE = "app/(dashboard)/orders/page.tsx";
const HEADER = "components/layout/Header.tsx";
const QUICK_TABS = "components/layout/HeaderQuickTabs.tsx";

function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

/** Each needle must appear, in this order. */
function inOrder(src: string, needles: string[], what: string): void {
  let last = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle, last + 1);
    assert.ok(at > last, `${what}: "${needle}" must come after the previous landmark`);
    last = at;
  }
}

// ── The route ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("isOrdersPath: /orders and the pages below it, never a path that only starts with the letters", () => {
  assert.equal(isOrdersPath("/orders"), true, "/orders is the Orders page");
  assert.equal(isOrdersPath("/orders/"), true, "a trailing slash is still the Orders page");
  assert.equal(isOrdersPath("/orders/x"), true, "a page below /orders takes its header too");
  assert.equal(isOrdersPath("/orders-x"), false, "/orders-x is another page");
  assert.equal(isOrdersPath("/ordersx"), false, "/ordersx is another page");
  assert.equal(isOrdersPath("/order"), false, "a shorter path is another page");
  assert.equal(isOrdersPath("/requests"), false, "Order Requests is another page");
  assert.equal(isOrdersPath("/pos"), false, "the POS is not Orders");
  assert.equal(isOrdersPath("/"), false, "the dashboard is not Orders");
  assert.equal(isOrdersPath(""), false, "an unknown path is not Orders");
});

// ── The frame's classes (values 1.1, 2.1, 2.2; design 5) ─────────────────────────────────────────────────────────

test("ORDERS_PAGE_CLASS: the /pos page frame (fills the screen under the header, <main>'s padding bled) as a flex column that never scrolls", () => {
  assert.ok(ORDERS_PAGE_CLASS.startsWith(POS_PAGE_CLASS), "it reuses POS_PAGE_CLASS whole (design 5: the page fills the screen like /pos)");
  hasAll(ORDERS_PAGE_CLASS, tokens(POS_PAGE_CLASS), "every POS_PAGE_CLASS token");
  hasAll(ORDERS_PAGE_CLASS, ["flex", "flex-col", "overflow-hidden"], "values 1.1: display:flex; flex-direction:column; overflow:hidden");
});

test("ORDERS_BODY_CLASS: one column below 1280px, the list and the 400px detail column from 1280px (owner rule 2026-10-22)", () => {
  hasAll(ORDERS_BODY_CLASS, ["grid", "flex-1", "min-h-0", "grid-cols-[minmax(0,1fr)]", "xl:grid-cols-[minmax(0,1fr)_400px]"], "values 2.1 body");
  const cols = tokens(ORDERS_BODY_CLASS).filter((t) => t.includes("grid-cols-"));
  assert.deepEqual(cols, ["grid-cols-[minmax(0,1fr)]", "xl:grid-cols-[minmax(0,1fr)_400px]"], "no column set at any other width: below 1280px the detail is never a column");
});

// The verification fix (V-A, classic scrollbars; moved on purpose): the list's form is measured on the list COLUMN, a
// named container outside the list scroller (components/orders/OrderTable.tsx reads `@…/list`), so a classic (Windows,
// Electron) scrollbar in the scroller can never narrow what is measured; the thresholds add the scroller's side padding
// back (lib/orders-list-view.test.ts).
test("ORDERS_LIST_COLUMN_CLASS: the named container `list` (the list's form follows the column's width, values 0.2), a flex column that may shrink", () => {
  hasAll(ORDERS_LIST_COLUMN_CLASS, ["@container/list", "flex", "flex-col", "min-w-0", "min-h-0"], "values 2.2 list column");
  assert.ok(!tokens(ORDERS_LIST_COLUMN_CLASS).includes("@container"), "named, so the list's queries reach it past any nearer container");
  hasAll(ORDERS_LIST_COLUMN_CLASS, ["leading-[normal]"], "the HTML sets no line-height in the list column: normal");
});

// The verification fix (V-C F2; moved on purpose): in phone landscape (~862 x 390) the open Filters panel made the top
// block taller than the list column, and as `flex: none` its Reset / Done fell below the window, out of reach. It may
// shrink now and scrolls when taller than the column (the scroller's basis is 0, so the top block shrinks only then);
// wherever it fits nothing moves.
test("ORDERS_TOP_CLASS: the top block, padding 14px 20px 12px (10px 12px 12px on a phone), its parts 12px apart; it shrinks and scrolls only when taller than the list column", () => {
  hasAll(ORDERS_TOP_CLASS, ["flex", "flex-col", "gap-3", "pt-3.5", "px-5", "pb-3", "max-tab:pt-2.5", "max-tab:px-3"], "values 2.2 top block");
  hasAll(ORDERS_TOP_CLASS, ["flex-[0_1_auto]", "min-h-0", "overflow-y-auto", "overflow-x-hidden"], "flex: 0 1 auto; min-height: 0; it scrolls on its own when taller than the column (the Filters panel's Reset / Done reachable)");
  assert.ok(!tokens(ORDERS_TOP_CLASS).includes("flex-none"), "no longer flex: none (it could push the panel's foot below the window)");
});

test("ORDERS_SCROLLER_CLASS: the list scroller, padding 0 20px 28px (0 12px 92px on a phone) plus the safe-area inset at its foot", () => {
  hasAll(
    ORDERS_SCROLLER_CLASS,
    [
      "flex-1",
      "min-h-0",
      "overflow-y-auto",
      "overflow-x-hidden",
      "px-5",
      "pt-0",
      "pb-[calc(28px+env(safe-area-inset-bottom))]",
      "max-tab:px-3",
      "max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]",
    ],
    "values 2.2 list scroller (U1 P49: the window's foot adds the inset at every width)",
  );
});

test("ORDERS_DETAIL_COLUMN_CLASS: the 400px column from 1280px only, the surface with a rule on its left (values 11.1)", () => {
  hasAll(ORDERS_DETAIL_COLUMN_CLASS, ["hidden", "xl:flex", "flex-col", "min-h-0", "min-w-0", "relative", "z-[1]", "border-l", "border-border", "bg-card"], "values 11.1 column");
  assert.ok(!/(?:^|\s)(?:tab|md|lg|desk):(?:flex|block)(?=\s|$)/.test(ORDERS_DETAIL_COLUMN_CLASS), "never shown below 1280px (owner rule 2026-10-22)");
});

// ── The page (design 5, 6.1) ───────────────────────────────────────────────────────────────────────────────────────

test("the /orders page: no MenuPageShell; the frame (page, body grid, list column with its top block and scroller, the detail column)", () => {
  const src = read(PAGE);
  assert.ok(!src.includes("MenuPageShell"), "the paper frame with the 1440px cap goes (design 5)");
  assert.match(src, /import \{[^}]*\bORDERS_PAGE_CLASS\b[^}]*\} from "@\/lib\/orders-layout";/, "the frame's classes come from lib/orders-layout.ts");
  assert.match(
    src,
    /return \(\s*<div data-ui="orders-page" className=\{ORDERS_PAGE_CLASS\}>\s*<PageHeader\b/,
    "the page's return opens with the frame and the PageHeader as its first child (the header words stay in every branch)",
  );
  inOrder(
    src,
    [
      '<div data-ui="orders-body" className={ORDERS_BODY_CLASS}>',
      '<div data-ui="orders-list" className={ORDERS_LIST_COLUMN_CLASS}>',
      '<div data-ui="orders-top" className={ORDERS_TOP_CLASS}>',
      '<div data-ui="orders-scroller" className={ORDERS_SCROLLER_CLASS}>',
      '<div data-ui="orders-detail-column" className={ORDERS_DETAIL_COLUMN_CLASS}',
      "<OrderDetailSheet",
    ],
    "the frame's regions",
  );
});

test("the /orders page's PageHeader: the section, title and description, and no actions (the Today button moves into the date box, owner Q5)", () => {
  const src = read(PAGE);
  const at = src.search(/<PageHeader\b/);
  assert.ok(at >= 0, "landmark: the page has a PageHeader");
  const el = src.slice(at, src.indexOf("/>", at) + 2);
  assert.match(el, /\beyebrow="Service"/, "the section word stays");
  assert.match(el, /\btitle="Orders"/, "the title stays");
  assert.match(el, /\bdescription="View, filter and manage orders\."/, "our description is the header's second line (design 6.1)");
  assert.ok(!/\bactions=/.test(el), `no header actions on /orders (design 6.1): ${el}`);
});

// ── The header on /orders (values 1.2; design 6.1) ─────────────────────────────────────────────────────────────────

test("Header: data-orders on /orders gives the bar the HTML's 12px gap; every other page keeps U0's 10px", () => {
  const src = read(HEADER);
  assert.match(src, /import \{ isOrdersPath \} from "@\/lib\/orders-layout";/, "the header reads the route through isOrdersPath");
  assert.match(src, /const orders = isOrdersPath\(pathname\);/, "one flag for the variant");
  const tag = /<header className="([^"]*)"([^>]*)>/.exec(src);
  assert.ok(tag, "landmark: the header tag");
  assert.match(tag![2], /\bdata-orders=\{orders \? "" : undefined\}/, "the header carries data-orders on /orders");
  hasAll(tag![1], ["gap-2.5", "data-orders:gap-3"], "values 1.2: gap 12px on /orders, U0's 10px elsewhere");
});

test("HeaderQuickTabs: on /orders New order keeps its label on the phone too (values 1.2, design 6.1); Tables still hides there", () => {
  const src = read(QUICK_TABS);
  assert.match(src, /import \{ isOrdersPath \} from "@\/lib\/orders-layout";/, "the quick links read the route through isOrdersPath");
  assert.match(src, /const labelClass = isOrdersPath\(pathname\) \? "inline" : "hidden tab:inline";/, "the label at every width on /orders, from 720px elsewhere");
  assert.match(src, /<span className=\{labelClass\}>\{tab\.title\}<\/span>/, "the label takes that class");
  assert.match(src, /tab\.primary \? "inline-flex" : "hidden tab:inline-flex"/, "landmark: Tables stays hidden below 720px (the tab bar has Floor)");
});
