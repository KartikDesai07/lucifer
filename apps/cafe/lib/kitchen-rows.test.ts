// U4 Task 4 (2026-10-30): the Kitchen card's lines as the owner's HTML rows (values 4.1, 4.2, 4.6; design 6.3), the round
// dividers (owner Q6; design 6.3) and the card's rise fixed when it mounts (design 6.3 Motion). lib/kitchen-view.ts's
// kitchenRoundGroups table-driven (Review Focus 3: two and three rounds, numbering off, an approximate round), then renders of
// KitchenLineCard and KitchenOrderCard against lib/kitchen-layout.ts's classes. P49 (the checkbox in a 40px label) moved on
// purpose in lib/polish-pages-paths.test.ts: the whole row is the HTML's button (38px with a one-line name, values 4.2).
// Kept apart from lib/kitchen-view.test.ts (Task 3's), which would pass the 300-line house limit.
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
import type { KitchenOrderCard as Card } from "./kitchen-cards";
import { KITCHEN_NOW as NOW, kitchenCard } from "./kitchen-header.fixtures";
import {
  KITCHEN_CARD_RISE_CLASS,
  KITCHEN_ROUND_CLASS,
  KITCHEN_ROW_BOX_CLASS,
  KITCHEN_ROW_BOX_KIND_CLASS,
  KITCHEN_ROW_CLASS,
  KITCHEN_ROW_DONE_TEXT_CLASS,
  KITCHEN_ROW_MOD_CLASS,
  KITCHEN_ROW_MOD_KIND_CLASS,
  KITCHEN_ROW_MORE_CLASS,
  KITCHEN_ROW_NAME_CLASS,
  KITCHEN_ROW_NAME_DONE_CLASS,
  KITCHEN_ROW_NOTE_CLASS,
  KITCHEN_ROW_NOTE_TONE_CLASS,
  KITCHEN_ROW_QTY_CLASS,
  KITCHEN_ROW_TEXT_CLASS,
} from "./kitchen-layout";
import { kitchenRoundGroups } from "./kitchen-view";
import { KitchenLineCard } from "@/components/kitchen/KitchenLineCard";
import { KitchenOrderCard } from "@/components/kitchen/KitchenOrderCard";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const MIN = 60_000;
const ANYWHERE = "[overflow-wrap:anywhere]";

let seq = 0;
/** A line of round `round`, fired `ageMin` minutes before the HTML's clock (9:30 PM IST). */
const line = (round: number, ageMin: number, extra: Partial<KitchenRow> = {}): KitchenRow => {
  seq += 1;
  return {
    orderId: "order-x",
    orderNo: "ORD-20261019-012",
    id: `order-x:l${seq}`,
    ref: `l${seq}`,
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
  };
};
const cardOf = (lines: KitchenRow[], extra: Partial<Card> = {}): Card =>
  kitchenCard("T-4", 12, { lines, totalCount: lines.length, doneCount: lines.filter((l) => l.done).length, ...extra });
const shape = (c: Card) => kitchenRoundGroups(c).map((g) => [g.round, g.label, g.lines.map((l) => l.id)]);

// ── The round groups (owner Q6; design 6.3; Review Focus 3) ──────────────────────────────────────────────────────────

test("kitchenRoundGroups: one round has no divider; each later round 'Round {r} · KOT #{t} · {time}' (IST)", () => {
  const one = [line(1, 4, { ticketNumber: 9 }), line(1, 4, { ticketNumber: 9 })];
  assert.deepEqual(shape(cardOf(one)), [[1, null, one.map((l) => l.id)]], "one round: one group, no label");
  const two = [line(1, 11, { ticketNumber: 9 }), line(1, 11, { ticketNumber: 9 }), line(2, 0, { ticketNumber: 12 })];
  assert.deepEqual(
    shape(cardOf(two)),
    [[1, null, [two[0].id, two[1].id]], [2, "Round 2 · KOT #12 · 9:30 PM", [two[2].id]]],
    "rounds 1 + 2: the first round unlabelled, round 2 with its number and fire time",
  );
});

