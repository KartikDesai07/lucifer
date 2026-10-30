// U4 Task 3 (2026-10-30): the Kitchen card's frame, head row, footer and Mark ready (owner Q5 / Q6 / Q9; design 6.3, 6.4,
// 6.6, 11 in docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md; values 4.1-4.5 in
// docs/superpowers/specs/2026-10-29-kitchen-html-values.md). Table-driven rules of lib/kitchen-view.ts (Review Focus 3: every
// code / where combination; the pill's words and bands; the late border; the footer; the button), the Ready toast's where,
// then a render of KitchenOrderCard against lib/kitchen-layout.ts's classes. Moved pins live where they always did: P12
// (lib/kitchen-paths.test.ts PIN 22), P46 (lib/polish-pages-paths.test.ts PANEL_FILES), P65 (lib/token-sheet-paths.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import type { KitchenRow } from "./kitchen-board";
import { readyToastMessage, type KitchenOrderCard as Card } from "./kitchen-cards";
import { KITCHEN_NOW as NOW, kitchenCard } from "./kitchen-header.fixtures";
import {
  KITCHEN_CARD_CLASS,
  KITCHEN_CARD_CODE_CLASS,
  KITCHEN_CARD_EDGE_CLASS,
  KITCHEN_CARD_FOOTER_CLASS,
  KITCHEN_CARD_HEAD_CLASS,
  KITCHEN_CARD_LINES_CLASS,
  KITCHEN_CARD_RISE_CLASS,
  KITCHEN_CARD_TITLE_CLASS,
  KITCHEN_CARD_WHERE_CLASS,
  KITCHEN_PILL_BAND_CLASS,
  KITCHEN_PILL_CLASS,
  KITCHEN_READY_CLASS,
  KITCHEN_READY_KIND_CLASS,
} from "./kitchen-layout";
import { orderNumber, orderNumberOf } from "./orders-row";
import { kitchenButton, kitchenCardCode, kitchenCardLate, kitchenFooter, kitchenPill, kitchenWhereLine } from "./kitchen-view";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";
import type { Order } from "@/types";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const MIN = 60_000;
const APPROX = "approximate — fired before age tracking";

/** A card at `table` with the order number `no`, fired `ageMin` minutes before the HTML's clock (9:30 PM IST). */
const card = (table: string, no: string, ageMin = 4, extra: Partial<Card> = {}): Card =>
  kitchenCard(table, ageMin, { orderNo: `ORD-20261019-${no}`, ...extra });

/** A line of round `round`, fired `ageMin` minutes before the HTML's clock. */
const line = (round: number, ageMin: number, extra: Partial<KitchenRow> = {}): KitchenRow => ({
  orderId: "order-x",
  orderNo: "ORD-20261019-012",
  id: `order-x:r${round}-${ageMin}`,
  ref: `r${round}-${ageMin}`,
  name: "Chicken Zinger",
  qty: 2,
  modifiers: [],
  round,
  tableLabel: "T-4",
  selfOrder: false,
  firedAt: new Date(NOW - ageMin * MIN).toISOString(),
  firedAtApprox: false,
  done: false,
  ...extra,
});

// ── The code and the where line (Q6 / Q9; design 6.3; Review Focus 3) ───────────────────────────────────────────────

test("orderNumberOf: '#' + the order id's last segment; orderNumber(o) reads the same", () => {
  assert.equal(orderNumberOf("ORD-20261019-012"), "#012", "the day's number");
  assert.equal(orderNumberOf("ORD-20261019-1041"), "#1041", "four digits");
  assert.equal(orderNumberOf("LEGACY"), "#LEGACY", "an id with no dash reads whole");
  assert.equal(orderNumber({ orderId: "ORD-20261019-014" } as Order), orderNumberOf("ORD-20261019-014"), "U2's orderNumber calls it");
});

