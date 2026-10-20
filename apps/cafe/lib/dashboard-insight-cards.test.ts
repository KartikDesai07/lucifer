import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import { CATEGORY_HUES, categoryHue } from "@/lib/ui";
import { DASH_PILL_CLASS } from "@/components/dashboard/DashCard";
import { busiestCell, busiestWords, heatCap, heatCellLabel, heatHourTick, heatKeyTarget, heatLevel } from "@/lib/dashboard/busy-hours";
import { insightWords, slowItemLine } from "@/lib/dashboard/labels";
import {
  CARDS_TODAY,
  classesOf,
  dashboardFixture,
  expectClasses,
  readyCard,
  styleOf,
  tagOf,
  tagsOf,
  textsOf,
} from "@/lib/dashboard/cards.fixtures";
import type { DashboardData, DashboardHeat } from "@/types/dashboard";

// U0 match Task 9: the last four dashboard cards as the owner's HTML draws them — Top items (values 3.12), Sales by
// category (3.13, ruling R20), Slow movers (3.14, ruling R21) and Busy hours (3.15, ruling R19) — with our data and our
// words where they come from our data (ruling R17).

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE = path.join(HERE, "..");
const readSrc = (rel: string) => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

async function render(card: "TopItemsCard" | "CategoriesCard" | "SlowItemsCard" | "BusyHoursCard", over: Partial<DashboardData>) {
  const cards = await import("@/components/dashboard/RangeCards");
  return renderToStaticMarkup(createElement(cards[card], readyCard(over)));
}

// ── Top items (values 3.12) ─────────────────────────────────────────────────────────────────────────────────────────

const TOP: DashboardData["topItems"] = [
  { label: "Chicken Biryani", qty: 38, revenue: 13262 },
  { label: "Butter Chicken", qty: 42, revenue: 12558 },
  { label: "Margherita", qty: 31, revenue: 10819 },
  { label: "Paneer Butter Masala", qty: 24, revenue: 6696 },
  { label: "Cold Coffee", qty: 29, revenue: 3741 },
];

test("TopItemsCard: the HTML's head and list - 'Top items', '{period} · by sales', the rows 8px under it, no separators", async () => {
  const html = await render("TopItemsCard", { topItems: TOP });
  assert.ok(tagOf(html, "top-card").startsWith("<section"), "the card names itself for the probes (data-ui top-card)");
  assert.ok(html.includes(">Top items</h2>") && html.includes(">Today · by sales</p>"), "the HTML's title and its sub with our period");
  assert.ok(!html.includes('data-ui="dash-card-link"'), "no header link (values 3.12)");
  assert.ok(html.includes('class="transition-opacity duration-200 mt-2"'), "the list 8px under the head");
  expectClasses(tagOf(html, "top-list"), ["flex", "flex-col"], "the list");
  const rows = tagsOf(html, "top-row");
  assert.equal(rows.length, 5, "a row per top item");
  for (const r of rows) {
    expectClasses(r, ["grid", "grid-cols-[24px_minmax(0,1fr)_auto]", "items-center", "gap-2.5", "py-2"], "a row: 24px | 1fr | auto, gap 10, 8px 0");
    assert.ok(!classesOf(r).some((c) => c.startsWith("border")), "no separators between the rows (values 3.12)");
  }
  assert.ok(!/RankedList|brand-primary|h-1\.5/.test(html), "no ranked-list bar or Paper & Ink token left");
});