test("kitchenRoundGroups: three rounds with ticket numbers off leave 'KOT #' out; an approximate round reads '~'", () => {
  const off = [line(1, 20), line(2, 8), line(3, 2)];
  assert.deepEqual(
    shape(cardOf(off)),
    [[1, null, [off[0].id]], [2, "Round 2 · 9:22 PM", [off[1].id]], [3, "Round 3 · 9:28 PM", [off[2].id]]],
    "1 + 2 + 3, numbering off",
  );
  const approx = [line(1, 40, { ticketNumber: 9, firedAtApprox: true }), line(2, 8, { ticketNumber: 12, firedAtApprox: true })];
  assert.equal(kitchenRoundGroups(cardOf(approx))[1].label, "Round 2 · KOT #12 · ~9:22 PM", "an approximate round's time");
  const bad = [line(1, 4, { ticketNumber: 9 }), line(2, 0, { ticketNumber: 12, firedAt: "not-a-date" })];
  assert.equal(kitchenRoundGroups(cardOf(bad))[1].label, "Round 2 · KOT #12", "a stamp that does not parse: no time, never a throw");
  const badOff = [line(1, 4), line(2, 0, { firedAt: "" })];
  assert.equal(kitchenRoundGroups(cardOf(badOff))[1].label, "Round 2", "numbering off and no time: the round alone");
});

test("kitchenRoundGroups: rounds ascending, each round's lines in today's order; a card starting at round 2 is unlabelled", () => {
  const mixed = [line(2, 0, { ticketNumber: 12 }), line(1, 11, { ticketNumber: 9 }), line(2, 0, { ticketNumber: 12 }), line(1, 11, { ticketNumber: 9 })];
  assert.deepEqual(
    shape(cardOf(mixed)),
    [[1, null, [mixed[1].id, mixed[3].id]], [2, "Round 2 · KOT #12 · 9:30 PM", [mixed[0].id, mixed[2].id]]],
    "round, then line (design 6.3): the relative order inside a round kept",
  );
  const late = [line(2, 6, { ticketNumber: 12 }), line(3, 1, { ticketNumber: 14 })];
  assert.deepEqual(
    shape(cardOf(late)).map(([round, label]) => [round, label]),
    [[2, null], [3, "Round 3 · KOT #14 · 9:29 PM"]],
    "round 1 voided: the first round on the card has no divider",
  );
  assert.deepEqual(kitchenRoundGroups(cardOf([])), [], "no lines: no groups");
});

// ── The row's classes (values 4.1, 4.2, 4.6, 5.4) ────────────────────────────────────────────────────────────────────

