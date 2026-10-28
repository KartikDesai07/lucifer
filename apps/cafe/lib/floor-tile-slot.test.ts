// U3 Task 4 (2026-10-28): the Floor tile's right slot, motion and focus (design 6.5 in
// docs/superpowers/specs/2026-10-28-floor-match-html-design.md; values 4.1, 6.1-6.3, 7 in
// docs/superpowers/specs/2026-10-28-floor-html-values.md; ruling F12; the Task 3 re-review's N1). The class strings, then
// renders of FloorTile (the ⋯ trigger after the surface, the long-stay clock, a busy tile, the wrapper's rise and lift;
// Review Focus 4: the surface stays the only Link / button), then source pins on the page's first-paint rise, the surface
// decided once, and the Long stay words kept true in Settings and the runbook (design 11).
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
  FLOOR_DETAIL_WIDE_CLASS, FLOOR_LONG_STAY_CLOCK_CLASS, FLOOR_STATUS_ROOM_CLASS, FLOOR_STATUS_ROOM_WIDE_CLASS, FLOOR_STAY_LONG_CLASS,
  FLOOR_TILE_CLASS, FLOOR_TILE_GLYPH_CLASS, FLOOR_TILE_LIFT_CLASS, FLOOR_TILE_PRESS_CLASS, FLOOR_TILE_RISE_CLASS, FLOOR_TILE_SLOT_CLASS,
  FLOOR_TILE_SPINNER_CLASS, FLOOR_TILE_TRIGGER_CLASS, FLOOR_TILE_TRIGGER_SPINNER_CLASS, FLOOR_TILE_WRAP_CLASS,
} from "./floor-tile-classes";
import type { FloorTileModel } from "./floor-tiles";
import { build, printed, reservation, tab, table } from "./floor-tiles.fixtures";
import type { Order, Reservation, Table } from "@/types";
import { FloorTile } from "@/components/tables/FloorTile";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(read(rel));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const one = (t: Table, tabs: Order[] | undefined, reservations?: Reservation[]): FloorTileModel => build([t], tabs, reservations)[0];
// Today's kinds (inventory 2.9) at the fixtures' clock and 60-minute long stay.
const K = {
  K1: one(table("T-3", "Occupied"), [tab("T-3", 27, { total: 955 })]),
  K1H: one(table("T-3", "Occupied"), [tab("T-3", 72, { total: 1063 })]),
  K1PH: one(table("T-3", "Occupied"), [printed(tab("T-3", 72, { total: 1063 }))]),
  K2: one(table("T-2", "Occupied"), []),
  K5: one(table("T-5", "Available"), []),
  K7L: one(table("T-6", "Available"), [tab("T-6", 90, { total: 420 })]),
  K8: one(table("T-1", "Reserved", { capacity: 2 }), [], [reservation("T-1", "21:45", { name: "Rahul Mehta" })]),
  K9: one(table("T-1", "Reserved", { capacity: 2 }), undefined),
  K10: one(table("T-1", "Reserved", { capacity: 2 }), [tab("T-1", 72)]),
};
const render = (tile: FloorTileModel, busy = false, riseIndex: number | null = null): string =>
  renderToStaticMarkup(createElement(FloorTile, { tile, busy, tabsFailed: false, riseIndex, onTap: () => {}, onMenu: () => {} }));
/** The markup between the status line's tag and the detail line's: the status line and its slot. */
const statusLine = (html: string): string => html.slice(html.indexOf('data-ui="floor-tile-status"'), html.indexOf('data-ui="floor-tile-detail"'));
/** The markup from the ⋯ trigger's tag to the end (the trigger and its glyph). */
const trigger = (html: string): string => html.slice(html.indexOf('data-ui="floor-tile-more"'));

// ── The classes (design 6.5; values 6.1-6.3, 7) ───────────────────────────────────────────────────────────────────────

