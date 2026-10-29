// U3 Task 2 (2026-10-28): the Floor's controls row, the owner's HTML (docs/superpowers/specs/2026-10-28-floor-html-values.md
// 2.2 row, 2.3 area segmented control, 2.4 status pills, 2.5 / 2.6 the phone; design 6.3, 8 #7 / #9 / #12, owner Q4).
// Pure pins on lib/floor-layout.ts's control classes and the one new colour token, then renders of the two controls
// (FloorAreaTabs, FloorStatusChips) and source pins on how they scroll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import {
  FLOOR_CONTROLS_CLASS, FLOOR_FADE_PILLS, FLOOR_FADE_TABS, FLOOR_FADE_WRAP_CLASS, FLOOR_FILTER_DOT, FLOOR_PILLS_ROW_CLASS,
  FLOOR_PILL_CLASS, FLOOR_PILL_COUNT_OFF_CLASS, FLOOR_PILL_COUNT_ON_CLASS, FLOOR_PILL_DOT_CLASS, FLOOR_PILL_OFF_CLASS,
  FLOOR_PILL_ON_CLASS, FLOOR_REVEAL_MARGIN, FLOOR_TABS_TRACK_CLASS, FLOOR_TAB_CLASS, FLOOR_TAB_OFF_CLASS, FLOOR_TAB_ON_CLASS,
} from "./floor-layout";
import { FLOOR_ALL_AREAS, effectiveArea, type FloorAreaTab } from "./floor-areas";
import { FLOOR_FILTERS, type FloorFilter } from "./floor-tiles";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { FloorAreaTabs } from "@/components/tables/FloorAreaTabs";
import { FloorStatusChips } from "@/components/tables/FloorStatusChips";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  for (const n of needles) assert.ok(tokens(cls).includes(n), `${what}: "${n}" (has "${cls}")`);
}

// ── The classes (values 2.2-2.4) ──────────────────────────────────────────────────────────────────────────────────

test("the controls row: flex, wrapping, 10px apart, centred, the two groups at either end (values 2.2)", () => {
  assert.equal(FLOOR_CONTROLS_CLASS, "flex flex-wrap items-center justify-between gap-2.5", "values 2.2");
});

test("the area track and its tabs: the HTML's segmented control, 36 / 32px, the chosen tab's chip (values 2.3)", () => {
  hasAll(FLOOR_TABS_TRACK_CLASS, ["flex", "bg-surface-3", "rounded-[8px]", "p-0.5", "gap-0.5", "max-w-full", "overflow-x-auto"], "values 2.3 track");
  hasAll(FLOOR_TAB_CLASS, ["h-8", "rounded-[6px]", "border-0", "px-3.5", "text-[13.5px]", "font-medium", "text-foreground", "whitespace-nowrap", "cursor-pointer"], "values 2.3 tab");
  assert.ok(!tokens(FLOOR_TAB_CLASS).includes("flex-none"), "the HTML's tab keeps the flex default (shrink 1; its pill is flex:none)");
  // Fix round 1 (spec-2, pin moved on purpose): --tw-shadow carries --seg-sh, so the focus ring's composite keeps the
  // chip's shadow; at rest the arbitrary box-shadow still wins, so the computed string stays exact.
  assert.equal(
    FLOOR_TAB_ON_CLASS,
    "bg-seg [box-shadow:var(--seg-sh)] [--tw-shadow:var(--seg-sh)]",
    "SEG_ON: --seg and --seg-sh exactly at rest (no empty ring layers); under keyboard focus the ring plus --seg-sh",
  );
  assert.ok(!FLOOR_TAB_ON_CLASS.includes("focus-visible:"), "no focus-visible box-shadow: it would tie with focus-visible:ring-2");
  assert.equal(FLOOR_TAB_OFF_CLASS, "bg-transparent hover:bg-hover", "SEG_OFF, plus the kit's hover where a pointer can hover (design 8 #12)");
});