test("kitchenCardCode / kitchenWhereLine: every table / token / parcel / self-order combination (design 6.3, 11)", () => {
  const rows: Array<[string, Card, string, string]> = [
    ["a table card", card("T-4", "012"), "T-4", "Table · Order #012"],
    ["a table card with a token: the token in the where line", card("T-4", "012", 4, { tokenNumber: 12 }), "T-4", "Table · Order #012 · Token 12"],
    ["no table, no token", card("Walk-In", "014"), "Walk-In", "Order #014"],
    ["no table with a token: the token is the code (Q9)", card("Walk-In", "012", 4, { tokenNumber: 12 }), "Token 12", "Walk-In · Order #012"],
    ["a parcel, no token", card("Walk-In", "013", 4, { parcel: true }), "Parcel", "Order #013"],
    ["a parcel with a token (Q9)", card("Walk-In", "013", 4, { parcel: true, tokenNumber: 13 }), "Token 13", "Parcel · Order #013"],
    ["a self-order with no table", card("Walk-In", "014", 4, { selfOrder: true }), "Walk-In", "Order #014 · Self-order"],
    [
      "a self-order at a table with a token",
      card("T-6", "015", 4, { selfOrder: true, tokenNumber: 15 }),
      "T-6",
      "Table · Order #015 · Token 15 · Self-order",
    ],
    ["a parcel at a table: the table's name", card("Garden 2", "016", 4, { parcel: true }), "Garden 2", "Table · Order #016"],
    ["a token 0 is a token", card("Walk-In", "017", 4, { tokenNumber: 0 }), "Token 0", "Walk-In · Order #017"],
    ["a legacy order id", kitchenCard("T-2", 4, { orderNo: "LEGACY" }), "T-2", "Table · Order #LEGACY"],
  ];
  for (const [what, c, wantCode, wantWhere] of rows) {
    assert.equal(kitchenCardCode(c), wantCode, `${what}: the code`);
    assert.equal(kitchenWhereLine(c), wantWhere, `${what}: the where line`);
  }
});

// ── The time pill and the late border (design 6.3, 6.4; values 4.4) ─────────────────────────────────────────────────

test("kitchenPill: the HTML's words and bands at 0.4 / 9 / 10 / 19 / 20 / 75 min, the hour form, '~' with its title", () => {
  const rows: Array<[number, Partial<Card>, string, "fresh" | "warn" | "late", boolean]> = [
    [0.4, {}, "Now", "fresh", false],
    [1, {}, "1 min", "fresh", false],
    [9, {}, "9 min", "fresh", false],
    [10, {}, "10 min", "warn", false],
    [19, {}, "19 min", "warn", false],
    [19.5, {}, "19 min", "warn", false],
    [20, {}, "20 min", "late", true],
    [75, {}, "1h 15m", "late", true],
    [42, { cardFiredAtApprox: true }, "~42 min", "late", true],
    [0.4, { cardFiredAtApprox: true }, "~Now", "fresh", false],
    [-2, {}, "Now", "fresh", false],
  ];
  for (const [age, extra, text, band, srLate] of rows) {
    const pill = kitchenPill(card("T-4", "012", age, extra), NOW);
    assert.equal(pill.text, text, `${age} min${extra.cardFiredAtApprox ? " (approximate)" : ""}: the words`);
    assert.equal(pill.band, band, `${age} min: the band`);
    assert.equal(pill.srLate, srLate, `${age} min: "Late" read to screen readers only when late`);
    assert.equal(pill.title, extra.cardFiredAtApprox ? APPROX : undefined, `${age} min: the title only when approximate`);
  }
});

test("kitchenCardLate: the red border only while lines are open (the HTML's Ready column read as every line ticked)", () => {
  assert.equal(kitchenCardLate(card("T-4", "012", 20), NOW), true, "20 min, lines open: late");
  assert.equal(kitchenCardLate(card("T-4", "012", 75, { doneCount: 2, totalCount: 3 }), NOW), true, "75 min, one line open: late");
  assert.equal(kitchenCardLate(card("T-4", "012", 30, { doneCount: 1, totalCount: 1, allDone: true }), NOW), false, "30 min, every line ticked: normal");
  assert.equal(kitchenCardLate(card("T-4", "012", 19), NOW), false, "19 min: not late");
});

// ── The footer and the button (design 6.3; Q5) ──────────────────────────────────────────────────────────────────────