test("the wrapper's classes: the tile's radius, the HTML's rise, its hover lift and press (values 6.1, 6.2, 7)", () => {
  assert.equal(FLOOR_TILE_WRAP_CLASS, "relative rounded-[14px]", "the grid item holds both; its radius carries the lift's shadow round the corners");
  assert.equal(FLOOR_TILE_RISE_CLASS, "motion-safe:animate-html-rise-floor", "the rise, never with reduced motion (values 12 #23)");
  assert.equal(
    FLOOR_TILE_LIFT_CLASS,
    "transition-[translate,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1),ease] hover:-translate-y-[3px] hover:[box-shadow:0_12px_28px_rgba(0,0,0,0.1)] has-[[data-ui=floor-tile]:active]:translate-y-0",
    "values 6.1: 3px up and 0 12px 28px rgba(0,0,0,.1), the move .3s cubic-bezier(.2,.8,.2,1), the shadow .3s ease; the press puts it back (6.2)",
  );
  assert.equal(FLOOR_TILE_PRESS_CLASS, "cursor-pointer transition-[scale] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] active:scale-[.98]", "values 6.2: scale(.98)");
  hasFocusRing(FLOOR_TILE_CLASS, "the surface keeps today's 2px accent ring, 1px out (design 6.5)");
  assert.ok(tokens(FLOOR_TILE_CLASS).includes("focus-visible:ring-offset-1"), "the ring 1px out");
});

function hasFocusRing(cls: string, what: string): void {
  for (const t of ["focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-primary"]) assert.ok(tokens(cls).includes(t), `${what}: ${t}`);
}

test("the right slot's classes: the room, the slot, the clock, the spinners, the ⋯ trigger (design 6.5, the 44px rule)", () => {
  assert.equal(FLOOR_STATUS_ROOM_CLASS, "relative pr-[22px]", "the glyph's 16px and 6px, so Reserved + ⋯ fit 88px");
  assert.equal(FLOOR_STATUS_ROOM_WIDE_CLASS, "relative tab:pr-[22px]", "the same room from 720px only");
  assert.equal(FLOOR_TILE_SLOT_CLASS, "absolute inset-y-0 right-0 flex items-center", "the line's right end, centred on it");
  assert.equal(FLOOR_LONG_STAY_CLOCK_CLASS, "size-3.5 text-status-bad-ink", "a 14px clock in --bad-i");
  assert.equal(FLOOR_TILE_SPINNER_CLASS, "size-3.5 animate-spin", "today's 14px spinner");
  assert.equal(
    FLOOR_TILE_TRIGGER_CLASS,
    "absolute bottom-[30px] right-0 flex cursor-pointer items-end justify-end rounded-[8px] pb-[2.5px] pr-[13px] text-muted-foreground pointer-coarse:size-11 pointer-fine:size-8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default",
    "the tile's right edge, its foot on the detail line's top, 44 / 32px, the glyph on the status line's centre and the tile's inner edge",
  );
  assert.ok(!/\bh-10\b|\bw-10\b/.test(FLOOR_TILE_TRIGGER_CLASS), "no longer today's 40px corner target");
  assert.equal(FLOOR_TILE_GLYPH_CLASS, "size-4", "the 16px ⋯");
  assert.equal(FLOOR_TILE_TRIGGER_SPINNER_CLASS, "mb-px size-3.5 animate-spin", "the 14px spinner centred where the glyph was");
  const all = [FLOOR_TILE_WRAP_CLASS, FLOOR_TILE_LIFT_CLASS, FLOOR_TILE_PRESS_CLASS, FLOOR_STATUS_ROOM_CLASS, FLOOR_TILE_SLOT_CLASS, FLOOR_LONG_STAY_CLOCK_CLASS, FLOOR_TILE_TRIGGER_CLASS].join(" ");
  for (const banned of ["brand-", "color-mix", "oklab", "light-dark"]) assert.ok(!all.includes(banned), `no ${banned} (tokens only, WebView 109)`);
});

// ── Renders: the ⋯ trigger, the clock, busy (design 6.5; ruling F12) ─────────────────────────────────────────────────

