// U3 Task 1 (2026-10-28): the /tables frame and the shell header's /tables variant, the owner's HTML Floor screen
// (docs/superpowers/specs/2026-10-28-floor-html-values.md: values 0.3 pagePad / screenPadB, 1.1 page, 1.2-1.3 header,
// 2.1 body, 9.1 scrollbar, 13.1 regions; docs/superpowers/specs/2026-10-28-floor-match-html-design.md 4 Q1, 5 layout,
// 6.1 header). Pure pins on lib/floor-layout.ts and the header's Floor button class, a render of the header's quick links
// on real paths, then source pins on the markup that renders them (the page, the header, the quick links).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { stripComments } from "./source-pin-utils";
import { cn } from "./utils";
import { POS_PAGE_CLASS } from "./pos-layout";
import { classesOf, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { FLOOR_BODY_CLASS, FLOOR_PAGE_CLASS, FLOOR_PATH, FLOOR_SCROLLER_CLASS, isFloorPath } from "./floor-layout";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { buttonVariants } from "@/components/ui/button";
import { HEADER_FLOOR_NEW_ORDER_CLASS, HEADER_PRIMARY_BUTTON_CLASS } from "@/components/layout/header-classes";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

const PAGE = "app/(dashboard)/tables/page.tsx";
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

/** The `{ ... }` body that starts at the first `{` after `needle`. */
function bodyAfter(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `landmark: ${needle}`);
  const open = src.indexOf("{", at + needle.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  assert.fail(`unbalanced braces after ${needle}`);
}

// ── The route ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("isFloorPath: /tables itself only — its admin pages (Setup, QR codes) and look-alike paths keep U0's header", () => {
  assert.equal(FLOOR_PATH, "/tables", "the Floor's route");
  assert.equal(isFloorPath("/tables"), true, "/tables is the Floor");
  assert.equal(isFloorPath("/tables/"), true, "a trailing slash is still the Floor");
  assert.equal(isFloorPath("/tables/setup"), false, "Setup is another page (not in the HTML)");
  assert.equal(isFloorPath("/tables/qr"), false, "QR codes is another page (not in the HTML)");
  assert.equal(isFloorPath("/tablesx"), false, "/tablesx is another page");
  assert.equal(isFloorPath("/table"), false, "a shorter path is another page");
  assert.equal(isFloorPath("/pos"), false, "the POS is not the Floor");
  assert.equal(isFloorPath("/"), false, "the dashboard is not the Floor");
  assert.equal(isFloorPath(""), false, "an unknown path is not the Floor");
});

// ── The frame (values 1.1, 2.1, 0.3, 9.1; design 5) ───────────────────────────────────────────────────────────────

test("FLOOR_PAGE_CLASS: the /pos frame under the shell header, a flex column that never scrolls itself (design 5)", () => {
  assert.ok(FLOOR_PAGE_CLASS.includes(POS_PAGE_CLASS), `the page is POS_PAGE_CLASS's frame (has "${FLOOR_PAGE_CLASS}")`);
  hasAll(FLOOR_PAGE_CLASS, ["flex", "flex-col", "overflow-hidden"], "design 5: a flex column whose first child can be the refresh strip");
});

test("FLOOR_SCROLLER_CLASS: the HTML's body padding, its foot plus the safe-area inset at every width, its 8px scrollbar", () => {
  hasAll(
    FLOOR_SCROLLER_CLASS,
    ["min-h-0", "flex-1", "overflow-y-auto", "overflow-x-hidden", "leading-[normal]", "pt-5", "px-6", "pb-[calc(28px+env(safe-area-inset-bottom))]"],
    "values 0.3 pagePad 20px 24px, screenPadB 28px (U1 P49: plus the inset)",
  );
  hasAll(
    FLOOR_SCROLLER_CLASS,
    ["max-tab:pt-4", "max-tab:px-3.5", "max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]"],
    "values 0.3 on the phone: pagePad 16px 14px, screenPadB 92px (plus the inset)",
  );
  hasAll(
    FLOOR_SCROLLER_CLASS,
    ["[&::-webkit-scrollbar]:w-2", "[&::-webkit-scrollbar]:h-0", "[&::-webkit-scrollbar-thumb]:rounded-[8px]", "[&::-webkit-scrollbar-thumb]:bg-border"],
    "values 9.1: an 8px bar, a --border thumb with radius 8, no track colour",
  );
  assert.equal(FLOOR_SCROLLER_CLASS.match(/env\(safe-area-inset-bottom\)/g)?.length, 2, "both feet add the inset, nothing else does");
});