test("TopItemsCard: a row - the mono rank (01 in the brand red), a 7px dot, the name, a 4px accent bar on surface-3, the amount and 'n sold'", async () => {
  const html = await render("TopItemsCard", { topItems: TOP });
  assert.deepEqual(textsOf(html, "top-rank"), ["01", "02", "03", "04", "05"], "two-digit ranks");
  const ranks = tagsOf(html, "top-rank");
  for (const r of ranks) expectClasses(r, ["font-mono", "text-[13px]", "font-semibold"], "a rank: Geist Mono 13/600");
  expectClasses(ranks[0], ["text-brand-red"], "rank 01 in --brand (values 3.12 t.rc)");
  for (const r of ranks.slice(1)) {
    expectClasses(r, ["text-subtle-foreground"], "ranks 02-05 in text-3");
    assert.ok(!classesOf(r).includes("text-brand-red"), "only rank 01 is red");
  }
  expectClasses(tagOf(html, "top-name"), ["flex", "items-center", "gap-[7px]", "overflow-hidden", "whitespace-nowrap", "text-[13.5px]", "font-medium"], "the name line: 13.5/500, nowrap, 7px after the dot");
  // Our top items carry no category (DashboardData.topItems: label, qty, revenue), so the dot takes the HTML's own
  // fallback, text-3 (app.js: SEC_HUE[...] || 'var(--text-3)').
  for (const dot of tagsOf(html, "top-dot")) expectClasses(dot, ["size-[7px]", "flex-none", "rounded-[50%]", "bg-subtle-foreground"], "the 7px round dot in text-3");
  assert.ok(html.includes('<span class="truncate">Chicken Biryani</span>'), "the name ellipsised");
  expectClasses(tagOf(html, "top-bar"), ["mt-[7px]", "block", "h-1", "overflow-hidden", "rounded-[2px]", "bg-surface-3"], "the track: 4px, radius 2, surface-3, 7px under the name");
  const fills = tagsOf(html, "top-fill");
  for (const f of fills) expectClasses(f, ["block", "h-full", "rounded-[2px]", "bg-primary", "origin-left", "motion-safe:animate-grow-x-slow"], "the accent fill growing from the left (.9s)");
  assert.deepEqual(
    fills.map((f) => styleOf(f)),
    ["width:100%", "width:95%", "width:82%", "width:50%", "width:28%"],
    "each fill as long as its sales against the first (the HTML's round(a / top * 100))",
  );
  expectClasses(tagOf(html, "top-right"), ["text-right"], "the right column");
  expectClasses(tagOf(html, "top-amount"), ["block", "font-mono", "text-[13.5px]", "font-semibold"], "the amount: Geist Mono 600 13.5");
  expectClasses(tagOf(html, "top-sold"), ["block", "text-[11.5px]", "text-subtle-foreground"], "'n sold': 11.5 text-3");
  assert.deepEqual(textsOf(html, "top-amount"), ["₹13,262", "₹12,558", "₹10,819", "₹6,696", "₹3,741"], "our revenue");
  assert.deepEqual(textsOf(html, "top-sold"), ["38 sold", "42 sold", "31 sold", "24 sold", "29 sold"], "our quantity");
});

test("the Top items bar (accent on surface-3) stands out from its track (non-text 3:1)", () => {
  const css = readFileSync(path.join(CAFE, "app/globals.css"), "utf8");
  const root = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((b) => b[1]).join("\n");
  const hex = (name: string) => root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1] ?? "";
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const accent = hex("brand-primary");
  const track = hex("surface-3");
  assert.ok(accent && track, "landmark: --brand-primary (the --primary the fill paints) and --surface-3 are hex on :root");
  const ratio = (lum(track) + 0.05) / (lum(accent) + 0.05);
  assert.ok(ratio >= 3, `the accent fill on surface-3 is ${ratio.toFixed(2)}:1, needs 3:1`);
});

// ── Sales by category (values 3.13, ruling R20) ─────────────────────────────────────────────────────────────────────

const CATS: DashboardData["categories"] = [
  { key: "c1", label: "Mains", amount: 24110, count: 60, share: 0.4822 },
  { key: "c2", label: "Drinks", amount: 7960, count: 40, share: 0.1592 },
  { key: "c3", label: "Starters", amount: 7240, count: 30, share: 0.1448 },
  { key: "c4", label: "Sides", amount: 4820, count: 25, share: 0.0964 },
  { key: "c5", label: "Desserts", amount: 4120, count: 20, share: 0.0824 },
  { key: "Other categories", label: "Other categories", amount: 1750, count: 9, share: 0.035 },
];

test("the category hues (ruling R20): the HTML's five section hues by rank, the sixth row in text-3", () => {
  assert.deepEqual([...CATEGORY_HUES], ["#e8590c", "#c92a2a", "#d19a00", "#1c7ed6", "#ae3ec9"], "SEC_HUE's Starters, Mains, Sides, Drinks, Desserts, in that order");
  assert.deepEqual([0, 1, 2, 3, 4].map(categoryHue), [...CATEGORY_HUES], "ranks 1-5 take the five hues");
  assert.equal(categoryHue(5), "var(--subtle-foreground)", "the sixth row (Other categories) takes the HTML's fallback, text-3");
  assert.ok(readSrc("lib/ui/palette.ts").includes("CATEGORY_HUES"), "the one constant lives in lib/ui");
});

