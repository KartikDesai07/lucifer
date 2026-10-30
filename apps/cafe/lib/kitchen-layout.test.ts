// U4 Task 1 (2026-10-30): the /kitchen frame, the board scroller and its grid, the shell header's /kitchen variant, the
// owner's HTML Kitchen screen (docs/superpowers/specs/2026-10-29-kitchen-html-values.md: values 0.2 columns, 0.3 kdPad,
// 1.1 page, 1.2 regions, 2.1-2.2 header, 6.1 board, 6.3 scrollbar; docs/superpowers/specs/2026-10-30-kitchen-match-html-
// design.md 4 Q1 / Q8 / Q10, 5 layout, 6.1 header). Pure pins on lib/kitchen-layout.ts, a render of the header's quick
// links on /kitchen, then source pins on the markup that renders them (the page, the board body, the header).
// Moved on purpose here (design 5, 6.7): P41 (`<MenuPageShell wide>`, lib/polish-pages-paths.test.ts): the page leaves the
// paper frame for its own, pinned below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// next/navigation's usePathname() reads this context (Next's own module), as lib/floor-layout.test.ts.
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { stripComments } from "./source-pin-utils";
import { POS_PAGE_CLASS } from "./pos-layout";
import { FLOOR_SCROLLER_CLASS } from "./floor-layout";
import { classesOf, tagOf, tagsOf } from "./class-tags.fixtures";
import { KITCHEN_BOARD_CLASS, KITCHEN_GRID_CLASS, KITCHEN_PAGE_CLASS, KITCHEN_PATH, isKitchenPath } from "./kitchen-layout";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { HEADER_ACTION_FLOOR_OUTLINE_CLASS, HEADER_FLOOR_NEW_ORDER_CLASS } from "@/components/layout/header-classes";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

const PAGE = "app/(dashboard)/kitchen/page.tsx";
const BODY = "components/kitchen/KitchenBoardBody.tsx";
const HEADER = "components/layout/Header.tsx";

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

test("isKitchenPath: /kitchen itself only — the kitchen-ticket settings and look-alike paths keep U0's header", () => {
  assert.equal(KITCHEN_PATH, "/kitchen", "the Kitchen's route");
  assert.equal(isKitchenPath("/kitchen"), true, "/kitchen is the Kitchen");
  assert.equal(isKitchenPath("/kitchen/"), true, "a trailing slash is still the Kitchen");
  assert.equal(isKitchenPath("/kitchenx"), false, "/kitchenx is another page");
  assert.equal(isKitchenPath("/settings/kitchen-ticket"), false, "the kitchen-ticket settings are another page");
  assert.equal(isKitchenPath("/now-serving"), false, "Now Serving is another page");
  assert.equal(isKitchenPath("/kitchen/x"), false, "nothing lives under /kitchen");
  assert.equal(isKitchenPath(""), false, "an unknown path is not the Kitchen");
});

// ── The frame (values 1.1, 0.3, 6.1, 6.3; design 5) ───────────────────────────────────────────────────────────────

test("KITCHEN_PAGE_CLASS: the /pos frame under the shell header, a flex column that never scrolls itself (values 1.1)", () => {
  assert.ok(KITCHEN_PAGE_CLASS.includes(POS_PAGE_CLASS), `the page is POS_PAGE_CLASS's frame (has "${KITCHEN_PAGE_CLASS}")`);
  hasAll(KITCHEN_PAGE_CLASS, ["flex", "flex-col", "overflow-hidden"], "values 1.1: flex column, overflow hidden (the strip above, the board below)");
});

test("KITCHEN_BOARD_CLASS: the only scroller, the HTML's kdPad with the inset on both feet, the HTML's 8px scrollbar", () => {
  hasAll(KITCHEN_BOARD_CLASS, ["min-h-0", "flex-1", "overflow-y-auto", "overflow-x-hidden", "leading-[normal]"], "values 6.1: flex 1, min-height 0, scrolls");
  hasAll(KITCHEN_BOARD_CLASS, ["pt-4", "px-5", "pb-[calc(24px+env(safe-area-inset-bottom))]"], "values 0.3 kdPad from 720px: 16px 20px 24px (U1 P49: plus the inset)");
  hasAll(
    KITCHEN_BOARD_CLASS,
    ["max-tab:pt-3", "max-tab:px-3", "max-tab:pb-[calc(84px+env(safe-area-inset-bottom))]"],
    "values 0.3 kdPad on the phone: 12px 12px calc(84px + inset)",
  );
  assert.equal(KITCHEN_BOARD_CLASS.match(/env\(safe-area-inset-bottom\)/g)?.length, 2, "both feet add the inset, nothing else does");
  const bar = tokens(FLOOR_SCROLLER_CLASS).filter((t) => t.startsWith("[&::-webkit-scrollbar"));
  assert.equal(bar.length, 4, "landmark: the Floor scroller's four scrollbar classes were read");
  hasAll(KITCHEN_BOARD_CLASS, bar, "values 6.3: the Floor scroller's 8px bar (--border thumb, radius 8, no sideways bar)");
});

