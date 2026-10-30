// U4 Task 2 (2026-10-30): the Kitchen header's type filter and the board's states as drawn (owner Q2; design 6.1, 6.2,
// 6.5 in docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md; values 2.1, 3.6 in
// docs/superpowers/specs/2026-10-29-kitchen-html-values.md; rulings K1 / K2). The filter's and the filtered-empty box's
// classes (and the header slot's rule they must hold against), renders of KitchenTypeFilter, the shared RefreshStrip and
// KitchenBoardStates, and the body's hand-off to the states. The header's rules and the page: lib/kitchen-header.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { KITCHEN_FILTERS } from "./kitchen-header";
import { kitchenCard } from "./kitchen-header.fixtures";
import {
  KITCHEN_EMPTY_BOX_CLASS,
  KITCHEN_FILTER_TAB_CLASS,
  KITCHEN_FILTER_TAB_OFF_CLASS,
  KITCHEN_FILTER_TAB_ON_CLASS,
  KITCHEN_FILTER_TRACK_CLASS,
  KITCHEN_GRID_CLASS,
} from "./kitchen-layout";
import {
  FLOOR_REFRESH_STRIP_BUTTON_CLASS,
  FLOOR_REFRESH_STRIP_CLASS,
  FLOOR_REFRESH_STRIP_GLYPH_CLASS,
  FLOOR_REFRESH_STRIP_HIT_CLASS,
  FLOOR_REFRESH_STRIP_MESSAGE_CLASS,
  FLOOR_TAB_CLASS,
  FLOOR_TAB_ON_CLASS,
} from "./floor-layout";
import {
  REFRESH_STRIP_BUTTON_CLASS,
  REFRESH_STRIP_CLASS,
  REFRESH_STRIP_GLYPH_CLASS,
  REFRESH_STRIP_HIT_CLASS,
  REFRESH_STRIP_MESSAGE_CLASS,
} from "./ui/refresh-strip";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { KitchenTypeFilter } from "@/components/kitchen/KitchenTypeFilter";
import { KitchenBoardStates } from "@/components/kitchen/KitchenBoardStates";
import { RefreshStrip } from "@/components/shared/RefreshStrip";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(raw(rel));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const STRIP_WORDS = "Couldn't refresh the kitchen board. Showing the last update.";

// ── The classes (values 2.1, 3.6; design 6.1, 6.5) ──────────────────────────────────────────────────────────────────

/** The token, or its important form (the header slot's rule, below). */
const hasToken = (cls: string, t: string): boolean => tokens(cls).includes(t) || tokens(cls).includes(`${t}!`);

test("the filter's track and tabs: values 2.1's segmented control (the brief's classes)", () => {
  for (const t of ["flex", "h-9", "flex-none", "rounded-[8px]", "bg-surface-3", "p-0.5", "gap-0.5", "max-tab:hidden"]) {
    assert.ok(tokens(KITCHEN_FILTER_TRACK_CLASS).includes(t), `the track: ${t} (has "${KITCHEN_FILTER_TRACK_CLASS}")`);
  }
  assert.ok(!tokens(KITCHEN_FILTER_TRACK_CLASS).some((t) => /^items-/.test(t)), "the track stretches its tabs to 32px (align-items normal, values 2.1)");
  for (const t of ["rounded-[6px]", "px-3", "py-0", "text-[13px]", "font-medium", "text-foreground", "whitespace-nowrap", "flex", "items-center", "border-0", "cursor-pointer"]) {
    assert.ok(hasToken(KITCHEN_FILTER_TAB_CLASS, t), `a tab: ${t} (has "${KITCHEN_FILTER_TAB_CLASS}")`);
  }
  for (const t of tokens(HTML_PRESS_CLASS)) assert.ok(tokens(KITCHEN_FILTER_TAB_CLASS).includes(t), `a tab presses like the HTML's: ${t}`);
  // U3's tabs' keyboard ring (inset, so the 2px-padded track never needs room for it), read off FLOOR_TAB_CLASS itself.
  const ring = tokens(FLOOR_TAB_CLASS).filter((t) => t === "outline-none" || t.startsWith("focus-visible:"));
  assert.ok(ring.length >= 3, "landmark: U3's ring was read");
  for (const t of ring) assert.ok(tokens(KITCHEN_FILTER_TAB_CLASS).includes(t), `a tab's focus ring: ${t}`);
  assert.equal(KITCHEN_FILTER_TAB_ON_CLASS, FLOOR_TAB_ON_CLASS, "the chosen tab: SEG_ON exactly, U3's chip (bg-seg + --seg-sh; shadow-seg would add four empty layers)");
  assert.deepEqual(tokens(KITCHEN_FILTER_TAB_OFF_CLASS), ["bg-transparent", "pointer-fine:hover:bg-hover"], "the others: SEG_OFF, --hover only where a pointer can hover (design 6.1)");
});