test("FloorTile: K5 / K8 draw the ⋯ trigger after the surface, the 16px Ellipsis, 44 / 32px, its foot 30px up; the line keeps its room", () => {
  for (const [kind, close] of [["K5", "</a>"], ["K8", "</button>"]] as const) {
    const html = render(K[kind]);
    const more = tagOf(html, "floor-tile-more");
    assert.match(more, /^<button /, `${kind}: the trigger is a button`);
    assert.match(more, new RegExp(`aria-label="More actions for ${K[kind].table.tableNo}"`), `${kind}: today's name`);
    expectAll(more, tokens(FLOOR_TILE_TRIGGER_CLASS), `${kind}: the trigger's place and sizes`);
    for (const c of ["pointer-coarse:size-11", "pointer-fine:size-8", "bottom-[30px]", "right-0"]) assert.ok(classesOf(more).includes(c), `${kind}: ${c}`);
    assert.ok(!/disabled=""/.test(more), `${kind} at rest: the trigger is enabled`);
    assert.match(trigger(html), /<svg [^>]*class="lucide lucide-ellipsis size-4"[^>]*aria-hidden="true"/, `${kind}: the 16px Ellipsis, decoration`);
    assert.ok(!html.includes("lucide-ellipsis-vertical") && !html.includes("animate-spin"), `${kind}: no vertical ⋯, no spinner`);
    assert.ok(html.indexOf(close) < html.indexOf('data-ui="floor-tile-more"'), `${kind}: the trigger comes after the surface closes (P11)`);
    expectAll(tagOf(html, "floor-tile-status"), tokens(FLOOR_STATUS_ROOM_CLASS), `${kind}: the status line keeps the slot's room`);
    assert.equal(tagsOf(html, "floor-tile-clock").length + tagsOf(html, "floor-tile-slot").length, 0, `${kind}: nothing in the surface's slot`);
  }
});

test("FloorTile: a long stay on a money line draws the 14px clock from 720px, 'Long stay' its title, the stay red; no sr-only word on a link", () => {
  for (const kind of ["K1H", "K1PH", "K7L"] as const) {
    const html = render(K[kind]);
    const clock = tagOf(html, "floor-tile-clock");
    assert.match(clock, /title="Long stay"/, `${kind}: the clock's title`);
    expectAll(clock, [...tokens(FLOOR_TILE_SLOT_CLASS), FLOOR_DETAIL_WIDE_CLASS], `${kind}: in the slot, hidden below 720px`);
    assert.match(statusLine(html), /<svg [^>]*class="lucide lucide-clock size-3\.5 text-status-bad-ink"[^>]*aria-hidden="true"/, `${kind}: the 14px --bad-i clock on the status line`);
    expectAll(tagOf(html, "floor-tile-status"), tokens(FLOOR_STATUS_ROOM_WIDE_CLASS), `${kind}: the room from 720px only`);
    assert.ok(!classesOf(tagOf(html, "floor-tile-status")).includes("pr-[22px]"), `${kind}: no room below 720px ("Bill printed" keeps the 88px line)`);
    for (const form of ["floor-tile-stay-wide", "floor-tile-stay-phone"]) expectAll(tagOf(html, form), tokens(FLOOR_STAY_LONG_CLASS), `${kind}: ${form} red and bold`);
    assert.equal(tagsOf(html, "floor-tile-long-stay").length, 0, `${kind}: the link's aria-label says long stay, no sr-only word`);
    assert.match(tagOf(html, "floor-tile"), /^<a [^>]*aria-label="[^"]*, long stay — /, `${kind}: said in the link's name`);
  }
  for (const kind of ["K1", "K5", "K8", "K9"] as const) assert.equal(tagsOf(render(K[kind]), "floor-tile-clock").length, 0, `${kind}: no long stay, no clock`);
});

test("FloorTile: K10's clock shows at every width and says 'Long stay' once (ruling F12)", () => {
  const html = render(K.K10);
  assert.match(tagOf(html, "floor-tile"), /^<div /, "K10: a display-only div");
  const clock = tagOf(html, "floor-tile-clock");
  assert.match(clock, /title="Long stay"/, "K10: the clock's title");
  expectAll(clock, tokens(FLOOR_TILE_SLOT_CLASS), "K10: in the slot");
  assert.ok(!classesOf(clock).includes(FLOOR_DETAIL_WIDE_CLASS), "K10: never hidden (its detail has no time to turn red)");
  expectAll(tagOf(html, "floor-tile-status"), tokens(FLOOR_STATUS_ROOM_CLASS), "K10: the room at every width (Reserved + clock fit 88px)");
  assert.equal(tagsOf(html, "floor-tile-long-stay").length, 1, "K10: one sr-only Long stay, never two");
  expectAll(tagOf(html, "floor-tile-long-stay"), ["sr-only"], "K10: the word is for readers");
  assert.equal(textOf(html, "floor-tile-clock"), "Long stay", "K10: the clock's own word is the one");
  assert.equal(tagsOf(html, "floor-tile-more").length, 0, "K10: no ⋯");
});