test("the row's classes: the HTML's full-width button, its box, quantity, text column, name, meta and note (values 4.1)", () => {
  expectAll(
    `<i class="${KITCHEN_ROW_CLASS}">`,
    ["flex", "w-full", "items-start", "gap-2.5", "px-3", "py-[9px]", "text-left", "text-foreground", "cursor-pointer", "border-0", "bg-transparent", "pointer-fine:hover:bg-hover"],
    "the row",
  );
  // The card clips (overflow clip): an outer ring would be cut at its edges, so the keyboard ring is inset (U3's tabs').
  expectAll(`<i class="${KITCHEN_ROW_CLASS}">`, ["outline-none", "focus-visible:ring-2", "focus-visible:ring-inset", "focus-visible:ring-primary"], "the row's ring");
  assert.ok(!tokens(KITCHEN_ROW_CLASS).some((t) => t.startsWith("hover:")), "hover only where a pointer can hover (R14)");
  assert.ok(!tokens(KITCHEN_ROW_CLASS).some((t) => t.startsWith("disabled:")), "no look of its own while its write runs (design 6.3)");
  assert.ok(!tokens(KITCHEN_ROW_CLASS).some((t) => t.startsWith("opacity-")), "the row is never dimmed as a whole (ruling K5)");
  assert.equal(KITCHEN_ROW_DONE_TEXT_CLASS, "text-subtle-foreground", "a ticked line's text: --text-3, 5.3:1 (ruling K5)");
  assert.equal(KITCHEN_ROW_NAME_DONE_CLASS, "line-through text-subtle-foreground", "a ticked name: struck, in --text-3");
  expectAll(
    `<i class="${KITCHEN_ROW_BOX_CLASS}">`,
    ["flex", "flex-none", "items-center", "justify-center", "size-[18px]", "mt-0.5", "rounded-[5px]", "border-[1.5px]", "text-white"],
    "the box",
  );
  assert.deepEqual(KITCHEN_ROW_BOX_KIND_CLASS, { open: "border-subtle-foreground", done: "border-status-ok bg-status-ok" }, "--text-3, then --ok fill and border");
  expectAll(`<i class="${KITCHEN_ROW_QTY_CLASS}">`, ["min-w-[26px]", "text-[15px]", "font-bold", ANYWHERE], "the quantity");
  expectAll(`<i class="${KITCHEN_ROW_TEXT_CLASS}">`, ["min-w-0", "flex-1", "w-full"], "the text column (w-full: WebView 109, VC-1)");
  expectAll(`<i class="${KITCHEN_ROW_NAME_CLASS}">`, ["block", "text-[15px]", "font-medium", ANYWHERE], "the name");
  expectAll(`<i class="${KITCHEN_ROW_MOD_CLASS}">`, ["block", "text-[12.5px]", ANYWHERE], "a modifier line");
  assert.deepEqual(
    KITCHEN_ROW_MOD_KIND_CLASS,
    {
      open: { added: "text-muted-foreground", removed: "font-semibold text-foreground" },
      done: { added: "text-subtle-foreground", removed: "font-semibold text-subtle-foreground" },
    },
    "the HTML's meta, a NO line in ink 600; ticked, both --text-3 (the NO line still 600)",
  );
  expectAll(`<i class="${KITCHEN_ROW_NOTE_CLASS}">`, ["block", "text-[12.5px]", "font-semibold", ANYWHERE], "the note");
  assert.deepEqual(KITCHEN_ROW_NOTE_TONE_CLASS, { open: "text-status-warn-ink", done: "text-subtle-foreground" }, "--warn-i, then --text-3");
  expectAll(`<i class="${KITCHEN_ROUND_CLASS}">`, ["px-3", "pt-1.5", "pb-0.5", "text-[11.5px]", "text-subtle-foreground", ANYWHERE], "a round divider (the footer's type)");
  for (const cls of [KITCHEN_ROW_QTY_CLASS, KITCHEN_ROW_NAME_CLASS, KITCHEN_ROW_MOD_CLASS, KITCHEN_ROW_NOTE_CLASS, KITCHEN_ROUND_CLASS]) {
    assert.ok(!tokens(cls).some((t) => t === "break-words" || t === "wrap-break-word"), `overflow-wrap anywhere alone (Task 3's lesson): "${cls}"`);
  }
});

// ── The row, rendered (values 4.1, 4.6; design 6.3) ──────────────────────────────────────────────────────────────────

const renderRow = (row: KitchenRow, pending = false): string =>
  renderToStaticMarkup(createElement(KitchenLineCard, { row, onToggle: () => {}, pending }));

test("KitchenLineCard: an open line is one button across the card, a checkbox to assistive tech, its box empty", () => {
  const html = renderRow(line(1, 4, { name: "Chicken Zinger", qty: 2 }));
  const row = tagOf(html, "kitchen-line");
  assert.match(row, /^<button type="button" role="checkbox" aria-checked="false" aria-label="Mark Chicken Zinger done"/, "the row button, today's name");
  expectAll(row, tokens(KITCHEN_ROW_CLASS), "the row");
  assert.ok(!classesOf(tagOf(html, "kitchen-line-qty")).includes(KITCHEN_ROW_DONE_TEXT_CLASS), "the quantity in --text while open");
  assert.ok(!/ disabled=""/.test(row), "enabled while no write runs");
  const box = tagOf(html, "kitchen-line-box");
  expectAll(box, [...tokens(KITCHEN_ROW_BOX_CLASS), KITCHEN_ROW_BOX_KIND_CLASS.open], "the open box");
  assert.match(box, /aria-hidden="true"/, "the drawn box is decoration (the row carries the state)");
  assert.ok(!html.includes("<svg"), "the tick is drawn only when ticked (design 8 #1)");
  assert.equal(textOf(html, "kitchen-line-qty"), "2×", "the quantity '{qty}×'");
  assert.equal(textOf(html, "kitchen-line-name"), "Chicken Zinger", "the name");
  assert.ok(!classesOf(tagOf(html, "kitchen-line-name")).includes("line-through"), "not struck while open");
  for (const gone of ["<label", "min-h-10", "min-w-10", "Round 1", "Self-order"]) assert.ok(!html.includes(gone), `no "${gone}" (P49 moved; the meta goes)`);
});