test("the pills: the HTML's row and pill, 32px, the chosen pill on ink with a readable count (values 2.4, design 8 #7)", () => {
  hasAll(FLOOR_PILLS_ROW_CLASS, ["flex", "gap-1.5", "max-w-full", "overflow-x-auto"], "values 2.4 row");
  hasAll(FLOOR_PILL_CLASS, ["flex", "h-8", "flex-none", "items-center", "gap-[7px]", "rounded-[999px]", "border", "px-3", "text-[13px]", "font-medium", "whitespace-nowrap", "cursor-pointer"], "values 2.4 pill");
  assert.equal(FLOOR_PILL_ON_CLASS, "border-ink bg-ink text-on-ink", "on: --ink, its text on-ink");
  assert.equal(FLOOR_PILL_OFF_CLASS, "border-border bg-card text-ink hover:bg-hover", "off: --surface, --border, --ink (+ hover, 8 #12)");
  assert.equal(FLOOR_PILL_COUNT_ON_CLASS, "text-on-ink-muted", "the chosen count: >= 4.5:1 on ink (8 #7)");
  assert.equal(FLOOR_PILL_COUNT_OFF_CLASS, "text-subtle-foreground", "the count: --text-3");
  assert.equal(FLOOR_PILL_DOT_CLASS, "size-2 flex-none rounded-[50%]", "the 8px dot");
  assert.deepEqual(
    FLOOR_FILTER_DOT,
    { free: "bg-status-ok", occupied: "bg-status-info", billed: "bg-status-bill", reserved: "bg-status-reserved" },
    "values 2.4 dots: --ok, --info, --bill, --res (Task 3's tile tones read the same, ruling F2)",
  );
});