test("FLOOR_BODY_CLASS: the HTML's body, a flex column 16px apart (values 2.1)", () => {
  assert.equal(FLOOR_BODY_CLASS, "flex flex-col gap-4", "values 2.1: display flex, column, gap 16px");
});

// ── The header's New order on /tables (values 1.2 Takeaway; owner Q1, design 6.1) ─────────────────────────────────

test("HEADER_FLOOR_NEW_ORDER_CLASS: the HTML Floor button's outline look — 36px, 0 12px, 13.5px/500, gap 6, a 14px icon", () => {
  hasAll(
    HEADER_FLOOR_NEW_ORDER_CLASS,
    ["h-9", "flex-none", "px-3", "py-0", "gap-1.5", "text-[13.5px]", "font-medium", "[&_svg]:size-[14px]"],
    "values 1.2 Takeaway: height 36, padding 0 12px, 13.5px 500, gap 6px, the 14px plus",
  );
  hasAll(HEADER_FLOOR_NEW_ORDER_CLASS, ["border", "border-border", "bg-card", "text-foreground", "hover:bg-surface-2"], "values 1.2: 1px --border, --surface, --text; hover --surface-2");
  assert.ok(HEADER_FLOOR_NEW_ORDER_CLASS.endsWith(` ${HTML_PRESS_CLASS}`), "it presses like the HTML's buttons (values 6.2)");
  assert.notEqual(HEADER_FLOOR_NEW_ORDER_CLASS, HEADER_PRIMARY_BUTTON_CLASS, "landmark: not the filled New order of every other page");
});

test("HEADER_FLOOR_NEW_ORDER_CLASS over the kit's primary Button: no accent fill, no kit hover or press survives the merge", () => {
  const merged = tokens(cn(buttonVariants({ variant: "default" }), HEADER_FLOOR_NEW_ORDER_CLASS));
  for (const gone of ["bg-primary", "text-primary-foreground", "hover:bg-primary/90", "transition-colors", "motion-safe:active:scale-[0.97]", "[&_svg]:size-4", "text-sm", "px-4", "py-2"]) {
    assert.ok(!merged.includes(gone), `the kit's "${gone}" gives way (got "${merged.join(" ")}")`);
  }
  for (const kept of ["border", "border-border", "bg-card", "text-foreground", "hover:bg-surface-2", "h-9", "px-3", "py-0", "gap-1.5", "rounded-md", ...tokens(HTML_PRESS_CLASS)]) {
    assert.ok(merged.includes(kept), `"${kept}" is on the drawn button (got "${merged.join(" ")}")`);
  }
});

// ── The header's quick links, rendered on real paths (owner Q1; design 4, 6.1) ───────────────────────────────────

const linksAt = (pathname: string): string => renderToStaticMarkup(createElement(PathnameContext.Provider, { value: pathname }, createElement(HeaderQuickTabs)));

test("on /tables the header draws New order alone, in the Floor look, with its label at every width; Tables is not drawn", () => {
  for (const at of ["/tables", "/tables/"]) {
    const html = linksAt(at);
    assert.equal(tagsOf(html, "header-tables").length, 0, `${at}: no Tables link on the Floor itself (design 4 Q1)`);
    assert.equal(tagsOf(html, "header-new-order").length, 1, `${at}: one New order`);
    const link = tagOf(html, "header-new-order");
    assert.match(link, /href="\/pos"/, `${at}: the same link to /pos as every page (Q1)`);
    const have = classesOf(link);
    for (const t of tokens(cn(buttonVariants({ variant: "default" }), HEADER_FLOOR_NEW_ORDER_CLASS))) {
      assert.ok(have.includes(t), `${at}: New order carries the Floor look's "${t}"`);
    }
    for (const gone of ["bg-primary", "hover:bg-primary-hover", "font-semibold"]) assert.ok(!have.includes(gone), `${at}: not the filled button's "${gone}"`);
    assert.match(html, /<span class="inline">New order<\/span>/, `${at}: the label at every width, the phone too (Q1, values 1.2)`);
    assert.equal(textOf(html, "header-new-order"), "New order", `${at}: the word stays ours (Q1)`);
  }
});

test("every other page keeps U0's two links: /tables/setup, /tables/qr, /orders and the dashboard draw Tables and the filled New order", () => {
  for (const at of ["/", "/orders", "/tables/setup", "/tables/qr", "/customers"]) {
    const html = linksAt(at);
    assert.equal(tagsOf(html, "header-tables").length, 1, `${at}: Tables is drawn`);
    assert.equal(tagsOf(html, "header-new-order").length, 1, `${at}: New order is drawn`);
    const have = classesOf(tagOf(html, "header-new-order"));
    for (const t of ["bg-primary", "hover:bg-primary-hover", "font-semibold", "px-3.5"]) assert.ok(have.includes(t), `${at}: New order is U0's filled button ("${t}")`);
    assert.ok(!have.includes("hover:bg-surface-2"), `${at}: never the Floor look`);
  }
  assert.equal(linksAt("/pos"), "", "landmark: /pos draws neither (U1)");
});