test("KitchenLineCard: a ticked line dims its text to --text-3 (ruling K5), struck, the full --ok box with the HTML's tick; in flight it is disabled", () => {
  const html = renderRow(line(1, 4, { name: "Butter Naan", qty: 3, done: true, modifiers: ["Ghee"], removedModifiers: ["Garlic"], instructions: "Crisp" }));
  const row = tagOf(html, "kitchen-line");
  assert.match(row, /aria-checked="true"/, "it says it is ticked");
  assert.match(row, /aria-label="Mark Butter Naan done"/, "the same accessible name when ticked (today's)");
  assert.ok(!classesOf(row).some((t) => t.startsWith("opacity-")), "no opacity on the row (the HTML's .5 is about 3.4:1, ruling K5)");
  expectAll(tagOf(html, "kitchen-line-qty"), [KITCHEN_ROW_DONE_TEXT_CLASS], "the quantity in --text-3");
  expectAll(tagOf(html, "kitchen-line-name"), tokens(KITCHEN_ROW_NAME_DONE_CLASS), "the name struck, in --text-3");
  expectAll(tagsOf(html, "kitchen-line-mod")[0], tokens(KITCHEN_ROW_MOD_KIND_CLASS.done.removed), "the NO line in --text-3, still 600");
  expectAll(tagsOf(html, "kitchen-line-mod")[1], tokens(KITCHEN_ROW_MOD_KIND_CLASS.done.added), "the + line in --text-3");
  expectAll(tagOf(html, "kitchen-line-note"), [KITCHEN_ROW_NOTE_TONE_CLASS.done], "the note in --text-3");
  const openInk = ["text-muted-foreground", "text-foreground", "text-status-warn-ink"];
  for (const tag of [tagOf(html, "kitchen-line-qty"), tagOf(html, "kitchen-line-name"), tagOf(html, "kitchen-line-note"), ...tagsOf(html, "kitchen-line-mod")]) {
    assert.ok(!classesOf(tag).some((t) => openInk.includes(t)), `no open ink on a ticked line's text (${tag.slice(0, 60)})`);
  }
  expectAll(tagOf(html, "kitchen-line-box"), [...tokens(KITCHEN_ROW_BOX_KIND_CLASS.done)], "the ticked box keeps its full --ok fill and border");
  assert.match(
    html,
    /<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"[^>]*><path d="M5 12l5 5L20 7"><\/path><\/svg>/,
    "the HTML's tick",
  );
  expectAll(tagOf(html, "kitchen-line-name"), ["line-through"], "the name struck through");
  assert.match(tagOf(renderRow(line(1, 4), true), "kitchen-line"), / disabled=""/, "disabled while its own write runs");
});