test("CategoriesCard: the HTML's 26px stacked bar of the category hues, then a row per category under a border-2 rule", async () => {
  const html = await render("CategoriesCard", { categories: CATS });
  assert.ok(tagOf(html, "cat-card").startsWith("<section"), "the card names itself (data-ui cat-card)");
  assert.ok(html.includes(">Sales by category</h2>") && html.includes(">Today · share of item sales</p>"), "the HTML's title and sub pattern");
  assert.ok(html.includes('class="transition-opacity duration-200 mt-3.5"'), "the bar 14px under the head");
  expectClasses(tagOf(html, "cat-bar"), ["flex", "h-[26px]", "gap-0.5", "overflow-hidden", "rounded-[7px]"], "the bar: 26px, radius 7, 2px apart");
  const segs = tagsOf(html, "cat-seg");
  assert.equal(segs.length, 6, "a segment per category with a share");
  assert.deepEqual(
    segs.map(styleOf),
    [
      "width:48.2%;background:#e8590c",
      "width:15.9%;background:#c92a2a",
      "width:14.5%;background:#d19a00",
      "width:9.6%;background:#1c7ed6",
      "width:8.2%;background:#ae3ec9",
      "width:3.5%;background:var(--subtle-foreground)",
    ],
    "each segment as wide as its share, in its rank's hue",
  );
  assert.ok(segs[0].includes('title="Mains"'), "a segment names its category on hover (the HTML's title)");
  expectClasses(tagOf(html, "cat-list"), ["mt-2.5", "flex", "flex-col"], "the rows 10px under the bar");
  const rows = tagsOf(html, "cat-row");
  assert.equal(rows.length, 6, "a row per category, Other categories last");
  for (const r of rows) expectClasses(r, ["flex", "items-center", "gap-2.5", "border-t", "border-border-2", "py-2", "text-[13.5px]"], "a row: 8px 0 over a border-2 rule, 13.5px, 10 apart");
  const dots = tagsOf(html, "cat-dot");
  for (const d of dots) expectClasses(d, ["size-[9px]", "shrink-0", "rounded-[50%]"], "the 9px round dot");
  assert.deepEqual(
    dots.map(styleOf),
    segs.map((s) => styleOf(s).replace(/^width:[^;]*;/, "")),
    "each dot in its segment's hue",
  );
  assert.ok(html.includes('<span class="flex-1">Mains</span>'), "the name takes the rest of the row");
  expectClasses(tagOf(html, "cat-amount"), ["font-mono", "font-semibold"], "the amount in Geist Mono 600");
  expectClasses(tagOf(html, "cat-pct"), ["w-9", "text-right", "text-[12px]", "text-subtle-foreground"], "the 36px share in 12px text-3");
  assert.deepEqual(textsOf(html, "cat-amount"), ["₹24,110", "₹7,960", "₹7,240", "₹4,820", "₹4,120", "₹1,750"], "our amounts");
  assert.deepEqual(textsOf(html, "cat-pct"), ["48%", "16%", "14%", "10%", "8%", "4%"], "our shares");
});

// ── Slow movers (values 3.14, ruling R21) ───────────────────────────────────────────────────────────────────────────

const SLOW: DashboardData["slowItems"] = [
  { productId: "p1", name: "Crispy Corn", qty: 0 },
  { productId: "p2", name: "Veg Dum Biryani", qty: 0, since: "2026-10-02" },
  { productId: "p3", name: "Garlic Bread", qty: 1 },
  { productId: "p4", name: "Chicken Manchow", qty: 2, since: "2026-10-05" },
  { productId: "p5", name: "Mutton Rogan Josh", qty: 2 },
];

test("insightWords: the insight period inside a sentence ('last 4 weeks', '4 weeks to 12 Oct', 'last 7 days', a date span)", () => {
  assert.equal(insightWords(dashboardFixture(), CARDS_TODAY), "last 4 weeks", "a short range reads the four weeks to today");
  const earlier = dashboardFixture({ range: { from: "2026-10-12", to: "2026-10-12" }, heat: { from: "2026-09-15", to: "2026-10-12", hours: [], avg: [], max: 0 } });
  assert.equal(insightWords(earlier, CARDS_TODAY), "4 weeks to 12 Oct", "a past day reads the four weeks to it");
  const week = dashboardFixture({ range: { from: "2026-10-10", to: CARDS_TODAY }, heat: { from: "2026-10-10", to: CARDS_TODAY, hours: [], avg: [], max: 0 } });
  assert.equal(insightWords(week, CARDS_TODAY), "last 7 days", "a week reads itself");
  const span = dashboardFixture({ range: { from: "2026-09-01", to: "2026-09-14" }, heat: { from: "2026-09-01", to: "2026-09-14", hours: [], avg: [], max: 0 } });
  assert.equal(insightWords(span, CARDS_TODAY), "1 Sep – 14 Sep", "a picked span reads its dates");
});