/** The grid's auto-fill tracks (CSS Grid's rule): how many fit, and their width, in a board of inner width `w`. */
function tracks(w: number, min: number, gap: number): { n: number; width: number } {
  const n = Math.max(1, Math.floor((w + gap) / (min + gap)));
  return { n, width: Math.round(((w - gap * (n - 1)) / n) * 100) / 100 };
}

test("KITCHEN_GRID_CLASS: the two grids of design 5 (columns 16 / rows 10 from 1024px, 10 below), cards at their own heights", () => {
  // align-items: start exactly (values 6.1's board); Tailwind's items-start would compute flex-start.
  hasAll(KITCHEN_GRID_CLASS, ["grid", "[align-items:start]", "gap-2.5", "lg:gap-x-4", "lg:gap-y-2.5"], "design 5: gap 10 below 1024px, 16 / 10 from it; own heights");
  assert.ok(!tokens(KITCHEN_GRID_CLASS).includes("items-start"), "not items-start (flex-start), the HTML's start");
  const below = "[grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]";
  const from1024 = "lg:[grid-template-columns:repeat(auto-fill,minmax(min(320px,calc((100%_-_33px)_/_3)),1fr))]";
  hasAll(KITCHEN_GRID_CLASS, [below, from1024], "design 5: the HTML's column grid below 1024px, three-up from 1024px");
  // The literal's numbers give the HTML's cards per row at its five board widths (values 0.2 / 1.2; design 5's table).
  const lg = (w: number) => tracks(w, Math.min(320, (w - 33) / 3), 16);
  const sm = (w: number) => tracks(w, Math.min(300, w), 10);
  assert.deepEqual(lg(1008), { n: 3, width: 325.33 }, "1280, nav open: 3 x 325.33");
  assert.deepEqual(lg(1164), { n: 3, width: 377.33 }, "1280, nav collapsed: 3 x 377.33");
  assert.deepEqual(lg(908), { n: 3, width: 292 }, "1024: 3 x 292");
  assert.deepEqual(sm(704), { n: 2, width: 347 }, "820: 2 x 347");
  assert.deepEqual(sm(366), { n: 1, width: 366 }, "390: 1 x 366");
  // design 5: a 1920px wall TV adds columns instead of stretching three cards (board 1920 - nav - 40).
  assert.deepEqual(lg(1920 - 232 - 40), { n: 4, width: 400 }, "1920 with the sidebar: 4 x 400");
  assert.deepEqual(lg(1920 - 76 - 40), { n: 5, width: 348 }, "1920 with the rail: 5 x 348");
});

// ── The header's quick links on /kitchen, rendered (owner Q8; design 6.1) ─────────────────────────────────────────

const linksAt = (pathname: string): string => renderToStaticMarkup(createElement(PathnameContext.Provider, { value: pathname }, createElement(HeaderQuickTabs)));

test("on /kitchen the header's Tables and New order are drawn from 1280px only (owner Q8); every other page keeps its rule", () => {
  for (const at of ["/kitchen", "/kitchen/"]) {
    const html = linksAt(at);
    for (const name of ["header-tables", "header-new-order"]) {
      assert.equal(tagsOf(html, name).length, 1, `${at}: ${name} is in the markup`);
      const have = classesOf(tagOf(html, name));
      assert.ok(have.includes("hidden") && have.includes("xl:inline-flex"), `${at}: ${name} is hidden below 1280px (got "${have.join(" ")}")`);
      assert.ok(!have.includes("inline-flex") && !have.includes("tab:inline-flex"), `${at}: ${name} never shows below 1280px`);
    }
    // Their look stays U0's (the filled New order, the outline Tables), as on the other staff pages.
    assert.ok(classesOf(tagOf(html, "header-new-order")).includes("bg-primary"), `${at}: New order is U0's filled button`);
  }
  for (const at of ["/kitchenx", "/settings/kitchen-ticket", "/now-serving", "/orders"]) {
    const html = linksAt(at);
    assert.ok(!classesOf(tagOf(html, "header-tables")).includes("xl:inline-flex"), `${at}: Tables keeps U0's 720px rule`);
    assert.ok(classesOf(tagOf(html, "header-new-order")).includes("inline-flex"), `${at}: New order shows at every width`);
  }
});

// ── Now Serving in the header (design 6.1: U3's outline header button; no HTML counterpart) ───────────────────────

