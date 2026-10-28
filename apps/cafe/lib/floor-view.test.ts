// U3 Task 3 (2026-10-28): the Floor's tiles and area sections, the owner's HTML (docs/superpowers/specs/2026-10-28-floor-html-values.md
// 3.1-3.2 sections, 4.1-4.5 tiles; design 6.4 / 6.5 in docs/superpowers/specs/2026-10-28-floor-match-html-design.md, owner
// Q2). floorTileView row by row (design 6.5's table, today's kinds K1-K10), the tones, the class strings, then renders of
// FloorTile per kind and of FloorAreaSections. Review Focus 3: the name truncates, the seats and the status word never wrap.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { FLOOR_FILTER_DOT } from "./floor-layout";
import {
  FLOOR_DETAIL_PHONE_CLASS, FLOOR_DETAIL_WIDE_CLASS, FLOOR_SECTION_CLASS, FLOOR_SECTION_COUNT_CLASS, FLOOR_SECTION_HEAD_CLASS,
  FLOOR_SECTION_NAME_CLASS, FLOOR_STAY_LONG_CLASS, FLOOR_TILE_BOTTOM_CLASS, FLOOR_TILE_CLASS, FLOOR_TILE_DETAIL_CLASS,
  FLOOR_TILE_DOT_CLASS, FLOOR_TILE_NAME_CLASS, FLOOR_TILE_SEATS_CLASS, FLOOR_TILE_STATUS_CLASS, FLOOR_TILE_TOP_CLASS,
  FLOOR_TILE_WORD_CLASS,
} from "./floor-tile-classes";
import { FLOOR_GRID_CLASS, FLOOR_TAP_HINT, type FloorTileModel } from "./floor-tiles";
import { FLOOR_TILE_TONES, floorTileView, type FloorDetail, type FloorTone } from "./floor-view";
import { build, printed, reservation, tab, table } from "./floor-tiles.fixtures";
import type { Order, Reservation, Table } from "@/types";
import { FloorAreaSections } from "@/components/tables/FloorAreaSections";
import { FloorTile } from "@/components/tables/FloorTile";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  for (const n of needles) assert.ok(tokens(cls).includes(n), `${what}: "${n}" (has "${cls}")`);
}
// `nowMs` null: before the client clock exists (no stay yet); left out, the fixtures' fixed clock.
function one(t: Table, tabs: Order[] | undefined, reservations?: Reservation[], nowMs?: number | null): FloorTileModel {
  const tiles = build([t], tabs, reservations, nowMs);
  assert.equal(tiles.length, 1, "one tile");
  return tiles[0];
}