test("slowItemLine (ruling R21): the HTML's line under every slow mover, from our data", () => {
  const d = dashboardFixture();
  assert.deepEqual(
    SLOW.map((s) => slowItemLine(s, d, CARDS_TODAY)),
    ["No orders in the last 4 weeks", "Added 2 Oct · never ordered", "Last 4 weeks", "Added 5 Oct", "Last 4 weeks"],
    "unsold: 'No orders in the {period}' / 'Added {day} · never ordered'; sold: 'Added {day}' / the period capitalised",
  );
  const span = dashboardFixture({ range: { from: "2026-09-01", to: "2026-09-14" }, heat: { from: "2026-09-01", to: "2026-09-14", hours: [], avg: [], max: 0 } });
  assert.equal(slowItemLine(SLOW[0], span, CARDS_TODAY), "No orders in 1 Sep – 14 Sep", "a date span takes no 'the'");
  const earlier = dashboardFixture({ range: { from: "2026-10-12", to: "2026-10-12" }, heat: { from: "2026-09-15", to: "2026-10-12", hours: [], avg: [], max: 0 } });
  assert.equal(slowItemLine(SLOW[0], earlier, CARDS_TODAY), "No orders in the 4 weeks to 12 Oct", "the four weeks to a past day");
});

test("SlowItemsCard: the HTML's head with 'Menu →', rows of a dot, the name and its line, and the tag pill", async () => {
  const html = await render("SlowItemsCard", { slowItems: SLOW });
  assert.ok(tagOf(html, "slow-card").startsWith("<section"), "the card names itself (data-ui slow-card)");
  assert.ok(html.includes(">Slow movers</h2>") && html.includes(">Fewest sold · last 4 weeks</p>"), "the HTML's title and its sub with our insight period");
  assert.ok(tagOf(html, "dash-card-link").includes('href="/products"'), "the header link goes to our menu page");
  assert.deepEqual(textsOf(html, "dash-card-link"), ["Menu →"], "in the HTML's words");
  expectClasses(tagOf(html, "dash-card-head"), ["gap-2.5"], "the head as Money leaks': 10px between the words and the link");
  assert.ok(html.includes('class="transition-opacity duration-200 mt-2.5"'), "the rows 10px under the head");
  const rows = tagsOf(html, "slow-row");
  assert.equal(rows.length, 5, "a row per slow mover");
  for (const r of rows) expectClasses(r, ["flex", "items-center", "gap-2.5", "border-t", "border-border-2", "py-[9px]"], "a row: 9px 0 over a border-2 rule, 10 apart");
  expectClasses(tagOf(html, "slow-name"), ["flex", "items-center", "gap-[7px]", "overflow-hidden", "whitespace-nowrap", "text-[13.5px]", "font-medium"], "the name line as Top items'");
  for (const dot of tagsOf(html, "slow-dot")) expectClasses(dot, ["size-[7px]", "flex-none", "rounded-[50%]", "bg-subtle-foreground"], "our slow movers carry no category: the text-3 dot");
  assert.ok(html.includes('<span class="truncate">Crispy Corn</span>'), "the name ellipsised");
  for (const s of tagsOf(html, "slow-since")) expectClasses(s, ["mt-0.5", "block", "pl-3.5", "text-[12px]", "text-subtle-foreground"], "the line: 12px text-3, 2px under the name, 14px in");
  assert.deepEqual(
    textsOf(html, "slow-since"),
    ["No orders in the last 4 weeks", "Added 2 Oct · never ordered", "Last 4 weeks", "Added 5 Oct", "Last 4 weeks"],
    "every row has its line (ruling R21)",
  );
  const tags = tagsOf(html, "slow-tag");
  for (const t of tags) expectClasses(t, [...DASH_PILL_CLASS.split(" "), "whitespace-nowrap"], "the HTML's 24px pill");
  assert.deepEqual(textsOf(html, "slow-tag"), ["Not sold", "Not sold", "1 sold", "2 sold", "2 sold"], "our tag words");
  expectClasses(tags[0], ["bg-status-warn-tint", "text-status-warn-ink"], "not sold: warn-t / warn-i (values 3.14)");
  expectClasses(tags[2], ["bg-surface-3", "text-muted-foreground"], "sold: surface-3 / text-2");
});

// ── Busy hours (values 3.15, ruling R19) ────────────────────────────────────────────────────────────────────────────

const ONE = Array.from({ length: 12 }, () => 1);
const HEAT: DashboardHeat = {
  from: "2026-09-19",
  to: CARDS_TODAY,
  hours: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  avg: [
    [0, 1.1, 2.2, 3.3, 4.4, 0.5, 1, 1, 1, 1, 1, 1],
    ONE,
    ONE,
    ONE,
    ONE,
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 5.5, 1, 1],
    Array.from({ length: 12 }, () => 2),
  ],
  max: 5.5,
};

