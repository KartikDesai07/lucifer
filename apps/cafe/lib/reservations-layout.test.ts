// U6 Task 1 (2026-11-03): the /reservations page frame, its toolbar and its states (docs/superpowers/specs/
// 2026-11-02-reservations-html-values.md 1 - 4, 9; design 5, 6.1 - 6.5, B1 - B3, B8, B9, B23). Pure pins on
// lib/reservations-layout.ts, then source pins on the markup that renders it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { POS_PAGE_CLASS } from "./pos-layout";
import * as layout from "./reservations-layout";
import {
  RESERVATIONS_PAGE_CLASS,
  RES_BODY_CLASS,
  RES_LIST_COLUMN_CLASS,
  RES_SCROLLER_CLASS,
  RES_SEARCH_INPUT_CLASS,
  RES_STATUS_SELECT_CLASS,
  isReservationsPath,
} from "./reservations-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const PAGE = "app/(dashboard)/reservations/page.tsx";

function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

test("isReservationsPath: /reservations and the pages below it, never a path that only starts with the letters", () => {
  assert.equal(isReservationsPath("/reservations"), true, "the Reservations page");
  assert.equal(isReservationsPath("/reservations/"), true, "a trailing slash");
  assert.equal(isReservationsPath("/reservations/x"), true, "a page below it");
  assert.equal(isReservationsPath("/reservations-x"), false, "another page");
  assert.equal(isReservationsPath("/reservation"), false, "a shorter path");
  assert.equal(isReservationsPath("/orders"), false, "Orders");
  assert.equal(isReservationsPath(""), false, "unknown");
});

test("the page is the /pos frame as a flex column that never scrolls; the body is one column, the 400px detail from 1280px", () => {
  assert.ok(RESERVATIONS_PAGE_CLASS.startsWith(POS_PAGE_CLASS), "the /pos frame (the screen under the header, bleeding over <main>)");
  hasAll(RESERVATIONS_PAGE_CLASS, ["flex", "flex-col", "overflow-hidden"], "page");
  hasAll(RES_BODY_CLASS, ["grid", "min-h-0", "flex-1", "grid-cols-[minmax(0,1fr)]", "xl:grid-cols-[minmax(0,1fr)_400px]"], "body");
});

test("the list column is the named container reslist, outside the scroller; the scroller carries the HTML's padding and inset (B1, B2)", () => {
  hasAll(RES_LIST_COLUMN_CLASS, ["@container/reslist", "flex", "flex-col", "min-h-0", "min-w-0"], "column");
  hasAll(
    RES_SCROLLER_CLASS,
    [
      "flex-1",
      "min-h-0",
      "gap-3",
      "overflow-y-auto",
      "overflow-x-clip",
      "pt-5",
      "px-6",
      "pb-[calc(28px+env(safe-area-inset-bottom))]",
      "max-tab:pt-4",
      "max-tab:px-3.5",
      "max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]",
      "[&::-webkit-scrollbar]:w-2",
      "[&::-webkit-scrollbar-thumb]:bg-border",
    ],
    "scroller",
  );
  assert.ok(!tokens(RES_LIST_COLUMN_CLASS).includes("overflow-y-auto"), "the container is not the scroller");
});

test("no constant clips with overflow-hidden (WebView 109) except the page frame, and none uses color-mix", () => {
  for (const [name, value] of Object.entries(layout)) {
    if (typeof value !== "string" || name === "RESERVATIONS_PAGE_CLASS" || name === "RESERVATIONS_PATH") continue;
    assert.ok(!/overflow-hidden/.test(value), `${name} uses overflow-clip, never overflow-hidden`);
    assert.ok(!/color-mix|light-dark|mask-image/.test(value), `${name} has no 109-unsafe CSS`);
  }
});

test("the status select never clips its label: it is at least its own label's width, with B3's 116.81px floor on a phone (V2-3); the search input is 16px below 720 and 14px from it (B23)", () => {
  hasAll(RES_STATUS_SELECT_CLASS, ["flex-[0_0_190px]", "min-w-max", "max-tab:[&>button]:min-w-[116.81px]", "max-tab:flex-[1_1_0px]"], "select cell");
  assert.ok(!tokens(RES_STATUS_SELECT_CLASS).includes("min-w-0") && !tokens(RES_STATUS_SELECT_CLASS).includes("max-tab:min-w-[116.81px]"), "no min-w-0 and no fixed floor on the cell: the cell's minimum is its label's max-content (the trigger carries the floor)");
  hasAll(RES_SEARCH_INPUT_CLASS, ["text-[16px]", "tab:text-[14px]"], "search input");
});