test("KitchenLineCard: the shared formatter's lines (a NO line in ink 600), 'Note: …' in warn ink; every text breaks anywhere", () => {
  const html = renderRow(line(1, 4, { name: "Margherita (Large)", modifiers: ["Extra cheese", "Jalapeños"], removedModifiers: ["Mushroom", "Onion"], instructions: "Less sugar, no ice" }));
  const mods = tagsOf(html, "kitchen-line-mod");
  assert.equal(mods.length, 2, "one line per formatter line");
  assert.equal(textOf(html, "kitchen-line-mod", 0), "NO Mushroom, NO Onion", "the removals first (orderItemModifierLines)");
  expectAll(mods[0], [...tokens(KITCHEN_ROW_MOD_CLASS), ...tokens(KITCHEN_ROW_MOD_KIND_CLASS.open.removed)], "a NO line");
  assert.equal(textOf(html, "kitchen-line-mod", 1), "+ Extra cheese, Jalapeños", "the additions");
  expectAll(mods[1], [...tokens(KITCHEN_ROW_MOD_CLASS), KITCHEN_ROW_MOD_KIND_CLASS.open.added], "an added line: the HTML's meta");
  assert.equal(textOf(html, "kitchen-line-note"), "Note: Less sugar, no ice", "the HTML's note words");
  expectAll(tagOf(html, "kitchen-line-note"), [...tokens(KITCHEN_ROW_NOTE_CLASS), KITCHEN_ROW_NOTE_TONE_CLASS.open], "the note in --warn-i");
  expectAll(tagOf(html, "kitchen-line-text"), tokens(KITCHEN_ROW_TEXT_CLASS), "the text column");
  expectAll(tagOf(html, "kitchen-line-qty"), tokens(KITCHEN_ROW_QTY_CLASS), "the quantity");
  assert.equal(textOf(html, "kitchen-line-name"), "Margherita (Large)", "the name with its variation once (P11)");
  assert.equal(tagsOf(renderRow(line(1, 4)), "kitchen-line-note").length, 0, "no note: no note line");
});

// Fix 1 (logic-1 / keep-1): a checkbox's content is presentational and its aria-label is its whole name, so everything a
// cook hears beyond "Mark {name} done" is its description: the quantity, the formatter's lines and the note.
test("KitchenLineCard: the row's description reads the quantity, the NO / + lines and the note; every id resolves, none for a part not drawn", () => {
  const html = renderRow(line(1, 4, { name: "Margherita (Large)", qty: 2, modifiers: ["Extra cheese"], removedModifiers: ["Mushroom"], instructions: "Less sugar" }));
  const row = tagOf(html, "kitchen-line");
  assert.match(row, /aria-label="Mark Margherita \(Large\) done"/, "the name stays today's (test-used)");
  const ids = (/aria-describedby="([^"]*)"/.exec(row)?.[1] ?? "").split(" ").filter(Boolean);
  assert.equal(ids.length, 2, `the quantity and the lines under the name (got "${ids.join(" ")}")`);
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length - 1, 1, `the description id ${id} names one element`);
  assert.match(tagOf(html, "kitchen-line-qty"), new RegExp(`id="${ids[0]}"`), "the first is the quantity");
  assert.equal(textOf(html, "kitchen-line-qty"), "2×", "its words");
  const more = tagOf(html, "kitchen-line-more");
  assert.match(more, new RegExp(`id="${ids[1]}"`), "the second wraps the modifier lines and the note");
  expectAll(more, tokens(KITCHEN_ROW_MORE_CLASS), "a plain block (no visible change)");
  assert.equal(textOf(html, "kitchen-line-more"), "NO Mushroom+ Extra cheeseNote: Less sugar", "the NO line, the + line, the note");
  assert.ok(!textOf(html, "kitchen-line-more").includes("Margherita"), "the name is not repeated");
  const bare = renderRow(line(1, 4, { qty: 3 }));
  const bareIds = (/aria-describedby="([^"]*)"/.exec(tagOf(bare, "kitchen-line"))?.[1] ?? "").split(" ").filter(Boolean);
  assert.equal(bareIds.length, 1, "no modifiers and no note: the quantity only");
  assert.equal(bare.split(`id="${bareIds[0]}"`).length - 1, 1, "and it resolves");
  assert.equal(tagsOf(bare, "kitchen-line-more").length, 0, "no empty wrapper");
  const twoRows = renderToStaticMarkup(createElement("div", null, createElement(KitchenLineCard, { row: line(1, 4), onToggle: () => {}, pending: false }), createElement(KitchenLineCard, { row: line(1, 4), onToggle: () => {}, pending: false })));
  const describedBy = [...twoRows.matchAll(/aria-describedby="([^"]*)"/g)].map((m) => m[1]);
  assert.notEqual(describedBy[0], describedBy[1], "two rows never share an id");
});