test("the busy-hours model: the HTML's levels, the busiest cell, the cap read-out and the hour ticks", () => {
  assert.deepEqual([0, 0.5, 1.1, 2.2, 3.3, 4.4, 5.5, 9].map((v) => heatLevel(v, 5.5)), [0, 1, 1, 2, 3, 4, 5, 5], "lvl(v) = v <= 0 ? 0 : min(5, ceil(v / max * 5))");
  assert.equal(heatLevel(3, 0), 0, "no orders at all: level 0");
  assert.deepEqual(busiestCell(HEAT), { weekday: 5, hourIndex: 9 }, "Saturday 8 pm");
  assert.equal(busiestCell({ ...HEAT, avg: HEAT.avg.map((r) => r.map(() => 0)), max: 0 }), null, "nothing busiest when nothing was ordered");
  assert.deepEqual(busiestWords(HEAT), { when: "Saturday, 8 pm – 9 pm", orders: "5.5 orders" }, "the footer's words");
  assert.deepEqual(heatCap(HEAT, null), { label: "Hover any hour", value: "to see the average" }, "idle: the HTML's words");
  assert.deepEqual(heatCap(undefined, null), { label: "Hover any hour", value: "to see the average" }, "loading: the same");
  assert.deepEqual(heatCap(HEAT, { weekday: 0, hourIndex: 1 }), { label: "Mon, 12 pm", value: "1.1 orders" }, "picked: '{Day}, {hour}' / '{v} orders'");
  assert.deepEqual(heatCap(HEAT, { weekday: 1, hourIndex: 0 }), { label: "Tue, 11 am", value: "1 order" }, "one order is singular");
  assert.equal(heatCellLabel(HEAT, { weekday: 0, hourIndex: 0 }), "Monday, 11 am to 12 pm: 0 orders on average", "a cell's full name");
  assert.deepEqual(HEAT.hours.map(heatHourTick), ["11am", "", "1pm", "", "3pm", "", "5pm", "", "7pm", "", "9pm", ""], "every other hour labelled, as the HTML's 11am, 1pm, …");
});

test("BusyHoursCard: the HTML's head - 'Busy hours', our insight period, the cap box as our read-out (aria-live)", async () => {
  const html = await render("BusyHoursCard", { heat: HEAT });
  assert.ok(tagOf(html, "busy-card").startsWith("<section"), "the card names itself (data-ui busy-card)");
  assert.ok(html.includes(">Busy hours</h2>") && html.includes(">Orders per hour on an average day · last 4 weeks</p>"), "the HTML's title and sub with our period");
  expectClasses(tagOf(html, "dash-card-head"), ["flex", "items-start", "justify-between", "gap-3", "flex-wrap"], "the head wraps, 12px apart");
  const cap = tagOf(html, "heat-cap");
  expectClasses(cap, ["flex", "h-[34px]", "items-center", "gap-2", "whitespace-nowrap", "rounded-[9px]", "border", "border-border-2", "bg-surface-2", "px-3", "text-[13px]"], "the cap box: 34px, 0 12px, radius 9, surface-2 on a border-2 line, 13px");
  assert.ok(cap.includes('aria-live="polite"'), "the cap box is the read-out a screen reader hears");
  assert.ok(
    html.includes('<span class="text-subtle-foreground">Hover any hour</span><b class="font-semibold">to see the average</b>'),
    "idle: the HTML's words, the label in text-3, the value 600",
  );
  assert.ok(
    html.includes('class="transition-opacity duration-200 mt-3.5 min-h-[310px] @min-[560px]:min-h-[283px]"'),
    "the grid 14px under the head; the body holds the loaded height (283px, 310px on a phone where the footer wraps)",
  );
});