// One tile per row of design 6.5's table (inventory 2.9's kinds), at the fixtures' fixed clock (stay = minutes ago).
const BOOKING = [reservation("T-1", "21:45", { name: "Rahul Mehta" })];
const KINDS = {
  K1: one(table("T-3", "Occupied"), [tab("T-3", 27, { total: 955 })]),
  K1P: one(table("T-3", "Occupied"), [printed(tab("T-3", 27, { total: 955 }))]),
  K1L: one(table("T-3", "Occupied"), [tab("T-3", 68, { total: 1063 })]),
  K1H: one(table("T-3", "Occupied"), [tab("T-3", 72, { total: 1063 })]),
  // No stay known (logic-4): before the clock exists (one seat, F10's singular), or a bill whose date does not parse.
  K1N: one(table("T-3", "Occupied", { capacity: 1 }), [tab("T-3", 27, { total: 955 })], undefined, null),
  K1B: one(table("T-3", "Occupied"), [tab("T-3", 27, { total: 955, createdAt: "not a date" })]),
  K2: one(table("T-2", "Occupied"), []),
  K3: one(table("T-2", "Occupied"), undefined),
  K4: one(table("T-2", "Occupied"), undefined),
  K5: one(table("T-5", "Available"), []),
  K5C: one(table("T-5", "Available", { chargeLabel: "AC charge", chargeAmount: 50 }), []),
  K6: one(table("T-5", "Available"), undefined),
  K7: one(table("T-6", "Available"), [tab("T-6", 12, { total: 420 })]),
  K7L: one(table("T-6", "Available"), [tab("T-6", 90, { total: 420 })]),
  K8: one(table("T-1", "Reserved", { capacity: 2 }), [], BOOKING),
  K8H: one(table("T-1", "Reserved", { capacity: 2 }), []),
  K9: one(table("T-1", "Reserved", { capacity: 2 }), undefined, BOOKING),
  K10: one(table("T-1", "Reserved", { capacity: 2 }), [tab("T-1", 72)]),
};
// The stay in its two forms: the words from 720px and the phone's whole minutes (the owner's answer 2026-10-28).
const money = (amount: string, stay: string, phoneStay: string): FloorDetail => ({ kind: "money", amount, stay, phoneStay });
const text = (words: string, phoneText?: string): FloorDetail => (phoneText ? { kind: "text", text: words, phoneText } : { kind: "text", text: words });
type Row = [keyof typeof KINDS, boolean, FloorTone, string, FloorDetail, boolean, string];
// [kind, tabsFailed, tone, label, detail, longStay, accessible name: the seats after the name, ruling F10]
const ROWS: Row[] = [
  ["K1", false, "occupied", "Occupied", money("₹955", "27 min", "27m"), false, "T-3, 4 seats, Occupied, ₹955, 27 min — open the bill"],
  ["K1P", false, "billed", "Bill printed", money("₹955", "27 min", "27m"), false, "T-3, 4 seats, Bill printed, ₹955, 27 min — open the bill"],
  ["K1L", false, "occupied", "Occupied", money("₹1,063", "1h 8m", "68m"), true, "T-3, 4 seats, Occupied, ₹1,063, 1h 8m, long stay — open the bill"],
  ["K1H", false, "occupied", "Occupied", money("₹1,063", "1h 12m", "72m"), true, "T-3, 4 seats, Occupied, ₹1,063, 1h 12m, long stay — open the bill"],
  ["K1N", false, "occupied", "Occupied", money("₹955", "—", "—"), false, "T-3, 1 seat, Occupied, ₹955 — open the bill"],
  ["K1B", false, "occupied", "Occupied", money("₹955", "—", "—"), false, "T-3, 4 seats, Occupied, ₹955 — open the bill"],
  ["K2", false, "occupied", "Occupied", text("No open bill"), false, "T-2, 4 seats, Occupied, No open bill — free the table"],
  ["K3", false, "occupied", "Occupied", { kind: "skeleton" }, false, "T-2, 4 seats, Occupied — open the bill"],
  ["K4", true, "occupied", "Occupied", text("Bill not loaded"), false, "T-2, 4 seats, Occupied, Bill not loaded — open the bill"],
  ["K5", false, "free", "Available", text("Tap to seat guests", "Tap to seat"), false, "T-5, 4 seats, Available, Tap to seat guests — start a new order"],
  ["K5C", false, "free", "Available", text("AC charge ₹50"), false, "T-5, 4 seats, Available, AC charge ₹50 — start a new order"],
  ["K6", false, "free", "Available", text("Tap to seat guests", "Tap to seat"), false, "T-5, 4 seats, Available, Tap to seat guests — start a new order"],
  ["K6", true, "free", "Available", text("Tap to seat guests", "Tap to seat"), false, "T-5, 4 seats, Available, Tap to seat guests — start a new order"],
  ["K7", false, "free", "Available", money("₹420", "12 min", "12m"), false, "T-6, 4 seats, Available, ₹420, 12 min — open the bill"],
  ["K7L", false, "free", "Available", money("₹420", "1h 30m", "90m"), true, "T-6, 4 seats, Available, ₹420, 1h 30m, long stay — open the bill"],
  ["K8", false, "reserved", "Reserved", text("9:45 PM · Rahul Mehta"), false, "T-1, 2 seats, Reserved, 9:45 PM · Rahul Mehta — seat guests"],
  ["K8H", false, "reserved", "Reserved", text("Held"), false, "T-1, 2 seats, Reserved, Held — seat guests"],
  ["K9", false, "reserved", "Reserved", text("9:45 PM · Rahul Mehta"), false, "T-1, 2 seats, Reserved, 9:45 PM · Rahul Mehta"],
  ["K10", false, "reserved", "Reserved", text("Held"), true, "T-1, 2 seats, Reserved, Held, long stay"],
];