test("the page renders its frame from the constants, the header the HTML's, the toolbar and the states (P3, P4)", () => {
  const page = read(PAGE);
  assert.match(page, /<div data-ui="reservations-page" className=\{RESERVATIONS_PAGE_CLASS\}>/, "the page frame");
  assert.ok(!page.includes("MenuPageShell"), "the page left MenuPageShell (B2)");
  assert.match(page, /<div data-ui="reservations-body" className=\{RES_BODY_CLASS\}>/, "the body grid");
  assert.match(page, /<div data-ui="reservations-list" className=\{RES_LIST_COLUMN_CLASS\}>/, "the list column");
  assert.match(page, /<div data-ui="reservations-scroller" className=\{RES_SCROLLER_CLASS\}>/, "the scroller");
  assert.match(page, /eyebrow="Service"\s+title="Reservations"/, "P3: the eyebrow and the title");
  assert.match(page, /description=\{state\.header\}/, "the second line is the page's header line, undefined until the list answers (B9)");
  assert.match(page, /phoneTitleMinPx=\{RES_PHONE_TITLE_MIN_PX\}/, "the phone floor is the title's width (B9)");
  assert.match(page, /<ReservationsToolbar\b/, "the toolbar");
  assert.ok(!/<DatePicker\b/.test(page) && !page.includes("components/shared/DatePicker"), "the day box is the kit Popover + Calendar, not DatePicker (owner Q7, as /orders)");
  assert.ok(!/type="date"/.test(page), "never a native date input (P20)");
  assert.match(page, /reservations\.isError && reservations\.data === undefined/, "P4: the first-load error needle");
  assert.match(page, /<ErrorState/, "P4: ErrorState");
  assert.match(page, /You appear to be offline\. Reservations will load when the connection is back\./, "P5: the offline words");
  assert.ok(page.split(/\r?\n/).length <= 300, "page.tsx stays within 300 lines (ruling U2)");
});

test("the day box is the kit Popover with an All dates row above the kit Calendar, never DatePicker or a native input", () => {
  const box = read("components/reservations/ReservationsDayBox.tsx");
  assert.match(box, /from "@\/components\/ui\/popover";/, "the kit Popover");
  assert.match(box, /from "@\/components\/ui\/calendar";/, "the kit Calendar");
  assert.match(box, /<Calendar\b[\s\S]*?mode="single"[\s\S]*?defaultMonth=\{chosen\}[\s\S]*?\/>/, "one day at a time, opening on the chosen day's month");
  assert.match(box, /All dates/, "the All dates row (owner Q7)");
  assert.match(box, /title="Previous day"/, "the HTML's titles: Previous day");
  assert.match(box, /title="Next day"/, "Next day");
  assert.ok(!/type="date"/.test(box) && !box.includes("components/shared/DatePicker"), "no native input, no DatePicker");
});

test("the toolbar: the status select is MenuSelect with aria 'Filter by status'; the search says what it finds; the phone toggle is 'Search'", () => {
  const bar = read("components/reservations/ReservationsToolbar.tsx");
  assert.match(bar, /<MenuSelect\b[\s\S]*?ariaLabel="Filter by status"/, "B21: the select keeps its aria name");
  assert.match(bar, /placeholder="Search name, phone or table"/, "the HTML's placeholder");
  assert.match(bar, /title="Clear search"/, "the clear button");
  assert.match(bar, /title="Search"/, "the phone toggle");
  assert.ok(!/<select\b/.test(bar), "never a native select (P20)");
});

// ── U6 Task 2 (2026-11-03): the list (values 8.2 - 8.4; design 6.3, B7, B10, B13, B15 - B17, B26) ─────────────────────────

test("the table / card switch is the list column's own width (904px, B1) and the table grid is the HTML's cols2", () => {
  hasAll(layout.RES_TABLE_WRAP_CLASS, ["hidden", "@[904px]/reslist:block"], "the table section shows from a 904px column");
  hasAll(layout.RES_CARDS_WRAP_CLASS, ["@[904px]/reslist:hidden"], "the cards give way from a 904px column");
  const grid = "grid-cols-[104px_minmax(200px,2fr)_60px_100px_120px_minmax(150px,auto)]";
  hasAll(layout.RES_ROW_TABLE_CLASS, [grid, "grid", "gap-4", "px-4", "py-3", "items-center", "relative", "cursor-pointer"], "a table row (values 8.2)");
  hasAll(layout.RES_TABLE_HEAD_CLASS, [grid, "sticky", "top-[-20px]", "z-[1]", "px-4", "py-2.5", "bg-surface-2", "text-[12.5px]", "font-medium", "text-muted-foreground", "border-b"], "the head (values 8.2, U5 M8)");
  hasAll(layout.RES_ROW_TABLE_CLASS, ["pointer-fine:hover:bg-hover"], "the table row's hover only where a pointer hovers (R14)");
  assert.ok(!tokens(layout.RES_ROW_CARD_CLASS).some((t) => t.includes("hover:")), "a card has no hover rule (values 8.3)");
});