test("FloorTile: busy K5 / K8 keep the disabled trigger with the spinner (no ⋯), the surface a div with aria-busy and no target", () => {
  for (const kind of ["K5", "K8"] as const) {
    const html = render(K[kind], true);
    assert.match(tagOf(html, "floor-tile-more"), /^<button [^>]*disabled=""/, `${kind} busy: the trigger stays mounted, disabled (focus kept)`);
    assert.match(trigger(html), /<svg [^>]*class="lucide lucide-loader-circle mb-px size-3\.5 animate-spin"/, `${kind} busy: the spinner in the trigger`);
    assert.ok(!html.includes("lucide-ellipsis"), `${kind} busy: the ⋯ glyph swapped out`);
    const surface = tagOf(html, "floor-tile");
    assert.match(surface, /^<div [^>]*aria-busy="true"/, `${kind} busy: the surface is a busy div`);
    expectAll(surface, ["opacity-70"], `${kind} busy: 70% opacity`);
    assert.ok(!html.includes("<a "), `${kind} busy: no link`);
    assert.equal(count(html, "<button"), 1, `${kind} busy: the only button is the trigger`);
    assert.equal(count(html, "animate-spin"), 1, `${kind} busy: one spinner`);
  }
  const k2 = render(K.K2, true);
  assert.match(statusLine(k2), /data-ui="floor-tile-slot"[^>]*>\s*<svg [^>]*class="lucide lucide-loader-circle size-3\.5 animate-spin"/, "busy K2 (no ⋯): the spinner in the surface's slot");
  expectAll(tagOf(k2, "floor-tile-status"), tokens(FLOOR_STATUS_ROOM_CLASS), "busy K2: the room");
  const k1h = render(K.K1H, true);
  assert.equal(tagsOf(k1h, "floor-tile-clock").length, 0, "busy long stay: the spinner holds the slot");
  assert.equal(tagsOf(k1h, "floor-tile-long-stay").length, 1, "busy long stay: the sr-only word, once");
});

// ── Renders: the wrapper's rise and lift, the surface's press and focus (values 6.1-6.3, 7) ──────────────────────────

test("FloorTile: the wrapper rises only with a riseIndex, at tileDelay (20ms steps, 0.3s cap); none with null", () => {
  for (const [index, delay] of [[0, "0.00s"], [3, "0.06s"], [15, "0.30s"], [40, "0.30s"]] as const) {
    const wrap = tagOf(render(K.K5, false, index), "floor-tile-wrap");
    expectAll(wrap, [...tokens(FLOOR_TILE_WRAP_CLASS), FLOOR_TILE_RISE_CLASS], `index ${index}: the rise`);
    assert.match(wrap, new RegExp(`style="animation-delay:${delay.replace(".", "\\.")}"`), `index ${index}: ${delay}`);
  }
  const still = tagOf(render(K.K5), "floor-tile-wrap");
  assert.ok(!classesOf(still).includes(FLOOR_TILE_RISE_CLASS) && !still.includes("style="), "null: no rise, no delay");
  assert.match(render(K.K5), /^<div [^>]*data-ui="floor-tile-wrap"/, "the wrapper is the grid item");
});

test("FloorTile: the lift and the press only on a tile a tap acts on; the surface keeps its focus ring", () => {
  for (const kind of ["K1", "K2", "K5", "K8", "K7L"] as const) {
    const html = render(K[kind]);
    expectAll(tagOf(html, "floor-tile-wrap"), tokens(FLOOR_TILE_LIFT_CLASS), `${kind}: the wrapper lifts`);
    expectAll(tagOf(html, "floor-tile"), [...tokens(FLOOR_TILE_PRESS_CLASS), "focus-visible:ring-2", "focus-visible:ring-primary"], `${kind}: the surface presses, its ring`);
  }
  for (const [what, html] of [["K9", render(K.K9)], ["K10", render(K.K10)], ["busy K5", render(K.K5, true)], ["busy K2", render(K.K2, true)]] as const) {
    assert.ok(!classesOf(tagOf(html, "floor-tile-wrap")).includes("hover:-translate-y-[3px]"), `${what}: no lift`);
    assert.ok(!classesOf(tagOf(html, "floor-tile")).includes("active:scale-[.98]"), `${what}: no press`);
  }
  hasFocusRing(FLOOR_TILE_TRIGGER_CLASS, "the ⋯ trigger");
});