test("floorTileView: one row per kind of design 6.5's table (tone, word, detail, long stay, accessible name)", () => {
  for (const [kind, tabsFailed, tone, label, detail, longStay, name] of ROWS) {
    const view = floorTileView(KINDS[kind], tabsFailed);
    const what = `${kind}${tabsFailed ? " (bills failed)" : ""}`;
    assert.equal(view.tone, tone, `${what}: tone`);
    assert.equal(view.label, label, `${what}: the status word`);
    assert.deepEqual(view.detail, detail, `${what}: the detail line`);
    assert.equal(view.longStay, longStay, `${what}: long stay`);
    assert.equal(view.accessibleName, name, `${what}: the accessible name`);
  }
});

test("floorTileView: the seats on the top row, '1 seat' for one (design 6.5, inventory 11.1)", () => {
  assert.equal(floorTileView(KINDS.K5, false).seats, "4 seats", "four seats");
  assert.equal(floorTileView(KINDS.K8, false).seats, "2 seats", "two seats");
  assert.equal(floorTileView(one(table("T-9", "Available", { capacity: 1 }), []), false).seats, "1 seat", "one seat, singular");
});

test("FLOOR_TILE_TONES: the HTML's four looks (values 4.2) from tokens; the dots are the pills' (ruling F2)", () => {
  assert.deepEqual(
    FLOOR_TILE_TONES,
    {
      free: { tile: "border-border bg-card", dot: FLOOR_FILTER_DOT.free, label: "text-status-ok-ink" },
      occupied: { tile: "border-status-info-border bg-status-info-tint", dot: FLOOR_FILTER_DOT.occupied, label: "text-status-info-ink" },
      billed: { tile: "border-status-bill-border bg-status-bill-tint", dot: FLOOR_FILTER_DOT.billed, label: "text-status-bill-ink" },
      reserved: { tile: "border-status-reserved-border bg-status-reserved-tint", dot: FLOOR_FILTER_DOT.reserved, label: "text-status-reserved-ink" },
    },
    "values 4.2: free plain white, the others tinted; dot and word in the state's colours",
  );
});

test("the tile's classes: the HTML's anatomy (values 4.1, 4.4); Review Focus 3: the name truncates, seats and word never wrap", () => {
  // h-full (logic-6): the surface fills its grid cell, so a tile that grows grows its row-mates (values 4.7).
  hasAll(FLOOR_TILE_CLASS, ["flex", "flex-col", "justify-between", "gap-2", "border-[1.5px]", "rounded-[14px]", "p-3", "min-h-[112px]", "max-tab:min-h-[100px]", "w-full", "h-full", "text-left", "text-foreground", "leading-[normal]"], "values 4.1 tile");
  // Ruling F9: the HTML's top row has no gap (values 4.1, computed `normal`), so "T-16" + "6 seats" fits the 88px phone row.
  assert.equal(FLOOR_TILE_TOP_CLASS, "flex items-start justify-between", "the top row: name left, seats right, no gap (values 4.1)");
  assert.equal(FLOOR_TILE_NAME_CLASS, "min-w-0 truncate text-[20px] font-semibold tracking-[-0.01em]", "the name: 20px 600 -0.01em, truncating");
  assert.equal(FLOOR_TILE_SEATS_CLASS, "flex-none whitespace-nowrap text-[12px] text-muted-foreground", "the seats: 12px --text-2, never shrinking or wrapping");
  assert.equal(FLOOR_TILE_BOTTOM_CLASS, "flex flex-col gap-0.5", "the bottom block: 2px between its lines");
  assert.equal(FLOOR_TILE_STATUS_CLASS, "flex items-center gap-1.5 text-[12.5px] font-medium", "the status line: dot, 6px, word");
  assert.equal(FLOOR_TILE_WORD_CLASS, "whitespace-nowrap", "the status word never wraps (P13)");
  for (const [what, cls] of [["status line", FLOOR_TILE_STATUS_CLASS], ["word", FLOOR_TILE_WORD_CLASS], ["seats", FLOOR_TILE_SEATS_CLASS]]) {
    assert.ok(!tokens(cls).includes("truncate"), `the ${what} is never cut (P13, Review Focus 3)`);
  }
  assert.equal(FLOOR_TILE_DOT_CLASS, "size-[7px] flex-none rounded-[50%]", "the 7px dot, the HTML's 50% radius (as the pills' dot)");
  assert.equal(FLOOR_TILE_DETAIL_CLASS, "truncate text-[12.5px] text-muted-foreground", "the detail: one line, an ellipsis");
  assert.equal(FLOOR_DETAIL_WIDE_CLASS, "max-tab:hidden", "the long word from 720px");
  assert.equal(FLOOR_DETAIL_PHONE_CLASS, "tab:hidden", "the phone word below 720px (design 8 #1)");
  assert.equal(FLOOR_STAY_LONG_CLASS, "font-semibold text-status-bad-ink", "a long stay: the time red and bold (ruling F3)");
  const all = [FLOOR_TILE_CLASS, FLOOR_TILE_TOP_CLASS, FLOOR_TILE_NAME_CLASS, FLOOR_TILE_SEATS_CLASS, FLOOR_TILE_STATUS_CLASS, FLOOR_TILE_DETAIL_CLASS, FLOOR_SECTION_CLASS, FLOOR_SECTION_HEAD_CLASS, FLOOR_SECTION_NAME_CLASS, FLOOR_SECTION_COUNT_CLASS, ...Object.values(FLOOR_TILE_TONES).flatMap((t) => [t.tile, t.dot, t.label])].join(" ");
  for (const banned of ["brand-", "bg-linear", "color-mix", "oklab", "border-t"]) assert.ok(!all.includes(banned), `no ${banned} (tokens only, WebView 109, no divider)`);
});