test("kitchenFooter: the ticket numbers and the first round's time (IST), 'Sent' with numbering off, '~' when approximate", () => {
  const one = card("T-4", "012", 4, { ticketNumbers: [9], lines: [line(1, 4, { ticketNumber: 9 })] });
  assert.deepEqual(kitchenFooter(one), { left: "KOT #9 · 9:26 PM", right: "0 of 1 done" }, "one round");
  const two = card("T-4", "012", 11, {
    ticketNumbers: [9, 12],
    lines: [line(2, 0, { ticketNumber: 12 }), line(1, 11, { ticketNumber: 9 })],
    doneCount: 2,
    totalCount: 3,
  });
  assert.deepEqual(kitchenFooter(two), { left: "KOT #9, #12 · 9:19 PM", right: "2 of 3 done" }, "two rounds: both numbers, round 1's time");
  const off = card("T-4", "012", 4, { lines: [line(1, 4)] });
  assert.equal(kitchenFooter(off).left, "Sent 9:26 PM", "ticket numbers off");
  const approx = card("T-4", "012", 4, { lines: [line(1, 4, { firedAtApprox: true })] });
  assert.equal(kitchenFooter(approx).left, "Sent ~9:26 PM", "an approximate first round");
  const noLines = card("T-4", "012", 4, { ticketNumbers: [7] });
  assert.equal(kitchenFooter(noLines).left, "KOT #7 · 9:26 PM", "no line given: the card's own fire time");
});

test("kitchenButton: 'Mark ready · {n} not ticked' on ink while lines are open, a green 'Mark ready' once all are ticked", () => {
  const at = (done: number) => kitchenButton(card("T-4", "012", 4, { doneCount: done, totalCount: 3, allDone: done === 3 }));
  assert.deepEqual(at(0), { label: "Mark ready · 3 not ticked", kind: "open" }, "0 of 3 ticked");
  assert.deepEqual(at(1), { label: "Mark ready · 2 not ticked", kind: "open" }, "1 of 3 ticked");
  assert.deepEqual(at(2), { label: "Mark ready · 1 not ticked", kind: "open" }, "2 of 3 ticked");
  assert.deepEqual(at(3), { label: "Mark ready", kind: "done" }, "3 of 3 ticked");
});

test("the Ready toast names the card by its code (Q9; design 6.6): Parcel, Token 12, the table", () => {
  const toast = (c: Card) => readyToastMessage({ ...c, tableLabel: kitchenCardCode(c) });
  const parcel = card("Walk-In", "013", 4, { parcel: true, doneCount: 1, totalCount: 2 });
  assert.equal(toast(parcel), "Parcel marked ready — 1 line not ticked", "a parcel (today 'Walk-In marked ready')");
  const token = card("Walk-In", "012", 4, { tokenNumber: 12, doneCount: 1, totalCount: 1, allDone: true });
  assert.equal(toast(token), "Token 12 marked ready", "a token card");
  assert.equal(toast(card("T-4", "012", 4, { doneCount: 1, totalCount: 1, allDone: true })), "T-4 marked ready", "a table card");
  const actions = code("hooks/use-kitchen-actions.ts");
  assert.match(actions, /readyToastMessage\(\{ \.\.\.card, tableLabel: kitchenCardCode\(card\) \}\)/, "the hook's toast uses the card's code");
});

// ── The card, rendered (values 4.1; design 6.3) ─────────────────────────────────────────────────────────────────────

const render = (c: Card, extra: { readyInFlight?: boolean; rise?: boolean } = {}): string =>
  renderToStaticMarkup(
    createElement(KitchenOrderCard, {
      card: c,
      now: new Date(NOW),
      onToggleLine: () => {},
      onReady: () => {},
      lineInFlight: () => false,
      readyInFlight: extra.readyInFlight ?? false,
      ...(extra.rise === undefined ? {} : { rise: extra.rise }),
    }),
  );