// ── The page (design 5; values 1.1, 2.1) ───────────────────────────────────────────────────────────────────────────

test("the /tables page: no MenuPageShell; the frame (page → scroller → body) wraps both branches, the PageHeader in each", () => {
  const src = read(PAGE);
  assert.ok(!src.includes("MenuPageShell"), "the paper frame with the 1440px cap goes (design 5)");
  assert.match(src, /import \{[^}]*\bFLOOR_PAGE_CLASS\b[^}]*\} from "@\/lib\/floor-layout";/, "the frame's classes come from lib/floor-layout.ts");
  const frame = bodyAfter(src, "function FloorFrame({ children }: { children: ReactNode })");
  inOrder(
    frame,
    [
      '<div data-ui="floor-page" className={FLOOR_PAGE_CLASS}>',
      '<div data-ui="floor-scroller" className={FLOOR_SCROLLER_CLASS}>',
      '<div data-ui="floor-body" className={FLOOR_BODY_CLASS}>',
      "{children}",
      "</div>",
      "</div>",
      "</div>",
    ],
    "floor-page wraps floor-scroller, which wraps floor-body, which holds the page's content",
  );
  // The error branch renders inside the same frame and scroller as the live floor (the brief), each with its header.
  assert.equal(src.split("<FloorFrame>").length - 1, 2, "both branches render inside the frame");
  const error = src.slice(src.indexOf("<FloorFrame>"), src.indexOf("</FloorFrame>"));
  assert.ok(error.includes("<ErrorState"), "the first frame is the error branch");
  assert.match(error, /<PageHeader\s+eyebrow="Service"\s+title="Floor"/, "the error branch keeps the header words (P14)");
  const live = src.slice(src.lastIndexOf("<FloorFrame>"));
  assert.match(live, /^<FloorFrame>\s*<PageHeader\s+eyebrow="Service"\s+title="Floor"/, "the live floor opens its frame with the PageHeader (P55)");
});

// ── The header on /tables (values 1.2; design 6.1) ─────────────────────────────────────────────────────────────────

test("Header: data-floor on /tables gives the bar the HTML Floor header's 12px gap; every other page keeps its own", () => {
  const src = read(HEADER);
  assert.match(src, /import \{ isFloorPath \} from "@\/lib\/floor-layout";/, "the header reads the route through isFloorPath");
  assert.match(src, /const floor = isFloorPath\(pathname\);/, "one flag for the variant");
  const tag = /<header className="([^"]*)"([^>]*)>/.exec(src);
  assert.ok(tag, "landmark: the header tag");
  assert.match(tag![2], /\bdata-floor=\{floor \? "" : undefined\}/, "the header carries data-floor on /tables");
  hasAll(tag![1], ["gap-2.5", "data-floor:gap-3", "data-orders:gap-3", "data-pos:gap-4"], "values 1.2: gap 12px on /tables, U0's 10px elsewhere");
});

test("HeaderQuickTabs: on isFloorPath Tables is not drawn and New order takes HEADER_FLOOR_NEW_ORDER_CLASS with its label inline (design 4 Q1, 6.1)", () => {
  const src = read(QUICK_TABS);
  assert.match(src, /import \{ FLOOR_PATH, isFloorPath \} from "@\/lib\/floor-layout";/, "the quick links read the route through isFloorPath");
  assert.match(src, /const floor = isFloorPath\(pathname\);/, "one flag for the Floor");
  const map = bodyAfter(src, "HEADER_QUICK_TABS.map((tab) =>");
  assert.match(map, /if \(floor && tab\.url === FLOOR_PATH\) return null;/, "Tables (this page) is not drawn on the Floor");
  assert.ok(map.indexOf("return null;") < map.indexOf("<Link"), "before its link renders");
  assert.match(
    src,
    /tab\.primary \? \(floor \? HEADER_FLOOR_NEW_ORDER_CLASS : HEADER_PRIMARY_BUTTON_CLASS\) : HEADER_OUTLINE_BUTTON_CLASS/,
    "New order wears the HTML Floor button's look on /tables only",
  );
  assert.match(src, /const labelClass = isOrdersPath\(pathname\) \|\| floor \? "inline" : "hidden tab:inline";/, "the label at every width on /tables (and /orders)");
});