test("the card row, its time column, middle and right column carry values 8.3", () => {
  hasAll(layout.RES_ROW_CARD_CLASS, ["relative", "flex", "items-center", "gap-3", "px-3.5", "py-3", "cursor-pointer"], "the card row");
  hasAll(layout.RES_CARD_TIME_CLASS, ["w-14", "flex-none"], "the time column is 56px");
  hasAll(layout.RES_CARD_HM_CLASS, ["font-mono", "text-[15px]", "font-semibold"], "Geist Mono 15 / 600");
  hasAll(layout.RES_CARD_AP_CLASS, ["text-[10.5px]", "font-semibold", "text-subtle-foreground"], "AM / PM 10.5 / 600");
  hasAll(layout.RES_CARD_NAME_CLASS, ["text-[14.5px]", "font-semibold", "[overflow-wrap:anywhere]"], "name 14.5 / 600, wraps (Q5, B10)");
  hasAll(layout.RES_CARD_SUB_CLASS, ["text-[12.5px]", "[overflow-wrap:anywhere]"], "sub 12.5, wraps (B10)");
  hasAll(layout.RES_CARD_RIGHT_CLASS, ["flex", "flex-col", "items-end", "gap-1.5", "flex-none"], "the right column");
  hasAll(layout.RES_TABLE_NAME_CLASS, ["text-[14px]", "font-semibold", "[overflow-wrap:anywhere]"], "table name 14 / 600, wraps (Q5)");
  hasAll(layout.RES_TABLE_SUB_CLASS, ["truncate", "text-[12.5px]", "text-subtle-foreground"], "the table sub-line keeps one line with an ellipsis (B10)");
});

test("the stretched open button covers the row (B7); the actions sit above it", () => {
  hasAll(layout.RES_OPEN_CLASS, ["after:absolute", "after:inset-0", "cursor-pointer", "text-left"], "the row's real button");
  for (const [name, cls] of [["primary", layout.RES_PRIMARY_CLASS], ["icon", layout.RES_ICON_CLASS], ["assign", layout.RES_ASSIGN_CLASS]] as const) {
    assert.ok(tokens(cls).includes("relative") && tokens(cls).includes("z-[1]"), `the ${name} button sits above the stretched layer`);
  }
});

test("the primary: 32px, ink Seat, accent-tint Open order (bg-card on a selected row, B16), surface-3 Book again; hover opacity only on the table", () => {
  hasAll(layout.RES_PRIMARY_CLASS, ["h-8", "px-3", "rounded-[8px]", "font-semibold", "whitespace-nowrap"], "the primary's box");
  hasAll(layout.RES_PRIMARY_CARD_CLASS, ["text-[12.5px]"], "card text 12.5");
  hasAll(layout.RES_PRIMARY_TABLE_CLASS, ["text-[13px]", "ml-1.5", "pointer-fine:hover:opacity-[.88]"], "table text 13, 6px from the icons, hover .88");
  assert.ok(!tokens(layout.RES_PRIMARY_CARD_CLASS).some((t) => t.includes("hover:")), "no card hover");
  hasAll(layout.primaryTone("seat", false), ["bg-ink", "text-on-ink"], "Seat is ink");
  hasAll(layout.primaryTone("openOrder", false), ["bg-status-info-tint", "text-status-info-ink"], "Open order is the accent tint");
  hasAll(layout.primaryTone("openOrder", true), ["bg-card", "text-status-info-ink"], "on a selected row Open order takes bg-card (B16)");
  hasAll(layout.primaryTone("bookAgain", false), ["bg-surface-3", "text-foreground"], "Book again is surface-3");
  hasAll(layout.RES_ROW_SELECTED_CLASS, ["bg-status-info-tint"], "the selected tint");
});

test("the icon buttons: 32px, hover surface-3 only on hover devices; Assign is the dashed 28px button", () => {
  hasAll(layout.RES_ICON_CLASS, ["size-8", "rounded-[8px]", "pointer-fine:hover:bg-surface-3", "flex-none"], "the icon button");
  hasAll(layout.RES_ASSIGN_CLASS, ["h-7", "px-[9px]", "border-dashed", "border-subtle-foreground", "rounded-[7px]", "text-[12.5px]", "font-semibold"], "Assign (values 8.2)");
});