test("both rows: no visible bar, an inset focus ring, the HTML's press; WebView 109-safe fades 24px wide (Q4, 8 #9)", () => {
  for (const [name, row] of [["track", FLOOR_TABS_TRACK_CLASS], ["pills", FLOOR_PILLS_ROW_CLASS]]) {
    hasAll(row, ["relative", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden"], `${name}: no bar; the items' offset parent`);
  }
  for (const [name, control] of [["tab", FLOOR_TAB_CLASS], ["pill", FLOOR_PILL_CLASS]]) {
    hasAll(control, ["outline-none", "focus-visible:ring-2", "focus-visible:ring-inset", "focus-visible:ring-primary"], `${name}: a ring the row never clips`);
    assert.ok(control.endsWith(` ${HTML_PRESS_CLASS}`), `${name}: the HTML's press (values 6.2)`);
  }
  assert.equal(FLOOR_FADE_WRAP_CLASS, "relative min-w-0 max-w-full", "the fades' frame: the row's own box");
  hasAll(FLOOR_FADE_PILLS.start, ["pointer-events-none", "absolute", "inset-y-0", "left-0", "w-6", "[background:linear-gradient(to_right,var(--background),transparent)]"], "pills start");
  hasAll(FLOOR_FADE_PILLS.end, ["pointer-events-none", "absolute", "inset-y-0", "right-0", "w-6", "[background:linear-gradient(to_left,var(--background),transparent)]"], "pills end");
  hasAll(FLOOR_FADE_TABS.start, ["inset-y-0.5", "left-0.5", "w-6", "rounded-l-[6px]", "[background:linear-gradient(to_right,var(--surface-3),transparent)]"], "tabs start: inside the track's 2px padding");
  hasAll(FLOOR_FADE_TABS.end, ["inset-y-0.5", "right-0.5", "w-6", "rounded-r-[6px]", "[background:linear-gradient(to_left,var(--surface-3),transparent)]"], "tabs end");
  const all = [FLOOR_TABS_TRACK_CLASS, FLOOR_TAB_CLASS, FLOOR_PILLS_ROW_CLASS, FLOOR_PILL_CLASS, FLOOR_PILL_OFF_CLASS, ...Object.values(FLOOR_FADE_PILLS), ...Object.values(FLOOR_FADE_TABS)].join(" ");
  for (const banned of ["bg-linear", "bg-gradient", "mask-", "color-mix", "oklab", "brand-"]) assert.ok(!all.includes(banned), `no ${banned} (WebView 109, tokens only)`);
  assert.equal(FLOOR_REVEAL_MARGIN, 26, "a revealed tab or pill clears the 24px fade and the track's 2px padding");
});

// ── The token (design 8 #7: the chosen pill's count from a token, >= 4.5:1) ─────────────────────────────────────────

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("--on-ink-muted: #a9a9b2 light, #52525b dark, registered, >= 4.5:1 on --ink in both themes", () => {
  const css = read("app/globals.css");
  const decl = (block: string, name: string) => new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
  const root = [...css.matchAll(/\n:root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).find((b) => b.includes("--on-ink:")) ?? "";
  const dark = /\n\.dark\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.equal(decl(root, "--on-ink-muted"), "#a9a9b2", ":root");
  assert.equal(decl(dark, "--on-ink-muted"), "#52525b", ".dark");
  assert.ok(css.includes("--color-on-ink-muted: var(--on-ink-muted);"), "registered in @theme inline");
  for (const [theme, block] of [["light", root], ["dark", dark]]) {
    const ratio = contrast(decl(block, "--on-ink-muted") ?? "", decl(block, "--ink") ?? "");
    assert.ok(ratio >= 4.5, `${theme}: ${ratio.toFixed(2)}:1 on --ink`);
  }
});

// ── The controls, rendered ──────────────────────────────────────────────────────────────────────────────────────────

const COUNTS: Record<FloorFilter, number> = { all: 10, free: 6, occupied: 2, billed: 1, reserved: 1 };
const pills = (value: FloorFilter) =>
  renderToStaticMarkup(createElement(FloorStatusChips, { counts: COUNTS, value, revealKey: FLOOR_ALL_AREAS, onChange: () => {} }));

test("FloorStatusChips: the five pills in the HTML's order and words, each with its count; the chosen one pressed and on ink", () => {
  const html = pills("billed");
  assert.match(html, /role="group" aria-label="Filter tables by status"/, "the group keeps its label (P11)");
  expectAll(tagOf(html, "floor-pills"), tokens(FLOOR_PILLS_ROW_CLASS), "the row");
  assert.equal(tagsOf(html, "floor-pill").length, 5, "five pills");
  FLOOR_FILTERS.forEach(({ key, label }, i) => {
    const tag = tagOf(html, "floor-pill", i);
    assert.equal(textOf(html, "floor-pill", i), `${label}${COUNTS[key]}`, `${key}: "${label}" and its count`);
    const on = key === "billed";
    assert.match(tag, new RegExp(`aria-pressed="${on}"`), `${key}: aria-pressed ${on}`);
    expectAll(tag, tokens(on ? FLOOR_PILL_ON_CLASS : FLOOR_PILL_OFF_CLASS), `${key} ${on ? "on" : "off"}`);
    assert.ok(!classesOf(tag).includes(on ? "bg-card" : "bg-ink"), `${key}: one look only`);
    expectAll(tagOf(html, "floor-pill-count", i), [on ? FLOOR_PILL_COUNT_ON_CLASS : FLOOR_PILL_COUNT_OFF_CLASS], `${key} count`);
  });
  const dots = tagsOf(html, "floor-pill-dot");
  assert.equal(dots.length, 4, "All has no dot");
  (["free", "occupied", "billed", "reserved"] as const).forEach((k, i) => expectAll(dots[i], [...tokens(FLOOR_PILL_DOT_CLASS), FLOOR_FILTER_DOT[k]], `${k} dot`));
  assert.ok(dots.every((d) => d.includes('aria-hidden="true"')), "the dots are decoration: the word says the state");
});

const TABS: FloorAreaTab[] = [
  { key: FLOOR_ALL_AREAS, name: "All" }, { key: "a1", name: "AC Hall" }, { key: "a2", name: "Garden" }, { key: "none", name: "Other tables" },
];
const tabs = (value: string, list = TABS) => renderToStaticMarkup(createElement(FloorAreaTabs, { tabs: list, value, onChange: () => {} }));
const pressed = (html: string) => tagsOf(html, "floor-area-tab").map((t) => t.includes('aria-pressed="true"'));

test("FloorAreaTabs: the group label, one tab per entry, the chosen one pressed with the chip", () => {
  const html = tabs("a2");
  assert.match(html, /role="group" aria-label="Filter tables by area"/, "the area group's label");
  expectAll(tagOf(html, "floor-area-tabs"), tokens(FLOOR_TABS_TRACK_CLASS), "the track");
  assert.deepEqual(TABS.map((_, i) => textOf(html, "floor-area-tab", i)), ["All", "AC Hall", "Garden", "Other tables"], "the names");
  assert.deepEqual(pressed(html), [false, false, true, false], "Garden pressed");
  expectAll(tagOf(html, "floor-area-tab", 2), [...tokens(FLOOR_TAB_CLASS), ...tokens(FLOOR_TAB_ON_CLASS)], "the chosen tab");
  expectAll(tagOf(html, "floor-area-tab", 0), tokens(FLOOR_TAB_OFF_CLASS), "an off tab");
});

test("Review Focus 1, rendered: a value no tab has lights none; the page's choice through effectiveArea lights All", () => {
  assert.deepEqual(pressed(tabs("removed-area")), [false, false, false, false], "a stale value lights no tab");
  assert.deepEqual(pressed(tabs(effectiveArea("removed-area", TABS))), [true, false, false, false], "the page passes All");
  const fewer = TABS.filter((t) => t.key !== "a2");
  assert.deepEqual(pressed(tabs(effectiveArea("a2", fewer), fewer)), [true, false, false], "Garden emptied: All, nothing stuck");
});

// ── How they scroll (Q4, design 6.3) ────────────────────────────────────────────────────────────────────────────────

test("both controls: the row's own scrollLeft reveals the chosen one (first paint and every change), the fades follow the row", () => {
  const hook = stripComments(read("hooks/use-scroll-fades.ts"));
  assert.match(hook, /addEventListener\("scroll", sync, \{ passive: true \}\)/, "a passive scroll listener");
  assert.ok(hook.includes("new ResizeObserver(sync)") && hook.includes("observer?.disconnect()"), "a ResizeObserver, disconnected");
  assert.ok(hook.includes('removeEventListener("scroll", sync)'), "the listener is removed");
  assert.ok(hook.includes("edgeFades(el)"), "the fades are edgeFades of the row");
  const reveal = hook.slice(hook.indexOf("export function useRevealPressed("));
  assert.ok(reveal.includes("revealScrollLeft(el, pressed, FLOOR_REVEAL_MARGIN)"), "the reveal: the pressed button, clear of the fades");
  assert.ok(reveal.includes("el.scrollLeft = next;"), "the row's own scroll, never the page's");
  assert.match(reveal, /\}, \[row, chosen\]\);/, "on first paint and on every change of the chosen value");
  // Fix round 1 (keep-1): keyboard focus moves the row by the same rule, so a focused tab or pill never sits under a
  // fade; a click's focus does not (the row must not move under the pointer between press and release).
  assert.ok(reveal.includes('el.addEventListener("focusin", revealFocused)'), "a focusin listener on the row");
  assert.ok(reveal.includes('el.removeEventListener("focusin", revealFocused)'), "removed on cleanup");
  assert.ok(reveal.includes("revealScrollLeft(el, target, FLOOR_REVEAL_MARGIN)"), "the focused button, clear of the fades");
  assert.ok(reveal.includes('target.matches(":focus-visible")'), "keyboard focus only");
  assert.match(reveal, /\}, \[row\]\);/, "one listener per row");
  for (const file of ["components/tables/FloorAreaTabs.tsx", "components/tables/FloorStatusChips.tsx"]) {
    const src = stripComments(read(file));
    assert.ok(src.includes("useScrollFades(rowRef)"), `${file}: the fades follow the row`);
    assert.ok(src.includes("ref={rowRef}") && src.includes("{fades.start && ") && src.includes("{fades.end && "), `${file}: the fades drawn`);
  }
  // Fix round 1 (logic-1, pins moved on purpose): the chosen pill is revealed again when the area shown changes (its
  // counts change width), keyed on that user choice only: never on a count change, which would undo a swipe each poll.
  assert.ok(stripComments(read("components/tables/FloorAreaTabs.tsx")).includes("useRevealPressed(rowRef, value)"), "the chosen tab revealed");
  assert.ok(stripComments(read("components/tables/FloorStatusChips.tsx")).includes("useRevealPressed(rowRef, `${value}|${revealKey}`)"), "the chosen pill revealed, per area");
});