test("the card's classes: the HTML's frame, head row, code, where, pill, list, footer and button (values 4.1)", () => {
  expectAll(`<i class="${KITCHEN_CARD_CLASS}">`, ["flex", "flex-col", "rounded-[12px]", "border", "overflow-clip", "bg-card"], "the frame");
  assert.ok(!tokens(KITCHEN_CARD_CLASS).includes("overflow-hidden"), "clip, never hidden (U3: hidden makes a scroll container)");
  assert.deepEqual(KITCHEN_CARD_EDGE_CLASS, { normal: "border-border", late: "border-status-bad" }, "the border: --border, --bad when late");
  expectAll(`<i class="${KITCHEN_CARD_HEAD_CLASS}">`, ["flex", "items-start", "gap-2.5", "px-3", "pt-3", "pb-2.5", "border-b", "border-border-2"], "the head row");
  expectAll(`<i class="${KITCHEN_CARD_TITLE_CLASS}">`, ["min-w-0", "flex-1"], "the title block");
  const wrap = ["[overflow-wrap:anywhere]"];
  expectAll(`<i class="${KITCHEN_CARD_CODE_CLASS}">`, ["text-[20px]", "font-bold", "tracking-[-0.01em]", "leading-[1.1]", ...wrap], "the code");
  expectAll(`<i class="${KITCHEN_CARD_WHERE_CLASS}">`, ["mt-[3px]", "text-[12px]", "text-muted-foreground", ...wrap], "the where line");
  // Tailwind 4.3 writes .break-words (overflow-wrap: break-word) after the arbitrary property: beside it, it would win
  // (measured on the dev server's CSS, the Task 3 compare run 1).
  for (const cls of [KITCHEN_CARD_CODE_CLASS, KITCHEN_CARD_WHERE_CLASS]) {
    assert.ok(!tokens(cls).some((t) => t === "break-words" || t === "wrap-break-word"), `overflow-wrap anywhere alone (has "${cls}")`);
  }
  // radius 999px, the HTML's own (rounded-full computes calc(infinity * 1px), not the HTML's 999px; U2 / U3's pills).
  expectAll(`<i class="${KITCHEN_PILL_CLASS}">`, ["flex", "flex-none", "items-center", "h-[26px]", "px-[9px]", "rounded-[999px]", "text-[12.5px]", "font-bold"], "the pill");
  assert.deepEqual(
    KITCHEN_PILL_BAND_CLASS,
    { fresh: "bg-status-ok-tint text-status-ok-ink", warn: "bg-status-warn-tint text-status-warn-ink", late: "bg-status-bad-tint text-status-bad-ink" },
    "values 4.4: the bands' tints (--ok-t / --ok-i, --warn-t / --warn-i, --bad-t / --bad-i)",
  );
  expectAll(`<i class="${KITCHEN_CARD_LINES_CLASS}">`, ["flex", "flex-col", "py-1"], "the item list");
  expectAll(
    `<i class="${KITCHEN_CARD_FOOTER_CLASS}">`,
    ["flex", "items-center", "justify-between", "gap-2", "px-3", "pb-1", "text-[11.5px]", "text-subtle-foreground"],
    "the footer",
  );
  expectAll(
    `<i class="${KITCHEN_READY_CLASS}">`,
    ["mx-3", "mt-1.5", "mb-3", "h-[46px]", "rounded-[10px]", "text-[14.5px]", "font-semibold", "border-0", "cursor-pointer", "px-1.5", "py-px"],
    "the button",
  );
  assert.ok(!tokens(KITCHEN_READY_CLASS).some((t) => t === "flex" || t === "inline-flex"), "a plain button: no flex children to stretch (WebView 109)");
  assert.deepEqual(KITCHEN_READY_KIND_CLASS, { open: "bg-ink text-on-ink", done: "bg-status-ok-ink text-white" }, "Q5: ink, then the darker green");
  assert.equal(KITCHEN_CARD_RISE_CLASS, "motion-safe:animate-html-rise-row", "the HTML's rise .35s (Task 4 sets it)");
});