test("the dimmed rows (Completed / Cancelled) use tokens, never opacity (B16)", () => {
  hasAll(layout.RES_DIM_NAME_CLASS, ["text-muted-foreground"], "name --text-2");
  hasAll(layout.RES_DIM_SUB_CLASS, ["text-subtle-foreground"], "sub --text-3");
  for (const c of [layout.RES_DIM_NAME_CLASS, layout.RES_DIM_SUB_CLASS, layout.RES_ROW_CARD_CLASS, layout.RES_ROW_TABLE_CLASS]) {
    assert.ok(!tokens(c).some((t) => /^opacity-/.test(t)), "no opacity on a dimmed row");
  }
});

test("the pill's three sizes: 22 / 24 / 26px (values 8.3, 8.2, 10.3)", () => {
  hasAll(layout.RES_PILL_SIZE_CLASS.card, ["h-[22px]", "gap-[5px]", "px-2", "text-[11.5px]"], "card");
  hasAll(layout.RES_PILL_SIZE_CLASS.table, ["h-6", "gap-1.5", "px-[9px]", "text-[12px]"], "table");
  hasAll(layout.RES_PILL_SIZE_CLASS.detail, ["h-[26px]", "gap-1.5", "px-2.5", "text-[12px]"], "detail");
});

test("the neutral pill (Completed / Cancelled) is the HTML's surface-3, not the kit's muted tint", () => {
  hasAll(layout.RES_PILL_NEUTRAL_CLASS, ["bg-surface-3", "text-muted-foreground"], "values 8.4: rgb(233,233,236) on --text-2");
  const pill = read("components/reservations/ReservationPill.tsx");
  assert.match(pill, /RES_PILL_NEUTRAL_CLASS/, "the pill uses it for the neutral kind");
});

test("the rows never import the mutation hooks, never mutate, and use tokens only (P17)", () => {
  for (const f of ["ReservationRowCard", "ReservationsTable", "ReservationsList", "ReservationPill", "ReservationRowParts"]) {
    const s = read(`components/reservations/${f}.tsx`);
    assert.ok(!/from\s*"@\/hooks\/use-(?:events|reservations|reservation-writes)"/.test(s), `${f}: no mutation hooks`);
    assert.ok(!/\.mutate(?:Async)?\(/.test(s), `${f}: no mutation call`);
    assert.ok(!/\b(?:text|bg|border)-(?:green|blue|red|gray|slate|zinc|amber)-\d/.test(s), `${f}: no raw palette classes`);
    assert.ok(s.split("\n").length <= 300, `${f}: within 300 lines`);
  }
});

test("Open order hands the table over on a plain click, then the warm /pos link; no write from this page (B17)", () => {
  const s = read("components/reservations/ReservationRowParts.tsx");
  assert.match(s, /offerPosTable\(tableNo, Date\.now\(\)\)/, "the hand-off");
  assert.match(s, /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/, "plain primary click only (FloorTile's rule)");
  assert.match(s, /href=\{FLOOR_POS_PATH\}/, "the /pos link");
});

test("the page passes the list its intents and keeps Cancel behind the confirm", () => {
  const page = read(PAGE);
  assert.match(page, /<ReservationsList\b/, "the list");
  assert.match(page, /busy=\{busy\}/, "B13: the one busy flag");
  assert.match(page, /selectedId=\{choice\.selected\?\._id \?\? null\}/, "Task 3: the chosen booking's row wears the selected tint (search rows too)");
  assert.match(page, /showDay=\{/, "showDay for All dates and a search");
  assert.ok(page.split(/\r?\n/).length <= 300, "page.tsx stays within 300 lines (ruling U2)");
});

test("review fix: the phone's search box shows while a query exists, and the clear x for any typed text (values 0.3 qD, 9.2)", () => {
  const bar = read("components/reservations/ReservationsToolbar.tsx");
  assert.match(bar, /const filled = query !== "";/, "a raw non-empty query counts, whitespace included");
  assert.match(bar, /const boxShown = searchOpen \|\| filled;/, "the box is shown when the toggle is open or a query exists (qD = !ph || open || q)");
  assert.match(bar, /!boxShown && "max-tab:hidden"/, "the box hides below 720 only when neither holds");
  assert.match(bar, /\{filled && \(/, "the clear x is drawn for any non-empty text");
  assert.match(bar, /if \(boxShown\) onQuery\(""\);/, "the toggle closes and clears a box a query keeps open");
});