/** The declarations of one rule of app/globals.css, by its exact selector. */
function ruleDecls(selector: string): Map<string, string> {
  const css = raw("app/globals.css");
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `landmark: globals.css has the rule ${selector}`);
  const body = stripComments(css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at)));
  const out = new Map<string, string>();
  for (const decl of body.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).replace(/\s+/g, " ").trim());
  }
  return out;
}

test("the header slot's rule ([data-header-actions], ruling R6) never makes a tab a 36px header button", () => {
  // Every property the slot's unlayered rule sets on a button: either it equals the HTML tab's own value (values 2.1),
  // or the tab outranks it with an important utility. A property added to the rule later fails here until answered.
  const answers: Record<string, { html: string; override?: string }> = {
    "box-sizing": { html: "border-box" },
    height: { html: "auto (stretched to 32px by the 36px track)", override: "h-auto!" },
    "min-height": { html: "auto", override: "min-h-auto!" },
    "border-radius": { html: "6px", override: "rounded-[6px]!" },
    padding: { html: "0 12px" },
    gap: { html: "6px", override: "gap-1.5!" },
    "font-size": { html: "13px", override: "text-[13px]!" },
    "font-weight": { html: "500" },
    "line-height": { html: "normal" },
    "letter-spacing": { html: "normal" },
    "white-space": { html: "nowrap" },
    transition: { html: "the HTML's button transition list (values 1.4)" },
  };
  const decls = ruleDecls("[data-header-actions] :is(button, a)");
  assert.deepEqual([...decls.keys()].sort(), Object.keys(answers).sort(), "every property of the slot's rule is answered for the tab");
  for (const [prop, { html, override }] of Object.entries(answers)) {
    if (override) assert.ok(tokens(KITCHEN_FILTER_TAB_CLASS).includes(override), `${prop}: the rule's ${decls.get(prop)} gives way to ${override} (the HTML's ${html})`);
    else if (prop !== "transition") assert.equal(decls.get(prop), html, `${prop}: the rule's value is the HTML tab's own`);
  }
  const important = tokens(KITCHEN_FILTER_TAB_CLASS).filter((t) => t.endsWith("!"));
  assert.deepEqual(important.sort(), Object.values(answers).flatMap((a) => (a.override ? [a.override] : [])).sort(), "only the overrides are important");
  // The slot's other rules key on these classes (outline, filled, icon-only); a tab carries none of them.
  for (const t of ["border", "bg-primary", "bg-brand-primary", "w-9", "w-10", "w-11", "size-9", "size-10", "size-11"]) {
    for (const cls of [KITCHEN_FILTER_TAB_CLASS, KITCHEN_FILTER_TAB_ON_CLASS, KITCHEN_FILTER_TAB_OFF_CLASS]) {
      assert.ok(!tokens(cls).includes(t), `a tab never carries ${t} (the slot's outline / filled / square rules)`);
    }
  }
});

test("the filtered-empty box: values 3.6's empty box (ruling K2: dashed 1.5px --border, radius 12, 28px 12px, 13px --text-3)", () => {
  for (const t of ["rounded-[12px]", "border-[1.5px]", "border-dashed", "border-border", "px-3", "py-7", "text-center", "text-[13px]", "text-subtle-foreground"]) {
    assert.ok(tokens(KITCHEN_EMPTY_BOX_CLASS).includes(t), `the box: ${t} (has "${KITCHEN_EMPTY_BOX_CLASS}")`);
  }
});

// ── KitchenTypeFilter, rendered (design 6.1) ─────────────────────────────────────────────────────────────────────────