test("the section's classes: the HTML's head over the grid, 10px apart, no divider (values 3.1, design 6.4)", () => {
  assert.equal(FLOOR_SECTION_CLASS, "flex flex-col gap-2.5", "values 3.1: a column, 10px to the grid");
  assert.equal(FLOOR_SECTION_HEAD_CLASS, "flex items-baseline gap-2", "values 3.1: one baseline, 8px apart");
  assert.equal(FLOOR_SECTION_NAME_CLASS, "min-w-0 truncate text-[15px] font-semibold", "the name: 15px 600, truncating");
  assert.equal(FLOOR_SECTION_COUNT_CLASS, "flex-none text-[12px] text-muted-foreground", "the count: 12px --text-2, never squeezed");
});

// ── FloorTile, rendered per kind ──────────────────────────────────────────────────────────────────────────────────────

const renderTile = (tile: FloorTileModel, tabsFailed = false, busy = false) =>
  renderToStaticMarkup(createElement(FloorTile, { tile, busy, tabsFailed, onTap: () => {}, onMenu: () => {} }));
const ACTION_WORDS = /\bOpen\b|New order|Seat now|Free table/;

test("FloorTile: every kind draws its word, its detail and its tone; no action word on any tile (design 6.5, 11)", () => {
  for (const [kind, tabsFailed, tone, label, detail] of ROWS) {
    const html = renderTile(KINDS[kind], tabsFailed);
    const what = `${kind}${tabsFailed ? " (bills failed)" : ""}`;
    const look = FLOOR_TILE_TONES[tone];
    expectAll(tagOf(html, "floor-tile"), [...tokens(FLOOR_TILE_CLASS), ...tokens(look.tile)], `${what}: the surface in its tone`);
    assert.match(tagOf(html, "floor-tile"), new RegExp(`data-tone="${tone}"`), `${what}: data-tone`);
    expectAll(tagOf(html, "floor-tile-status"), [...tokens(FLOOR_TILE_STATUS_CLASS), look.label], `${what}: the status line in the state's ink`);
    expectAll(tagOf(html, "floor-tile-dot"), [...tokens(FLOOR_TILE_DOT_CLASS), look.dot], `${what}: the dot`);
    assert.match(tagOf(html, "floor-tile-dot"), /aria-hidden="true"/, `${what}: the dot is decoration`);
    assert.equal(textOf(html, "floor-tile-word"), label, `${what}: the status word`);
    expectAll(tagOf(html, "floor-tile-word"), [FLOOR_TILE_WORD_CLASS], `${what}: the word never wraps`);
    assert.equal(textOf(html, "floor-tile-name"), KINDS[kind].table.tableNo, `${what}: the full name`);
    assert.match(tagOf(html, "floor-tile-name"), new RegExp(`title="${KINDS[kind].table.tableNo}"`), `${what}: the name's title`);
    expectAll(tagOf(html, "floor-tile-seats"), tokens(FLOOR_TILE_SEATS_CLASS), `${what}: the seats`);
    // Both forms are in the markup (one shows per width): the stay's words then its phone minutes, the K5 pair's words.
    const words = detail.kind === "money" ? `${detail.amount} · ${detail.stay}${detail.phoneStay}` : detail.kind === "text" ? `${detail.text}${detail.phoneText ?? ""}` : "";
    assert.equal(textOf(html, "floor-tile-detail"), words, `${what}: the detail line`);
    assert.ok(!ACTION_WORDS.test(textOf(html, "floor-tile")), `${what}: no action word (got "${textOf(html, "floor-tile")}")`);
    assert.ok(!html.includes("lucide-chevron-right"), `${what}: no action chevron`);
  }
});