// ── The card's lines and dividers, and its rise (design 6.3) ────────────────────────────────────────────────────────

const renderCard = (c: Card, rise?: boolean): string =>
  renderToStaticMarkup(
    createElement(KitchenOrderCard, {
      card: c,
      now: new Date(NOW),
      onToggleLine: () => {},
      onReady: () => {},
      lineInFlight: () => false,
      readyInFlight: false,
      ...(rise === undefined ? {} : { rise }),
    }),
  );

test("KitchenOrderCard: the rows in the item list, a divider before each later round, none on a one-round card", () => {
  const two = [line(1, 11, { ticketNumber: 9, name: "Masala Chai" }), line(2, 0, { ticketNumber: 12, name: "Cold Coffee" })];
  const html = renderCard(cardOf(two));
  assert.equal(tagsOf(html, "kitchen-line").length, 2, "one row per line");
  assert.equal(tagsOf(html, "kitchen-card-round").length, 1, "one divider: before round 2");
  expectAll(tagOf(html, "kitchen-card-round"), tokens(KITCHEN_ROUND_CLASS), "the divider");
  assert.equal(textOf(html, "kitchen-card-round"), "Round 2 · KOT #12 · 9:30 PM", "its words");
  const lines = html.slice(html.indexOf('data-ui="kitchen-card-lines"'), html.indexOf('data-ui="kitchen-card-footer"'));
  const order = ["Mark Masala Chai done", 'data-ui="kitchen-card-round"', "Mark Cold Coffee done"].map((s) => lines.indexOf(s));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `round 1's row, the divider, round 2's row, in the item list (${order})`);
  assert.equal(tagsOf(renderCard(cardOf([line(1, 4), line(1, 4)])), "kitchen-card-round").length, 0, "one round: no divider");
  const three = renderCard(cardOf([line(1, 20), line(2, 8), line(3, 2)]));
  assert.deepEqual([textOf(three, "kitchen-card-round", 0), textOf(three, "kitchen-card-round", 1)], ["Round 2 · 9:22 PM", "Round 3 · 9:28 PM"], "three rounds, numbering off");
});

test("KitchenOrderCard: the rise is fixed when the card mounts (a later render never cuts it); none by default", () => {
  assert.ok(classesOf(tagOf(renderCard(cardOf([line(1, 4)]), true), "kitchen-card")).includes(KITCHEN_CARD_RISE_CLASS), "rise: the HTML's rise");
  assert.ok(!classesOf(tagOf(renderCard(cardOf([line(1, 4)])), "kitchen-card")).includes(KITCHEN_CARD_RISE_CLASS), "no rise by default");
  const src = code("components/kitchen/KitchenOrderCard.tsx");
  assert.match(src, /const \[rises\] = useState\(rise\);/, "the card keeps the rise it mounted with");
  assert.match(src, /rises && KITCHEN_CARD_RISE_CLASS/, "and draws that one");
  assert.match(src, /kitchenRoundGroups\(card\)/, "the card draws lib/kitchen-view.ts's round groups");
});

test("KitchenLineCard's source: the HTML's row only (no kit checkbox, no label, no raw palette, no age), the shared formatter", () => {
  const src = code("components/kitchen/KitchenLineCard.tsx");
  assert.match(src, /export function KitchenLineCard\(/, "landmark: the row");
  for (const gone of ["@/components/ui/checkbox", "BRAND_CHECKBOX_SQUARE_CLASS", "<label", "kitchenAgeBand", "lucide-react"]) {
    assert.ok(!src.includes(gone), `no "${gone}" (the HTML's row; the age is the card's pill)`);
  }
  for (const raw of ["orange", "blue", "amber", "red", "green"]) {
    assert.ok(!new RegExp(`\\b(?:text|bg|border)-${raw}-\\d`).test(src), `no raw ${raw} palette class (tokens only)`);
  }
  assert.match(src, /orderItemModifierLines\(row\)/, "the one shared formatter (P71)");
  assert.match(src, /onClick=\{\(\) => onToggle\(row, !row\.done\)\}/, "a tap flips the tick, as today's checkbox did");
});