test("KitchenTypeFilter: a group 'Filter orders by type' of three toggle buttons, the chosen one pressed on the chip", () => {
  for (const value of ["all", "tables", "walkin"] as const) {
    const html = renderToStaticMarkup(createElement(KitchenTypeFilter, { value, onChange: () => {} }));
    const group = tagOf(html, "kitchen-type-filter");
    assert.match(group, /^<div /, `${value}: the track is a div`);
    assert.match(group, /role="group"/, `${value}: a group (U3's pills; the HTML has none)`);
    assert.match(group, /aria-label="Filter orders by type"/, `${value}: its name`);
    expectAll(group, tokens(KITCHEN_FILTER_TRACK_CLASS), `${value}: the track`);
    const tabs = tagsOf(html, "kitchen-type-tab");
    assert.equal(tabs.length, 3, `${value}: three tabs`);
    assert.deepEqual([0, 1, 2].map((i) => textOf(html, "kitchen-type-tab", i)), ["All", "Tables", "Walk-In"], `${value}: the words, in order`);
    KITCHEN_FILTERS.forEach((f, i) => {
      const tab = tabs[i];
      const on = f.key === value;
      assert.match(tab, /^<button /, `${f.label}: a button`);
      assert.match(tab, /type="button"/, `${f.label}: never a submit`);
      assert.match(tab, new RegExp(`aria-pressed="${on}"`), `${f.label}: aria-pressed ${on} with ${value} chosen`);
      expectAll(tab, tokens(KITCHEN_FILTER_TAB_CLASS), `${f.label}: the tab`);
      expectAll(tab, tokens(on ? KITCHEN_FILTER_TAB_ON_CLASS : KITCHEN_FILTER_TAB_OFF_CLASS), `${f.label}: ${on ? "the chip" : "off"}`);
      const other = tokens(on ? KITCHEN_FILTER_TAB_OFF_CLASS : KITCHEN_FILTER_TAB_ON_CLASS);
      assert.ok(!other.some((t) => classesOf(tab).includes(t)), `${f.label}: not the ${on ? "off" : "chosen"} look`);
    });
  }
});

test("KitchenTypeFilter: a tap chooses its tab (client-side only: onChange, no request)", () => {
  const picked: string[] = [];
  const tree = KitchenTypeFilter({ value: "all", onChange: (f) => picked.push(f) }) as ReactElement<{ children: ReactNode }>;
  const buttons = React.Children.toArray(tree.props.children).filter(isValidElement) as ReactElement<{ onClick: () => void }>[];
  assert.equal(buttons.length, 3, "landmark: three buttons");
  for (const b of buttons) b.props.onClick();
  assert.deepEqual(picked, ["all", "tables", "walkin"], "each tab reports its own key");
});

// ── RefreshStrip (design 6.2: U3's strip, shared) ─────────────────────────────────────────────────────────────────────

test("lib/ui/refresh-strip.ts holds U3's strip classes; the Floor re-exports them under its own names (one copy)", () => {
  assert.equal(FLOOR_REFRESH_STRIP_CLASS, REFRESH_STRIP_CLASS, "the band");
  assert.equal(FLOOR_REFRESH_STRIP_MESSAGE_CLASS, REFRESH_STRIP_MESSAGE_CLASS, "the message");
  assert.equal(FLOOR_REFRESH_STRIP_GLYPH_CLASS, REFRESH_STRIP_GLYPH_CLASS, "the glyph");
  assert.equal(FLOOR_REFRESH_STRIP_BUTTON_CLASS, REFRESH_STRIP_BUTTON_CLASS, "Try again");
  assert.equal(FLOOR_REFRESH_STRIP_HIT_CLASS, REFRESH_STRIP_HIT_CLASS, "its 44px hit area");
  assert.ok(!/const FLOOR_REFRESH_STRIP_\w+ =/.test(code("lib/floor-layout.ts")), "floor-layout defines no strip class of its own any more");
  assert.ok(
    code("components/tables/FloorRefreshStrip.tsx").includes(
      '<RefreshStrip ui="floor" show={show} message="Couldn\'t refresh the floor. Showing the last update." onRetry={onRetry} />',
    ),
    "FloorRefreshStrip renders the shared strip with its words (lib/floor-refresh-strip.test.ts renders it unchanged)",
  );
});

const renderStrip = (show: boolean): string =>
  renderToStaticMarkup(createElement(RefreshStrip, { show, message: STRIP_WORDS, onRetry: () => {}, ui: "kitchen" }));