test("FloorTile: the phone word below 720px, the long word from 720px (K5 with no charge; design 8 #1)", () => {
  const html = renderTile(KINDS.K5);
  expectAll(tagOf(html, "floor-tile-detail-wide"), [FLOOR_DETAIL_WIDE_CLASS], "the long word");
  assert.equal(textOf(html, "floor-tile-detail-wide"), "Tap to seat guests", "the long word's text");
  expectAll(tagOf(html, "floor-tile-detail-phone"), [FLOOR_DETAIL_PHONE_CLASS], "the phone word");
  assert.equal(textOf(html, "floor-tile-detail-phone"), "Tap to seat", "the phone word's text");
  assert.equal(tagsOf(renderTile(KINDS.K5C), "floor-tile-detail-phone").length, 0, "a charge line has one form only");
});

// The owner's answer 2026-10-28 (design 6.5): the stay as the K5 pair, its words from 720px and the phone's whole minutes
// below; exactly one shows at a width, a long stay's red bold (ruling F3) is on both, and the one detail line still cuts.
test("FloorTile: the stay's two forms, '1h 12m' from 720px and '72m' below; a long stay red and bold on both (K1, K7)", () => {
  for (const [kind, amount, wide, phone] of [["K1H", "₹1,063", "1h 12m", "72m"], ["K7L", "₹420", "1h 30m", "90m"], ["K1L", "₹1,063", "1h 8m", "68m"]] as const) {
    const html = renderTile(KINDS[kind]);
    const [w, ph] = [tagOf(html, "floor-tile-stay-wide"), tagOf(html, "floor-tile-stay-phone")];
    expectAll(w, [FLOOR_DETAIL_WIDE_CLASS, ...tokens(FLOOR_STAY_LONG_CLASS)], `${kind}: the words from 720px, red and bold`);
    expectAll(ph, [FLOOR_DETAIL_PHONE_CLASS, ...tokens(FLOOR_STAY_LONG_CLASS)], `${kind}: the minutes below 720px, red and bold`);
    assert.ok(!classesOf(w).includes(FLOOR_DETAIL_PHONE_CLASS) && !classesOf(ph).includes(FLOOR_DETAIL_WIDE_CLASS), `${kind}: never both shown`);
    assert.equal(textOf(html, "floor-tile-stay-wide"), wide, `${kind}: the words`);
    assert.equal(textOf(html, "floor-tile-stay-phone"), phone, `${kind}: the phone's minutes`);
    assert.equal(textOf(html, "floor-tile-detail"), `${amount} · ${wide}${phone}`, `${kind}: both inside the one truncating line`);
    for (const t of [w, ph]) assert.ok(!classesOf(t).includes("truncate"), `${kind}: the line cuts, not a form`);
    assert.match(tagOf(html, "floor-tile"), new RegExp(`aria-label="[^"]*, ${wide}, long stay — `), `${kind}: the accessible name keeps the words`);
    assert.ok(!tagOf(html, "floor-tile").includes(phone), `${kind}: never the phone's minutes in the accessible name`);
  }
  expectAll(tagOf(renderTile(KINDS.K7L), "floor-tile"), tokens(FLOOR_TILE_TONES.free.tile), "K7 long stay: the red time on the free tone");
  const k1 = renderTile(KINDS.K1);
  for (const form of ["floor-tile-stay-wide", "floor-tile-stay-phone"]) assert.ok(!classesOf(tagOf(k1, form)).includes("text-status-bad-ink"), `K1 at 27 min: ${form} plain`);
  assert.deepEqual([textOf(k1, "floor-tile-stay-wide"), textOf(k1, "floor-tile-stay-phone")], ["27 min", "27m"], "K1 at 27 min: both forms");
  expectAll(tagOf(renderTile(KINDS.K3), "floor-tile-detail"), ["h-[17px]", "w-16", "animate-pulse"], "K3: a short skeleton bar the line's height");
});

