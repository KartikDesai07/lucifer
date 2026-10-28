// U3 Task 5 (2026-10-28): the Floor's refresh strip and the page's wiring of it and of the header's second line (design
// 6.2, 6.10, 11; owner Q3; docs/superpowers/specs/2026-10-28-floor-match-html-design.md). The strip is ours (the HTML has
// none): the U0 order-request strip's look exactly (components/orders/RequestAlertBar.tsx, U0 design 5.3), mirrored in
// lib/floor-layout.ts and held to it here so the two never drift; "Try again" as its 30px outline button with a 44px hit
// area on touch that leaves the strip's height alone (ruling R1). Pure pins on the show rule and the classes, renders of
// FloorRefreshStrip, then source pins on the page (Review Focus 5: the strip only with tables on screen and a failed read;
// a first load that failed keeps the error screen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import {
  FLOOR_REFRESH_STRIP_BUTTON_CLASS, FLOOR_REFRESH_STRIP_CLASS, FLOOR_REFRESH_STRIP_GLYPH_CLASS, FLOOR_REFRESH_STRIP_HIT_CLASS,
  FLOOR_REFRESH_STRIP_MESSAGE_CLASS,
} from "./floor-layout";
import { floorRefreshFailed } from "./floor-tiles";
import { table } from "./floor-tiles.fixtures";
import { buttonVariants } from "@/components/ui/button";
import { FloorRefreshStrip } from "@/components/tables/FloorRefreshStrip";
import { cn } from "./utils";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(raw(rel));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const sorted = (cls: string): string[] => [...tokens(cls)].sort();
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const PAGE = "app/(dashboard)/tables/page.tsx";
const U0_STRIP = "components/orders/RequestAlertBar.tsx";
const STRIP = "components/tables/FloorRefreshStrip.tsx";
const WORDS = "Couldn't refresh the floor. Showing the last update.";

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

// ── The show rule (Review Focus 5; design 6.2: today's rule) ─────────────────────────────────────────────────────────

test("floorRefreshFailed: only with tables on screen and a failed read of the tables or the open bills", () => {
  const list = [table("T-1", "Available")];
  for (const [tablesError, tabsError] of [[true, false], [false, true], [true, true]] as const) {
    assert.equal(floorRefreshFailed({ tables: list, tablesError, tabsError }), true, `tables ${tablesError} / bills ${tabsError}: the strip`);
  }
  assert.equal(floorRefreshFailed({ tables: list, tablesError: false, tabsError: false }), false, "both reads fine: no strip");
  assert.equal(floorRefreshFailed({ tables: undefined, tablesError: false, tabsError: true }), false, "still loading: the skeleton, no strip");
  assert.equal(floorRefreshFailed({ tables: undefined, tablesError: true, tabsError: true }), false, "a first load that failed: the error screen");
  assert.equal(floorRefreshFailed({ tables: [], tablesError: true, tabsError: true }), false, "no tables: the empty state, as today");
});

// ── The classes: the U0 strip's, exactly (U0 design 5.3), and our 44px touch hit area ─────────────────────────────────

test("the strip's band and button classes are RequestAlertBar's, token for token (no drift either way)", () => {
  const src = raw(U0_STRIP);
  const band = /data-ui="request-strip"\s+className="([^"]*)"/.exec(src)?.[1];
  assert.ok(band, "landmark: the U0 strip's band");
  assert.deepEqual(sorted(FLOOR_REFRESH_STRIP_CLASS), sorted(band!), "the band: min-h-10, py-1, px-3 tab:px-5, the hairline, the warn tint, 13px warn ink");
  const button = /<Button variant="outline" onClick=\{unlock\} data-ui="request-strip-sound" className="([^"]*)">/.exec(src)?.[1];
  assert.ok(button, "landmark: the U0 strip's 30px outline button (Enable sound)");
  assert.deepEqual(sorted(FLOOR_REFRESH_STRIP_BUTTON_CLASS), sorted(button!), "Try again: the U0 strip's outline button, its classes");
  for (const t of ["min-h-10", "py-1", "px-3", "tab:px-5", "border-b", "border-border", "bg-status-warn-tint", "text-[13px]", "text-status-warn-ink", "leading-[normal]"]) {
    assert.ok(tokens(FLOOR_REFRESH_STRIP_CLASS).includes(t), `the brief's band token ${t}`);
  }
  assert.ok(tokens(FLOOR_REFRESH_STRIP_BUTTON_CLASS).includes("h-[30px]"), "the 30px button");
});