test("HEADER_ACTION_FLOOR_OUTLINE_CLASS: U3's New order look, its gap / icon / hover held against the actions slot's rule", () => {
  assert.ok(HEADER_ACTION_FLOOR_OUTLINE_CLASS.startsWith(`${HEADER_FLOOR_NEW_ORDER_CLASS} `), "U3's class itself, reused (never a copy)");
  // app/globals.css [data-header-actions] (unlayered, ruling R6) sets gap 7px, a 15px icon and --hover on every action:
  // only an important utility outranks it, so the three that differ from U3's look are made important.
  const extra = tokens(HEADER_ACTION_FLOOR_OUTLINE_CLASS.slice(HEADER_FLOOR_NEW_ORDER_CLASS.length));
  assert.deepEqual(extra.sort(), ["[&_svg]:size-[14px]!", "gap-1.5!", "hover:bg-surface-2!"].sort(), "gap 6px, the 14px icon, hover --surface-2 (design 6.1)");
});

// ── The page (design 5; values 1.1, 6.1) ───────────────────────────────────────────────────────────────────────────

// U4 Task 2 (design 6.2): the refresh strip joins the frame as kitchen-page's first child, above the board; the summary is
// the header's second line (lib/kitchen-header.test.ts pins both).
test("the /kitchen page: no MenuPageShell; kitchen-page holds the strip, then kitchen-board with the header and the body", () => {
  const src = read(PAGE);
  assert.ok(!src.includes("MenuPageShell"), "the paper frame goes (design 5; P41 moved on purpose)");
  assert.match(src, /import \{ KITCHEN_BOARD_CLASS, KITCHEN_PAGE_CLASS \} from "@\/lib\/kitchen-layout";/, "the frame's classes come from lib/kitchen-layout.ts");
  inOrder(
    src,
    [
      '<div data-ui="kitchen-page" className={KITCHEN_PAGE_CLASS}>',
      "<RefreshStrip",
      '<div data-ui="kitchen-board" className={KITCHEN_BOARD_CLASS}>',
      "<PageHeader",
      "Loading orders",
      "<KitchenBoardBody",
      "</div>",
      "</div>",
    ],
    "kitchen-page holds the strip and kitchen-board (the only scroller), which holds the header (its second line) and the board body",
  );
  assert.equal(src.split('data-ui="kitchen-board"').length - 1, 1, "one board: every branch of the body renders inside it");
  assert.match(src, /export default function KitchenPage\(/, "landmark (P5): the default export");
});

test("the page's handlers live in useKitchenActions: the page wires them, it writes nothing itself", () => {
  const src = read(PAGE);
  assert.match(src, /import \{ useKitchenActions \} from "@\/hooks\/use-kitchen-actions";/, "the hook is imported");
  assert.equal(src.split("useKitchenActions()").length - 1, 1, "called once");
  for (const prop of ["onToggleLine={actions.onToggleLine}", "onReady={actions.onReady}", "lineInFlight={actions.lineInFlight}", "readyInFlight={actions.readyInFlight}"]) {
    assert.ok(src.includes(prop), `the body gets ${prop}`);
  }
  for (const gone of ["tick.mutate(", "ready.mutate(", "toast(", "useTickKitchenLine", "useMarkOrderReady", "setInFlight"]) {
    assert.ok(!src.includes(gone), `the page holds no "${gone}" (moved to the hook)`);
  }
});

test("the board body draws its cards in KITCHEN_GRID_CLASS (data-ui kitchen-grid); the old fixed-count grid goes", () => {
  const src = read(BODY);
  assert.match(src, /import \{ KITCHEN_GRID_CLASS \} from "@\/lib\/kitchen-layout";/, "the grid class comes from lib/kitchen-layout.ts");
  assert.ok(src.includes('<div data-ui="kitchen-grid" className={KITCHEN_GRID_CLASS}>'), "the cards' grid");
  assert.ok(!src.includes("BOARD_GRID_CLASS") && !src.includes("sm:grid-cols-2"), "today's 1 / 2 / 3 / 4-column grid goes (design 5)");
  assert.ok(src.includes("lineInFlight={(line) => lineInFlight(line.id)}"), "a line's in-flight flag comes from the hook");
  assert.ok(src.includes("readyInFlight={readyInFlight(card.orderId)}"), "a card's Ready flag comes from the hook");
});

// ── The header on /kitchen (values 2.1-2.2; design 6.1) ───────────────────────────────────────────────────────────

test("Header: data-kitchen on /kitchen gives the bar the HTML Kitchen header's 12px gap; every other page keeps its own", () => {
  const src = read(HEADER);
  assert.match(src, /import \{ isKitchenPath \} from "@\/lib\/kitchen-layout";/, "the header reads the route through isKitchenPath");
  assert.match(src, /const kitchen = isKitchenPath\(pathname\);/, "one flag for the variant");
  const tag = /<header className="([^"]*)"([^>]*)>/.exec(src);
  assert.ok(tag, "landmark: the header tag");
  assert.match(tag![2], /\bdata-kitchen=\{kitchen \? "" : undefined\}/, "the header carries data-kitchen on /kitchen");
  hasAll(tag![1], ["gap-2.5", "data-kitchen:gap-3", "data-floor:gap-3", "data-orders:gap-3"], "values 2.1: gap 12px on /kitchen, U0's 10px elsewhere");
});