test("FloorTile: the surface keeps today's element per tap (Link, button, div) and names what the tap does (Review Focus 4)", () => {
  const surface = (tile: FloorTileModel, busy = false) => tagOf(renderTile(tile, false, busy), "floor-tile");
  for (const kind of ["K1", "K1P", "K5", "K7"] as const) {
    assert.match(surface(KINDS[kind]), /^<a /, `${kind}: a link to /pos`);
    assert.match(surface(KINDS[kind]), /href="\/pos"/, `${kind}: the plain /pos path`);
  }
  for (const kind of ["K2", "K8"] as const) assert.match(surface(KINDS[kind]), /^<button /, `${kind}: a button that opens the confirm`);
  for (const kind of ["K9", "K10"] as const) assert.match(surface(KINDS[kind]), /^<div /, `${kind}: display only`);
  for (const kind of ["K1", "K2", "K5", "K8"] as const) expectAll(surface(KINDS[kind]), ["cursor-pointer"], `${kind}: the HTML's hand cursor on a tap target`);
  for (const kind of ["K9", "K10"] as const) assert.ok(!classesOf(surface(KINDS[kind])).includes("cursor-pointer"), `${kind}: no hand on a display tile`);
  assert.match(surface(KINDS.K5, true), /^<div [^>]*aria-busy="true"/, "a busy tile is no target");
  assert.match(surface(KINDS.K1), /aria-label="T-3, 4 seats, Occupied, ₹955, 27 min — open the bill"/, "the link says what a tap does");
  assert.match(surface(KINDS.K2), /aria-label="T-2, 4 seats, Occupied, No open bill — free the table"/, "the button says what a tap does");
  const k5 = renderTile(KINDS.K5);
  assert.ok(k5.indexOf("</a>") < k5.indexOf('aria-label="More actions for T-5"'), "the ⋯ is a sibling after the link, never inside it");
});

test("FloorTile: a busy tile shows the spinner and names no tap (logic-7)", () => {
  for (const kind of ["K1", "K2", "K5", "K8"] as const) {
    const html = renderTile(KINDS[kind], false, true);
    const statusLine = html.slice(html.indexOf('data-ui="floor-tile-status"'), html.indexOf('data-ui="floor-tile-detail"'));
    assert.match(statusLine, /<svg [^>]*animate-spin/, `${kind} busy: the spinner on the status line`);
    assert.ok(!/aria-label=/.test(tagOf(html, "floor-tile")), `${kind} busy: no aria-label on the surface`);
    for (const hint of Object.values(FLOOR_TAP_HINT)) if (hint) assert.ok(!html.includes(` — ${hint}`), `${kind} busy: no tap hint "${hint}"`);
    assert.ok(!renderTile(KINDS[kind]).includes("animate-spin"), `${kind} at rest: no spinner`);
  }
});

// Ruling F12 part 1 (spec-3, logic-3, keep-3): K10's long stay is said on the plain-div surface (no aria-label there);
// a Link or button tile says it in its aria-label, so the sr-only word renders on div surfaces only, never twice.
test("FloorTile: a long stay on a div surface (K10, a busy tile) is said by an sr-only 'Long stay'; never on a named surface", () => {
  for (const [what, html] of [["K10", renderTile(KINDS.K10)], ["K1L busy", renderTile(KINDS.K1L, false, true)]] as const) {
    assert.match(tagOf(html, "floor-tile"), /^<div /, `${what}: a div surface`);
    expectAll(tagOf(html, "floor-tile-long-stay"), ["sr-only"], `${what}: the sr-only word`);
    assert.equal(textOf(html, "floor-tile-long-stay"), "Long stay", `${what}: the word`);
    assert.ok(textOf(html, "floor-tile").includes("Long stay"), `${what}: inside the surface's content`);
  }
  for (const kind of ["K1L", "K1H", "K7L"] as const) {
    const html = renderTile(KINDS[kind]);
    assert.equal(tagsOf(html, "floor-tile-long-stay").length, 0, `${kind}: no sr-only word on a link (its aria-label says it)`);
    assert.match(tagOf(html, "floor-tile"), /aria-label="[^"]*, long stay — /, `${kind}: the aria-label says long stay`);
  }
  for (const kind of ["K9", "K8H"] as const) assert.equal(tagsOf(renderTile(KINDS[kind]), "floor-tile-long-stay").length, 0, `${kind}: no long stay, no word`);
});