test("the hit area: 44px under a coarse pointer, from a pseudo-element, never the laid-out box", () => {
  assert.deepEqual(
    tokens(FLOOR_REFRESH_STRIP_HIT_CLASS),
    ["relative", "pointer-coarse:after:absolute", "pointer-coarse:after:inset-x-0", "pointer-coarse:after:-top-[5px]", "pointer-coarse:after:h-11"],
    "the button positions an ::after 44px tall from 4px above it, inside the strip on its 40px line (the page clip never cuts it)",
  );
  for (const t of tokens(FLOOR_REFRESH_STRIP_HIT_CLASS).slice(1)) assert.match(t, /^pointer-coarse:after:/, `${t}: touch only, on the pseudo-element`);
  for (const t of tokens(FLOOR_REFRESH_STRIP_HIT_CLASS)) {
    assert.ok(!/^(?:h-|min-h-|p[ytb]?-|m[ytb]?-)/.test(t), `${t} never changes the button's or the strip's height`);
  }
  assert.equal(FLOOR_REFRESH_STRIP_MESSAGE_CLASS, "flex items-center gap-1.5", "the glyph and the words, 6px apart (the U0 button's icon gap)");
  assert.equal(FLOOR_REFRESH_STRIP_GLYPH_CLASS, "size-[14px] flex-none", "the 14px warn glyph");
});

// ── The render ────────────────────────────────────────────────────────────────────────────────────────────────────

const render = (show: boolean): string => renderToStaticMarkup(createElement(FloorRefreshStrip, { show, onRetry: () => {} }));

test("FloorRefreshStrip: nothing when the floor is fresh", () => {
  assert.equal(render(false), "", "no strip, no empty box");
});