test("BusyHoursCard: one grid at every width - 40px + our hours as columns, min 560px in a sideways scroller, 30px cells radius 6", async () => {
  const html = await render("BusyHoursCard", { heat: HEAT });
  expectClasses(tagOf(html, "heat-scroll"), ["overflow-x-auto", "[&amp;::-webkit-scrollbar]:h-0"], "the scroller: sideways, no scrollbar height (the HTML's ::-webkit-scrollbar height 0)");
  assert.equal(tagsOf(html, "heat-grid").length, 1, "one grid: no transposed phone layout (ruling R19)");
  const grid = tagOf(html, "heat-grid");
  expectClasses(grid, ["grid", "min-w-[560px]", "gap-1"], "the grid: min 560px, 4px gaps");
  assert.equal(styleOf(grid), "grid-template-columns:40px repeat(12, minmax(0, 1fr))", "the 40px day column and one column per hour of ours (12)");
  assert.ok(!/sm:hidden|sm:grid|hidden sm:/.test(html), "no breakpoint swaps the layout");
  const ticks = tagsOf(html, "heat-hour");
  assert.equal(ticks.length, 12, "an hour label per column");
  for (const t of ticks) expectClasses(t, ["whitespace-nowrap", "text-center", "text-[11px]", "text-subtle-foreground"], "an hour label: 11px text-3, centred");
  assert.deepEqual(textsOf(html, "heat-hour"), ["11am", "", "1pm", "", "3pm", "", "5pm", "", "7pm", "", "9pm", ""], "every other hour");
  assert.deepEqual(textsOf(html, "heat-day"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "weekdays down, Monday first");
  const days = tagsOf(html, "heat-day");
  for (const d of days) expectClasses(d, ["flex", "items-center", "text-[12px]"], "a day label: 12px");
  expectClasses(days[4], ["font-semibold", "text-foreground"], "today (Friday 16 Oct) in --text 600");
  for (const d of [...days.slice(0, 4), ...days.slice(5)]) expectClasses(d, ["text-muted-foreground"], "the other days in text-2");
  const cells = tagsOf(html, "heat-cell");
  assert.equal(cells.length, 7 * 12, "a cell per weekday and hour");
  for (const c of cells) {
    assert.ok(c.startsWith("<button"), "each cell is a button (focusable)");
    expectClasses(c, ["h-[30px]", "rounded-[6px]", "transition-[box-shadow]", "duration-[120ms]", "ease-[ease]"], "a cell: 30px, radius 6, the ring's .12s transition");
    expectClasses(c, ["focus-visible:outline-none", "focus-visible:[box-shadow:0_0_0_2px_var(--foreground)]"], "a keyboard-focused cell always shows the ring");
  }
  assert.ok(cells[0].includes('aria-label="Monday, 11 am to 12 pm: 0 orders on average"'), "each cell names itself in full");
  const levelClass = ["bg-surface-2", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-primary"];
  assert.deepEqual(
    cells.slice(0, 6).map((c) => levelClass.findIndex((l) => classesOf(c).includes(l))),
    [0, 1, 2, 3, 4, 1],
    "Monday's first cells in the HTML's six steps (surface-2, four accent tints, the accent)",
  );
  assert.ok(classesOf(cells[5 * 12 + 9]).includes("bg-primary"), "the busiest cell in the accent");
  assert.ok(!cells.some((c) => classesOf(c).includes("[box-shadow:0_0_0_2px_var(--foreground)]")), "no ring while nothing is picked");
});

test("BusyHoursGrid: the picked cell carries the HTML's 2px --text ring; the cap reads it out", async () => {
  const { BusyHoursCap, BusyHoursGrid } = await import("@/components/dashboard/BusyHours");
  const cell = { weekday: 5, hourIndex: 9 };
  const grid = renderToStaticMarkup(createElement(BusyHoursGrid, { heat: HEAT, today: CARDS_TODAY, cell, onPick: () => {}, onClear: () => {} }));
  const ringed = tagsOf(grid, "heat-cell").filter((c) => classesOf(c).includes("[box-shadow:0_0_0_2px_var(--foreground)]"));
  assert.equal(ringed.length, 1, "exactly one cell ringed");
  assert.ok(ringed[0].includes('aria-label="Saturday, 8 pm to 9 pm: 5.5 orders on average"'), "the picked one");
  const cap = renderToStaticMarkup(createElement(BusyHoursCap, { heat: HEAT, cell }));
  assert.ok(cap.includes('<span class="text-subtle-foreground">Sat, 8 pm</span><b class="font-semibold">5.5 orders</b>'), "the cap names the hour and its average");
});

test("BusyHoursCard: the footer - 'Busiest: {day, hour – hour}' in --text 600 and its average; Fewer, six 14px steps, More", async () => {
  const html = await render("BusyHoursCard", { heat: HEAT });
  expectClasses(tagOf(html, "heat-foot"), ["mt-3.5", "flex", "flex-wrap", "items-center", "justify-between", "gap-2.5", "text-[12.5px]", "text-muted-foreground"], "the footer: 14px under the grid, 12.5px text-2, wrapping 10px apart");
  assert.equal(
    /<span data-ui="heat-busiest">(.*?)<\/span>/.exec(html)?.[1],
    'Busiest: <b class="font-semibold text-foreground">Saturday, 8 pm – 9 pm</b> · 5.5 orders on average',
    "the HTML's sentence with our busiest hour",
  );
  const legend = tagOf(html, "heat-legend");
  expectClasses(legend, ["flex", "items-center", "gap-1"], "the legend: 4px apart");
  assert.ok(legend.includes('aria-hidden="true"'), "the legend is decoration (the cells name themselves)");
  const swatches = tagsOf(html, "heat-swatch");
  assert.equal(swatches.length, 6, "six steps");
  const levelClass = ["bg-surface-2", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-primary"];
  swatches.forEach((s, i) => expectClasses(s, ["size-3.5", "rounded-[3px]", levelClass[i]], `step ${i}: 14px, radius 3`));
  assert.ok(/data-ui="heat-legend"[^>]*>Fewer<span/.test(html) && /<\/span>More<\/span>/.test(html), "'Fewer' before the steps, 'More' after");
  const quiet = await render("BusyHoursCard", { heat: { ...HEAT, avg: HEAT.avg.map((r) => r.map(() => 0)), max: 0 } });
  assert.ok(!quiet.includes("Busiest:"), "no busiest hour when nothing was ordered");
});

test("BusyHoursCard: our hours size the columns (13 hours -> 13 columns); the empty heat keeps the one-line empty state", async () => {
  const hours = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const heat: DashboardHeat = { ...HEAT, hours, avg: HEAT.avg.map((r) => [...r, 0]) };
  const html = await render("BusyHoursCard", { heat });
  assert.equal(styleOf(tagOf(html, "heat-grid")), "grid-template-columns:40px repeat(13, minmax(0, 1fr))", "the HTML's 13 columns when we have 13 hours");
  const empty = await render("BusyHoursCard", { heat: { ...HEAT, hours: [], avg: [], max: 0 } });
  assert.ok(empty.includes('data-ui="dash-empty"') && empty.includes(">Not enough orders yet</p>"), "no hours: our empty line");
  assert.ok(!empty.includes('data-ui="heat-cap"'), "no cap box over an empty card");
});

test("the heat steps are precomputed hex tokens (no color-mix on WebView 109), light and dark, staff-only", () => {
  const css = readFileSync(path.join(CAFE, "app/globals.css"), "utf8");
  const block = (sel: RegExp) => [...css.matchAll(sel)].map((b) => b[1]).join("\n");
  const root = block(/:root\s*\{([^}]*)\}/g);
  const dark = block(/\.dark\s*\{([^}]*)\}/g);
  // color-mix(in oklab, #0F62FE P%, surface) for P = 16, 30, 48, 70 over #FFFFFF (light) and #17171A (dark).
  const light = ["#dae8ff", "#b9d4ff", "#90baff", "#5e97ff"];
  const night = ["#1a243a", "#1b2f57", "#1c3c7f", "#1a4cb3"];
  light.forEach((hex, i) => assert.ok(root.includes(`--heat-${i + 1}: ${hex};`), `--heat-${i + 1} is ${hex} on :root`));
  night.forEach((hex, i) => assert.ok(dark.includes(`--heat-${i + 1}: ${hex};`), `--heat-${i + 1} is ${hex} in .dark`));
  for (let i = 1; i <= 4; i += 1) assert.ok(css.includes(`--color-heat-${i}: var(--heat-${i});`), `--color-heat-${i} is registered in @theme`);
  assert.ok(!/color-mix\(/.test(readSrc("components/dashboard/BusyHours.tsx")), "no runtime color-mix");
  assert.ok(/heat-/.test(readSrc("lib/kit-look-paths.test.ts")), "the kit-look guard names the heat steps staff-only");
});

test("the four cards leave the numerals to the root (ruling R24: the HTML's tabular-nums is page-wide, lib/html-global-rules.test.ts)", async () => {
  const data = { topItems: TOP, categories: CATS, slowItems: SLOW, heat: HEAT };
  for (const [card, ui] of [["TopItemsCard", "top-card"], ["CategoriesCard", "cat-card"], ["SlowItemsCard", "slow-card"], ["BusyHoursCard", "busy-card"]] as const) {
    assert.ok(!classesOf(tagOf(await render(card, data), ui)).includes("tabular-nums"), `${card} sets no numerals of its own`);
  }
  assert.ok(!readSrc("components/dashboard/RangeCards.tsx").includes("HTML_NUMERALS"), "no per-card numerals class left");
});

// ── fix round 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("CategoriesCard reserves the HTML's five rows (36 + 5 x 35 = 211px), so a sixth row grows the card and five leave no band", async () => {
  const five = await render("CategoriesCard", { categories: CATS.slice(0, 5) });
  assert.ok(
    five.includes('<div style="min-height:211px" class="transition-opacity duration-200 mt-3.5">'),
    "the loaded body holds 211px: the 26px bar, 10px, five 35px rows (values 3.13: the card 302px on a phone)",
  );
  const loading = renderToStaticMarkup(createElement((await import("@/components/dashboard/RangeCards")).CategoriesCard, { ...readyCard(), data: undefined, status: "loading" }));
  assert.ok(loading.includes('style="height:211px"'), "the skeleton holds the same 211px");
});