// Review Focus 4: the surface stays the only Link / button; the ⋯ is never inside it.
test("FloorTile: the surface is the only Link / button; the ⋯ is a sibling after it (Review Focus 4)", () => {
  const k5 = render(K.K5);
  assert.equal(count(k5, "<a "), 1, "K5: one link, the surface");
  assert.ok(k5.indexOf("</a>") < k5.indexOf("<button"), "K5: the trigger after the link");
  const k8 = render(K.K8);
  assert.equal(count(k8, "<button"), 2, "K8: the surface and the trigger");
  assert.ok(k8.indexOf('data-ui="floor-tile"') < k8.indexOf("</button>") && k8.indexOf("</button>") < k8.indexOf('data-ui="floor-tile-more"'), "K8: the trigger after the surface closes");
});

// ── Source pins ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("FloorTile decides its surface once (Task 3 re-review N1): the element and readsText both follow surfaceOf", () => {
  const src = code("components/tables/FloorTile.tsx");
  assert.equal(count(src, "surfaceOf("), 2, "one definition, one call");
  assert.equal(count(src, "const kind = surfaceOf(busy, primary);"), 1, "the kind from busy and the tap");
  assert.equal(count(src, 'const readsText = kind === "div";'), 1, "readsText derives from the kind");
  assert.ok(!src.includes('primary === "none"') && !src.includes("busy || primary"), "no second div decision");
  for (const c of ['case "link":', 'case "button":', 'case "div":']) assert.ok(src.includes(c), `the surfaces branch on the kind (${c})`);
  assert.equal(count(src, "useState(riseIndex)"), 1, "the rise is fixed at mount: a re-render in the cascade never cuts it");
});

test("FloorTileMenu: the trigger is the slot's (no 40px corner, no brand look)", () => {
  const src = code("components/tables/FloorTileMenu.tsx");
  assert.ok(src.includes("className={FLOOR_TILE_TRIGGER_CLASS}"), "the trigger wears the slot's class");
  assert.ok(src.includes("<Ellipsis className={FLOOR_TILE_GLYPH_CLASS} aria-hidden />"), "the 16px Ellipsis");
  assert.ok(src.includes("<Loader2 className={FLOOR_TILE_TRIGGER_SPINNER_CLASS} aria-hidden />"), "the spinner swapped in while busy");
  assert.ok(src.includes("disabled={busy}"), "disabled while busy (today's)");
  for (const gone of ["h-10 w-10", "MoreVertical", "brand-", 'variant="ghost"']) assert.ok(!src.includes(gone), `no ${gone}`);
});

test("the page gives rise indexes on the grid's first paint only (a ref that turns off after it), per section", () => {
  const page = code("app/(dashboard)/tables/page.tsx");
  assert.equal(count(page, "const firstPaint = useRef(true);"), 1, "one ref");
  assert.match(page, /useEffect\(\(\) => \{\s*if \(hasTiles\) firstPaint\.current = false;\s*\}, \[hasTiles\]\);/, "it turns off after the first paint with tiles");
  assert.ok(page.indexOf("useEffect(") < page.indexOf("if (tables.isError && tables.data === undefined)"), "the hooks run before the error branch returns");
  assert.equal(count(page, "const rising = firstPaint.current;"), 1, "read once per render");
  assert.ok(page.includes("riseIndex={rising ? index : null}"), "an index on the first paint, null afterwards");
  assert.ok(page.includes("{visible.map((tile, index) => renderTile(tile, index))}"), "the flat grid's indexes");
  const sections = code("components/tables/FloorAreaSections.tsx");
  assert.ok(sections.includes("{group.tiles.map((tile, index) => renderTile(tile, index))}"), "each section counts from 0 (values 7)");
});

test("the rise token and the Long stay words kept true in Settings and the runbook (design 11)", () => {
  assert.ok(read("app/globals.css").includes("--animate-html-rise-floor: brand-rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "values 7: rise .5s");
  const hint = "An occupied table's time turns red, with a Long stay clock, once its bill has been open this long. ${TABLE_LONG_STAY_MIN_MINUTES} to ${TABLE_LONG_STAY_MAX_MINUTES} minutes.";
  assert.ok(read("components/settings/BusinessDetailsFields.tsx").includes(hint), "the Settings hint");
  const runbook = read("../../docs/GO-LIVE-CHECKLIST.md").replace(/\s+/g, " ");
  assert.ok(runbook.includes("A running table's time turns red, with a **Long stay** clock, once its bill has been open for the minutes set in"), "the runbook's live floor line");
  assert.ok(!runbook.includes("shows **Long stay** once"), "the old words are gone");
});