test("RefreshStrip ui='kitchen': nothing when fresh; else a status band, the warn glyph, the words, Try again", () => {
  assert.equal(renderStrip(false), "", "no strip, no empty box");
  const html = renderStrip(true);
  const band = tagOf(html, "kitchen-refresh-strip");
  expectAll(band, tokens(REFRESH_STRIP_CLASS), "the band");
  assert.match(band, /role="status"/, "a status region");
  assert.equal(textOf(html, "kitchen-refresh-strip").replace(/&#x27;/g, "'"), `${STRIP_WORDS}Try again`, "design 6.2's words, then the button");
  expectAll(tagOf(html, "kitchen-refresh-message"), tokens(REFRESH_STRIP_MESSAGE_CLASS), "the message");
  const glyph = /<svg[^>]*>/.exec(html.slice(html.indexOf('data-ui="kitchen-refresh-message"')))?.[0] ?? "";
  assert.match(glyph, /aria-hidden="true"/, "the glyph is decoration");
  const retry = tagOf(html, "kitchen-refresh-retry");
  assert.match(retry, /^<button /, "Try again is a button");
  assert.match(retry, /type="button"/, "never a submit");
  expectAll(retry, [...tokens(REFRESH_STRIP_BUTTON_CLASS), ...tokens(REFRESH_STRIP_HIT_CLASS)], "the U0 strip's button with the 44px touch area");
  assert.equal(textOf(html, "kitchen-refresh-retry"), "Try again", "today's word");
  assert.equal(tagsOf(html, "floor-refresh-strip").length, 0, "the Floor's names only on the Floor");
});

// ── The board's states, rendered (ruling K1 split; design 6.5; Review Focus 2) ───────────────────────────────────────

type StatesProps = Parameters<typeof KitchenBoardStates>[0];
const GRID = createElement("div", { "data-ui": "kitchen-grid" }, "cards");
const renderStates = (over: Partial<Omit<StatesProps, "children">>): string => {
  const props = { isLoading: false, hasData: true, isError: false, isPaused: false, cards: [], filtered: false, onRetry: () => {}, ...over };
  // The grid goes in as createElement's child argument (react/no-children-prop); its type is the props without it.
  return renderToStaticMarkup(createElement(KitchenBoardStates, props as StatesProps, GRID));
};

test("KitchenBoardStates: the filtered-empty box only when the filter hides every card; the empty board stays All caught up", () => {
  const filtered = renderStates({ cards: [], filtered: true });
  expectAll(tagOf(filtered, "kitchen-filter-empty"), tokens(KITCHEN_EMPTY_BOX_CLASS), "the filtered-empty box");
  assert.equal(textOf(filtered, "kitchen-filter-empty"), "No orders here", "Review Focus 2: Tables chosen with only walk-in cards");
  assert.ok(!filtered.includes("All caught up"), "never All caught up while the filter hides cards");
  const empty = renderStates({ cards: [], filtered: false });
  assert.ok(empty.includes("All caught up"), "an empty board: today's words");
  assert.equal(tagsOf(empty, "kitchen-filter-empty").length, 0, "no filtered-empty box on an empty board");
  assert.equal(renderStates({ cards: [kitchenCard("T-4", 3)], filtered: true }), renderToStaticMarkup(GRID), "cards shown: the grid (its children), nothing else");
});

test("KitchenBoardStates: today's branch order — loading, first-load error, offline, then empty (P44 / P45 kept)", () => {
  const loading = renderStates({ isLoading: true });
  assert.ok(loading.startsWith(`<div class="${KITCHEN_GRID_CLASS}" aria-hidden="true">`), "loading: the skeleton grid");
  const error = renderStates({ isError: true, hasData: false });
  assert.ok(error.includes("Couldn&#x27;t load the kitchen board") && error.includes("Try again"), "a failed first load: the error screen");
  assert.ok(!error.includes("kitchen-refresh-strip"), "never the strip");
  assert.equal(renderStates({ isError: true, hasData: true, cards: [kitchenCard("T-4", 3)] }), renderToStaticMarkup(GRID), "a failed poll with cards: the cards stay");
  assert.ok(renderStates({ isPaused: true, hasData: false }).includes("You appear to be offline"), "offline, never loaded");
});

test("the board body hands its states to KitchenBoardStates (ruling K1) and keeps the grid", () => {
  const body = code("components/kitchen/KitchenBoardBody.tsx");
  assert.ok(body.includes('import { KitchenBoardStates } from "@/components/kitchen/KitchenBoardStates";'), "the states' own file");
  assert.ok(
    body.includes(
      "<KitchenBoardStates isLoading={isLoading} hasData={hasData} isError={isError} isPaused={isPaused} cards={cards} filtered={filtered} onRetry={onRetry}>",
    ),
    "every state flag passes through, the grid as its children",
  );
  for (const moved of ["<ErrorState", "<EmptyState", "<Skeleton", "You appear to be offline"]) {
    assert.ok(!body.includes(moved), `${moved} lives in KitchenBoardStates.tsx now`);
  }
  const states = code("components/kitchen/KitchenBoardStates.tsx");
  assert.ok(states.includes("{KITCHEN_EMPTY_FILTER_TEXT}"), "the filtered-empty words from lib/kitchen-header.ts");
  assert.ok(states.includes('<div data-ui="kitchen-filter-empty" className={KITCHEN_EMPTY_BOX_CLASS}>'), "the box's markup and classes");
});