test("Busy hours is one tab stop (a roving tabindex): the arrows move across hours and days, Home and End to a row's ends", async () => {
  const { BusyHoursGrid } = await import("@/components/dashboard/BusyHours");
  const grid = renderToStaticMarkup(createElement(BusyHoursGrid, { heat: HEAT, today: CARDS_TODAY, cell: null, onPick: () => {}, onClear: () => {} }));
  const cells = tagsOf(grid, "heat-cell");
  const stops = cells.filter((c) => c.includes('tabindex="0"'));
  assert.equal(stops.length, 1, "one tab stop in the grid");
  assert.equal(cells.filter((c) => c.includes('tabindex="-1"')).length, cells.length - 1, "every other cell is reached by the arrows");
  assert.ok(stops[0].includes('aria-label="Saturday, 8 pm to 9 pm: 5.5 orders on average"'), "with nothing picked, the stop is the busiest hour");
  const picked = renderToStaticMarkup(createElement(BusyHoursGrid, { heat: HEAT, today: CARDS_TODAY, cell: { weekday: 0, hourIndex: 2 }, onPick: () => {}, onClear: () => {} }));
  assert.ok(tagsOf(picked, "heat-cell").filter((c) => c.includes('tabindex="0"'))[0]?.includes('aria-label="Monday, 1 pm to 2 pm'), "a picked cell is the stop");
  const at = { weekday: 3, hourIndex: 5 };
  const size = { days: 7, hours: 12 };
  assert.deepEqual(heatKeyTarget(at, "ArrowRight", size), { weekday: 3, hourIndex: 6 }, "Right: the next hour");
  assert.deepEqual(heatKeyTarget(at, "ArrowLeft", size), { weekday: 3, hourIndex: 4 }, "Left: the hour before");
  assert.deepEqual(heatKeyTarget(at, "ArrowDown", size), { weekday: 4, hourIndex: 5 }, "Down: the next day");
  assert.deepEqual(heatKeyTarget(at, "ArrowUp", size), { weekday: 2, hourIndex: 5 }, "Up: the day before");
  assert.deepEqual(heatKeyTarget(at, "Home", size), { weekday: 3, hourIndex: 0 }, "Home: the row's first hour");
  assert.deepEqual(heatKeyTarget(at, "End", size), { weekday: 3, hourIndex: 11 }, "End: the row's last hour");
  assert.deepEqual(heatKeyTarget({ weekday: 6, hourIndex: 11 }, "ArrowRight", size), { weekday: 6, hourIndex: 11 }, "the edges hold");
  assert.deepEqual(heatKeyTarget({ weekday: 0, hourIndex: 0 }, "ArrowUp", size), { weekday: 0, hourIndex: 0 }, "the top edge holds");
  assert.equal(heatKeyTarget(at, "Enter", size), null, "other keys are left alone");
  const src = readSrc("components/dashboard/BusyHours.tsx");
  assert.ok(src.includes("heatKeyTarget(") && src.includes(".focus()"), "the grid moves the focus to the target cell");
});