// Re-review 2 N2: a div surface reads its own text, so below 720px a reader would say "72m" ("72 metres"); there the
// phone's minutes are hidden from readers and an sr-only copy of the words is read, below 720px only (never twice).
test("FloorTile: a busy money tile says '1h 12m' below 720px, never '72m'; a link has no spoken copy (its aria-label wins)", () => {
  const busy = renderTile(KINDS.K1H, false, true);
  assert.match(tagOf(busy, "floor-tile"), /^<div /, "busy K1H: a div surface");
  assert.match(tagOf(busy, "floor-tile-stay-phone"), /aria-hidden="true"/, "busy K1H: the phone's minutes hidden from readers");
  assert.ok(!tagOf(busy, "floor-tile-stay-wide").includes("aria-hidden"), "busy K1H: the words from 720px read as shown");
  expectAll(tagOf(busy, "floor-tile-spoken-stay"), ["sr-only", FLOOR_DETAIL_PHONE_CLASS], "busy K1H: the sr-only words, below 720px only");
  assert.equal(textOf(busy, "floor-tile-spoken-stay"), "1h 12m", "busy K1H: the long words");
  const link = renderTile(KINDS.K1H);
  assert.match(tagOf(link, "floor-tile"), /^<a /, "K1H: a link surface");
  assert.equal(tagsOf(link, "floor-tile-spoken-stay").length, 0, "K1H link: no spoken copy (its aria-label wins)");
});

// ── FloorAreaSections, rendered ─────────────────────────────────────────────────────────────────────────────────────

test("FloorAreaSections: per area the HTML's head (name, '{n} tables' / '1 table') over the shared grid, no divider", () => {
  const groups = [
    { key: "a1", name: "AC Hall", summary: "4 tables", tiles: [KINDS.K8, KINDS.K5] },
    { key: "a2", name: "Garden", summary: "1 table", tiles: [KINDS.K7] },
  ];
  const html = renderToStaticMarkup(createElement(FloorAreaSections, { groups, renderTile: (t: FloorTileModel) => createElement("i", { key: t.table._id }) }));
  assert.equal(tagsOf(html, "floor-section").length, 2, "one section per area");
  groups.forEach((g, i) => {
    expectAll(tagOf(html, "floor-section", i), tokens(FLOOR_SECTION_CLASS), `${g.name}: the section`);
    assert.match(tagOf(html, "floor-section", i), new RegExp(`aria-labelledby="floor-area-${g.key}"`), `${g.name}: labelled by its heading`);
    expectAll(tagOf(html, "floor-section-head", i), tokens(FLOOR_SECTION_HEAD_CLASS), `${g.name}: the head`);
    const name = tagOf(html, "floor-section-name", i);
    assert.match(name, /^<h2 /, `${g.name}: the heading`);
    assert.match(name, new RegExp(`id="floor-area-${g.key}"[^>]*title="${g.name}"|title="${g.name}"[^>]*id="floor-area-${g.key}"`), `${g.name}: id and title`);
    expectAll(name, tokens(FLOOR_SECTION_NAME_CLASS), `${g.name}: the name's look`);
    assert.equal(textOf(html, "floor-section-count", i), g.summary, `${g.name}: the HTML's count words`);
    expectAll(tagOf(html, "floor-section-count", i), tokens(FLOOR_SECTION_COUNT_CLASS), `${g.name}: the count's look`);
    expectAll(tagOf(html, "floor-grid", i), tokens(FLOOR_GRID_CLASS), `${g.name}: the shared grid`);
  });
  assert.ok(!/border-t|divide-/.test(html), "no divider between sections (design 6.4)");
});