test("KitchenOrderCard renders the view: code, where, pill with 'Late' for screen readers, footer, the ink button", () => {
  const late = card("T-4", "012", 25, { tokenNumber: 12, ticketNumbers: [9], doneCount: 1, totalCount: 2, lines: [line(1, 25, { ticketNumber: 9 })] });
  const html = render(late);
  expectAll(tagOf(html, "kitchen-card"), [...tokens(KITCHEN_CARD_CLASS), "border-status-bad"], "a late card with lines open");
  assert.ok(!classesOf(tagOf(html, "kitchen-card")).includes("border-border"), "one border colour");
  assert.ok(!classesOf(tagOf(html, "kitchen-card")).includes(KITCHEN_CARD_RISE_CLASS), "no rise by default");
  expectAll(tagOf(html, "kitchen-card-head"), tokens(KITCHEN_CARD_HEAD_CLASS), "the head row");
  assert.equal(textOf(html, "kitchen-card-code"), "T-4", "the code");
  expectAll(tagOf(html, "kitchen-card-code"), tokens(KITCHEN_CARD_CODE_CLASS), "the code");
  assert.equal(textOf(html, "kitchen-card-where"), "Table · Order #012 · Token 12", "the where line");
  expectAll(tagOf(html, "kitchen-card-pill"), [...tokens(KITCHEN_PILL_CLASS), ...tokens(KITCHEN_PILL_BAND_CLASS.late)], "the late pill");
  assert.equal(textOf(html, "kitchen-card-pill"), "25 min Late", "the pill's words, 'Late' after them");
  assert.match(html, /<span class="sr-only"> Late<\/span>/, "'Late' is read to screen readers only");
  expectAll(tagOf(html, "kitchen-card-lines"), tokens(KITCHEN_CARD_LINES_CLASS), "the item list");
  assert.equal(tagsOf(html, "kitchen-card-lines").length, 1, "one item list");
  expectAll(tagOf(html, "kitchen-card-footer"), tokens(KITCHEN_CARD_FOOTER_CLASS), "the footer");
  assert.equal(textOf(html, "kitchen-card-footer"), "KOT #9 · 9:05 PM1 of 2 done", "the footer's two spans");
  const button = tagOf(html, "kitchen-card-ready");
  expectAll(button, [...tokens(KITCHEN_READY_CLASS), ...tokens(KITCHEN_READY_KIND_CLASS.open)], "the open button");
  assert.match(button, /^<button type="button"/, "a real button");
  assert.ok(!/ disabled=""/.test(button), "enabled while no write runs");
  assert.equal(textOf(html, "kitchen-card-ready"), "Mark ready · 1 not ticked", "the nudge (Q5)");
  assert.ok(!html.includes("Ready to serve"), "the separate 'Ready to serve' line is gone (Q5)");
});

test("KitchenOrderCard: a fresh all-ticked card is --border with the green Mark ready; in flight it is disabled; rise adds the rise", () => {
  const done = card("Walk-In", "013", 3, { parcel: true, doneCount: 1, totalCount: 1, allDone: true, cardFiredAtApprox: true });
  const html = render(done);
  expectAll(tagOf(html, "kitchen-card"), ["border-border"], "a fresh card");
  assert.ok(!classesOf(tagOf(html, "kitchen-card")).includes("border-status-bad"), "not late");
  assert.equal(textOf(html, "kitchen-card-code"), "Parcel", "the parcel's code");
  assert.equal(textOf(html, "kitchen-card-where"), "Order #013", "nothing repeats the code");
  expectAll(tagOf(html, "kitchen-card-pill"), tokens(KITCHEN_PILL_BAND_CLASS.fresh), "the fresh pill");
  assert.match(tagOf(html, "kitchen-card-pill"), new RegExp(`title="${APPROX}"`), "the approximate title");
  assert.ok(!html.includes("sr-only"), "no 'Late' when not late");
  expectAll(tagOf(html, "kitchen-card-ready"), tokens(KITCHEN_READY_KIND_CLASS.done), "the green button");
  assert.equal(textOf(html, "kitchen-card-ready"), "Mark ready", "every line ticked");
  assert.match(tagOf(render(done, { readyInFlight: true }), "kitchen-card-ready"), / disabled=""/, "disabled while its own write runs (P12)");
  expectAll(tagOf(render(done, { rise: true }), "kitchen-card"), [KITCHEN_CARD_RISE_CLASS], "rise: the HTML's rise");
});

test("KitchenOrderCard's source: tokens only (no raw palette colour), no paper panel, no kit Button, the view's words", () => {
  const src = code("components/kitchen/KitchenOrderCard.tsx");
  assert.match(src, /export function KitchenOrderCard\(/, "landmark: the card");
  for (const raw of ["orange", "blue", "amber", "red", "green"]) {
    assert.ok(!new RegExp(`\\b(?:text|bg|border)-${raw}-\\d`).test(src), `no raw ${raw} palette class (design 6.3: tokens only)`);
  }
  assert.ok(!src.includes("BRAND_PANEL_CLASS"), "the HTML card is --surface + --border, radius 12 (P46 moved)");
  assert.ok(!src.includes("@/components/ui/button"), "the HTML's button, not the kit's");
  for (const fn of ["kitchenCardCode(", "kitchenWhereLine(", "kitchenPill(", "kitchenCardLate(", "kitchenFooter(", "kitchenButton("]) {
    assert.ok(src.includes(fn), `the card draws lib/kitchen-view.ts's ${fn.slice(0, -1)}`);
  }
});