test("Busy hours: leaving the grid with the pointer keeps the pick while a cell holds the keyboard focus", () => {
  const src = readSrc("components/dashboard/BusyHours.tsx");
  assert.match(src, /onMouseLeave=\{\(e\) => \{\s*if \(!e\.currentTarget\.querySelector\(":focus-visible"\)\) onClear\(\);\s*\}\}/, "the grid clears on leave only when no cell is keyboard-focused");
});

// ── what goes and what stays ────────────────────────────────────────────────────────────────────────────────────────

test("RankedList is gone (ruling R23); the reports' Busy hours keeps its look until its own session", async () => {
  assert.ok(!existsSync(path.join(CAFE, "components/dashboard/RankedList.tsx")), "no RankedList left: nothing uses it");
  assert.ok(!readSrc("components/dashboard/RangeCards.tsx").includes("RankedList"), "the cards draw their own rows");
  const { BusyHours } = await import("@/components/dashboard/BusyHours");
  const report = renderToStaticMarkup(createElement(BusyHours, { heat: HEAT }));
  assert.ok(report.includes("hidden gap-[3px] sm:grid") && report.includes("grid gap-[3px] sm:hidden"), "the reports page keeps its two grids (desktop and transposed phone)");
  assert.ok(!report.includes('data-ui="heat-grid"'), "and none of the dashboard's markup");
  assert.ok(readSrc("app/(dashboard)/reports/order-types/page.tsx").includes("<BusyHours heat={heat} />"), "the reports page still draws BusyHours");
});