test("FloorRefreshStrip: a status region in the U0 strip's look, the glyph, the words, Try again as the U0 button", () => {
  const html = render(true);
  const strip = tagOf(html, "floor-refresh-strip");
  expectAll(strip, tokens(FLOOR_REFRESH_STRIP_CLASS), "the strip");
  assert.match(strip, /role="status"/, "a status region, as today");
  assert.equal(textOf(html, "floor-refresh-strip").replace(/&#x27;/g, "'"), `${WORDS}Try again`, "design 11's words, then the button");
  const message = tagOf(html, "floor-refresh-message");
  expectAll(message, tokens(FLOOR_REFRESH_STRIP_MESSAGE_CLASS), "the message");
  assert.equal(textOf(html, "floor-refresh-message").replace(/&#x27;/g, "'"), WORDS, "the words beside the glyph");
  const glyph = /<svg[^>]*>/.exec(html.slice(html.indexOf('data-ui="floor-refresh-message"')))?.[0] ?? "";
  assert.match(glyph, /aria-hidden="true"/, "the glyph is decoration: the words say it");
  for (const t of tokens(FLOOR_REFRESH_STRIP_GLYPH_CLASS)) assert.ok(classesOf(glyph).includes(t), `the glyph carries ${t}`);
  assert.equal(tagsOf(html, "floor-refresh-retry").length, 1, "one Try again");
  const button = tagOf(html, "floor-refresh-retry");
  assert.match(button, /^<button /, "a button");
  assert.match(button, /type="button"/, "never a submit");
  const drawn = tokens(cn(buttonVariants({ variant: "outline" }), FLOOR_REFRESH_STRIP_BUTTON_CLASS, FLOOR_REFRESH_STRIP_HIT_CLASS));
  assert.deepEqual([...classesOf(button)].sort(), [...drawn].sort(), "the kit outline Button with the U0 strip's classes and the hit area");
  // Fix round 1 (keep-1): the 44px touch target read off the rendered button itself, not through the same cn() the kit runs.
  for (const t of tokens(FLOOR_REFRESH_STRIP_HIT_CLASS)) assert.ok(classesOf(button).includes(t), `the rendered Try again keeps ${t} (ruling R1: 44px on touch)`);
  assert.ok(!classesOf(button).includes("overflow-hidden"), "the rendered Try again never clips its ::after (no overflow-hidden)");
  assert.equal(textOf(html, "floor-refresh-retry"), "Try again", "today's word");
  assert.ok(html.indexOf('data-ui="floor-refresh-message"') < html.indexOf('data-ui="floor-refresh-retry"'), "the words, then Try again (design 6.10's tab order)");
});

// ── The page (design 5, 6.2; Review Focus 5) ────────────────────────────────────────────────────────────────────────

test("the strip is the page's first child, before the scroller (it never scrolls away); the old live line is gone", () => {
  const src = code(PAGE);
  const frame = bodyAfter(src, "function FloorFrame({ children, strip }: { children: ReactNode; strip?: ReactNode })");
  inOrder(
    frame,
    ['<div data-ui="floor-page" className={FLOOR_PAGE_CLASS}>', "{strip}", '<div data-ui="floor-scroller" className={FLOOR_SCROLLER_CLASS}>', "{children}"],
    "floor-page holds the strip, then the scroller with the body",
  );
  assert.equal(count(src, "<FloorRefreshStrip "), 1, "one strip");
  assert.equal(count(src, "{strip}") - count(src, "strip={strip}"), 1, "drawn in one place: the frame, above the scroller");
  assert.ok(!src.includes("FloorLiveIndicator"), "the interim live line under the controls row is gone");
  assert.ok(!existsSync(path.join(CAFE_ROOT, "components/tables/FloorLiveIndicator.tsx")), "its file became FloorRefreshStrip.tsx");
  assert.ok(existsSync(path.join(CAFE_ROOT, STRIP)), "landmark: the strip's file");
});

test("Review Focus 5: the strip shows on a failed read with tables on screen; a failed first load keeps the error screen", () => {
  const src = code(PAGE);
  assert.match(
    src,
    /const strip = <FloorRefreshStrip show=\{floorRefreshFailed\(\{ tables: list, tablesError: tables\.isError, tabsError: openTabs\.isError \}\)\} onRetry=\{retryAll\} \/>;/,
    "the show rule over the list on screen, both reads; Try again is retryAll",
  );
  assert.equal(count(src, "<FloorFrame strip={strip}>"), 1, "the live floor's frame carries it");
  const error = src.slice(src.indexOf("<FloorFrame>"), src.indexOf("</FloorFrame>"));
  assert.ok(error.includes("<ErrorState") && error.includes("onRetry={retryAll}"), "the first-load failure: the error screen and its Try again");
  assert.ok(!error.includes("strip"), "the error screen has no strip");
  assert.ok(src.indexOf("<FloorFrame>") < src.indexOf("<FloorFrame strip={strip}>"), "landmark: the error branch returns first");
  const retry = bodyAfter(src, "const retryAll = () =>");
  assert.ok(retry.includes("void tables.refetch();") && retry.includes("void openTabs.refetch();"), "Try again re-reads the tables and the open bills (kept)");
});

test("the header's second line: Loading tables… before the list, then floorHeaderLine over the whole floor and its oldest stamp", () => {
  const src = code(PAGE);
  assert.ok(
    src.includes('description={list ? floorHeaderLine({ tiles, tabsKnown, updatedAtMs, nowMs }) : "Loading tables…"}'),
    "design 6.2: the summary and the freshness; today's loading words",
  );
  assert.ok(src.includes("const stamps = [tables.dataUpdatedAt, openTabs.dataUpdatedAt].filter((at) => at > 0);"), "the two reads' stamps");
  assert.ok(src.includes("const updatedAtMs = stamps.length > 0 ? Math.min(...stamps) : 0;"), "the older one (today's rule); 0 = never loaded");
  assert.ok(!src.includes("floorSummaryText("), "the page reads the line through floorHeaderLine only");
});
