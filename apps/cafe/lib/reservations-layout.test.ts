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

test("the phone's select floor is B3's 116.81px; the search input is 16px below 720 and 14px from it (B23)", () => {
  hasAll(RES_STATUS_SELECT_CLASS, ["flex-[0_0_190px]", "max-tab:min-w-[116.81px]", "max-tab:flex-[1_1_0px]"], "select cell");
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

// ── U6 Task 3: the booking detail, the selection and the seat / assign dialog (values 10, 14; design 7, 8.2) ─────────────

test("the detail's head, name, banner and steps: values 10.3", () => {
  hasAll(layout.RES_DETAIL_HEAD_CLASS, ["px-[18px]", "pt-4", "pb-3.5", "gap-3", "border-b", "border-border-2", "flex-none"], "head 16 18 14, 12 apart, a --border-2 rule");
  hasAll(layout.RES_DETAIL_NAME_CLASS, ["text-[18px]", "font-semibold", "tracking-[-0.01em]", "[overflow-wrap:anywhere]"], "name 18 / 600 -.01em, wraps (Q5)");
  hasAll(layout.RES_DETAIL_SUB_CLASS, ["text-[13px]", "text-muted-foreground", "mt-0.5"], "sub 13 --text-2");
  hasAll(layout.RES_DETAIL_CLOSE_CLASS, ["size-[30px]", "rounded-[50%]", "bg-surface-3", "text-[11px]"], "the sheet's ✕: 30px round");
  hasAll(layout.RES_BANNER_CLASS, ["px-3.5", "py-3", "rounded-[12px]", "bg-surface-2", "border-border-2", "gap-3"], "banner 12 14, radius 12");
  hasAll(layout.RES_BANNER_TIME_CLASS, ["font-mono", "text-[26px]", "font-semibold", "tracking-[-0.78px]"], "banner time Geist Mono 26 / 600 -0.78px");
  hasAll(layout.RES_BANNER_TEXT_CLASS, ["text-[13px]", "font-semibold", "text-right", "flex-1"], "banner words 13 / 600 right");
  hasAll(layout.RES_STEPS_CLASS, ["grid", "grid-cols-3", "max-tab:hidden"], "three steps from 720px");
  hasAll(layout.RES_STEP_DOT_CLASS, ["size-3", "rounded-[50%]"], "dot 12px");
  hasAll(layout.RES_STEP_LINE_CLASS, ["h-0.5", "mx-[5px]", "flex-1"], "line 2px, 5px margins");
  hasAll(layout.RES_STEP_LABEL_CLASS, ["text-[11.5px]", "font-semibold"], "label 11.5 / 600");
  hasAll(layout.RES_STEP_TIME_CLASS, ["text-[10.5px]", "-mt-1"], "step time 10.5, up 4px");
});

test("the detail's facts, assign, note, action grid and footer: values 10.3", () => {
  hasAll(layout.RES_FACT_ROW_CLASS, ["py-[9px]", "text-[13.5px]", "border-b", "border-border-2", "gap-3.5", "justify-between"], "facts rows 9px 0, 13.5px (37px tall)");
  hasAll(layout.RES_FACT_VALUE_CLASS, ["font-medium", "text-right", "[overflow-wrap:anywhere]"], "the value 500, right, wraps");
  hasAll(layout.RES_DETAIL_ASSIGN_CLASS, ["h-[38px]", "border-dashed", "border-subtle-foreground", "rounded-[9px]", "text-[13px]", "font-semibold"], "+ Assign a table: dashed 38px");
  hasAll(layout.RES_NOTE_CLASS, ["bg-status-bill-tint", "rounded-[10px]", "text-[13.5px]", "leading-[1.45]", "px-[13px]", "py-[11px]"], "the note in the bill tint");
  hasAll(layout.RES_GRID_CLASS, ["grid", "grid-cols-[repeat(auto-fit,minmax(64px,1fr))]", "rounded-[12px]", "border-border", "overflow-clip"], "the action grid: auto-fit 64px, radius 12, clipped (109)");
  assert.ok(!tokens(layout.RES_GRID_CLASS).includes("overflow-hidden"), "overflow-clip, never hidden (WebView 109)");
  hasAll(layout.RES_GRID_BUTTON_CLASS, ["h-[60px]", "flex-col", "gap-[5px]", "text-[11.5px]", "font-semibold", "border-l", "first:border-l-0", "pointer-fine:hover:bg-hover"], "grid buttons 60px, hover only on hover devices");
  hasAll(layout.RES_EDIT_CLASS, ["h-[46px]", "rounded-[10px]", "text-[14px]", "font-semibold", "border-border"], "footer Edit 46px");
  hasAll(layout.RES_DETAIL_PRIMARY_CLASS, ["h-[46px]", "bg-primary", "text-primary-foreground", "text-[14.5px]", "font-semibold", "pointer-fine:hover:bg-primary-hover"], "footer primary 46px, always accent");
  hasAll(layout.RES_DETAIL_NONE_CLASS, ["items-center", "justify-center", "gap-1.5", "p-6", "text-[13.5px]", "text-muted-foreground"], "No booking selected: centred, 6px apart, 24px padding");
});

test("the footer splits Edit 1 : primary 2 (46px each) and the inset comes from U2's foot", () => {
  const detail = read("components/reservations/ReservationDetail.tsx");
  assert.match(detail, /className=\{RES_DETAIL_FOOT_CLASS\}/, "the foot (values 10.3)");
  hasAll(layout.RES_DETAIL_FOOT_CLASS, ["flex", "gap-2", "border-t", "px-[18px]", "pt-3", "pb-[calc(14px+env(safe-area-inset-bottom))]", "max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]"], "the foot: U2's inset rules (B8)");
  assert.ok(!tokens(layout.RES_DETAIL_FOOT_CLASS).includes("grid"), "a flex row: Edit flex 1, the primary flex 2");
  hasAll(layout.RES_EDIT_CLASS, ["flex-1", "px-1.5"], "Edit flex 1 with the UA padding");
  hasAll(layout.RES_DETAIL_PRIMARY_CLASS, ["flex-[2]", "px-1.5"], "the primary flex 2; with none Edit fills the row");
  assert.match(detail, /ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS/, "the body's bottom room is 18px: the foot carries the inset (B8)");
  assert.match(detail, /detailActions\(r\)/, "the grid and the primary come from detailActions");
  assert.match(detail, /canAssign = !r\.tableNo && \(r\.status === "Booked" \|\| r\.status === "Seated"\)/, "+ Assign a table: Booked or Seated without a table (B26)");
  assert.match(detail, /hideOnPhone/, "Guest history is hidden on a phone; Table and Phone stay (B19)");
  assert.match(detail, /gridActions\.length > 0/, "the grid is not drawn when empty");
});

test("the seat box: 560px, radius 14, the sheet frame; tiles 56px in an auto-fill 96px grid, no area heads (P22)", () => {
  hasAll(layout.RES_SEAT_PANEL_CLASS, ["max-w-[560px]", "rounded-[14px]", "max-tab:rounded-[14px_14px_0_0]", "overflow-clip", "border-border", "motion-safe:animate-html-sheet-in-cs"], "the box: U1's frame");
  assert.ok(!tokens(layout.RES_SEAT_PANEL_CLASS).includes("overflow-hidden"), "overflow-clip, never hidden (WebView 109)");
  assert.match(layout.RES_SEAT_PANEL_CLASS, /max-tab:max-h-\[88vh\]/, "88dvh below 720px (the shared cap)");
  hasAll(layout.RES_SEAT_SCRIM_CLASS, ["z-[47]", "max-tab:items-end", "max-tab:p-0"], "z 47; along the foot with no padding on a phone");
  hasAll(layout.RES_SEAT_HEAD_CLASS, ["px-4", "pt-4", "pb-3", "gap-2.5"], "head 16 16 12");
  hasAll(layout.RES_SEAT_TITLE_CLASS, ["text-[17px]", "font-semibold", "[overflow-wrap:anywhere]"], "title 17 / 600, wraps (B10)");
  hasAll(layout.RES_SEAT_CLOSE_CLASS, ["size-8", "rounded-[50%]", "bg-surface-3"], "✕ 32px round");
  hasAll(layout.RES_SEAT_GRID_CLASS, ["grid-cols-[repeat(auto-fill,minmax(96px,1fr))]", "gap-1.5"], "the tile grid");
  hasAll(layout.RES_SEAT_TILE_CLASS, ["min-h-14", "rounded-[10px]", "px-2.5", "flex-col", "items-start", "gap-0.5", "disabled:opacity-[.45]"], "tile 56px (grows), off at .45");
  hasAll(layout.RES_SEAT_TILE_FITS_CLASS, ["border-status-ok"], "the ok border when it fits");
  hasAll(layout.RES_SEAT_NOTABLE_CLASS, ["h-11"], "Seat without a table: 44px (B24)");
  assert.equal(layout.RES_SEAT_SUB_INK_CLASS.info, "text-status-warn-ink", "Occupied reads in warn ink (values 14)");
});

test("the seat dialog: no areas, the shared close, the sheet frame, one skeleton while tables load, the focus hook (P22, B18, B27)", () => {
  const s = read("components/reservations/ReservationSeatDialog.tsx");
  assert.ok(!/useAreas|useTableAreas|areaId|Area/.test(s), "areas stay off this screen (P22)");
  assert.match(s, /useOpenerFocus\(\)/, "B27");
  assert.match(s, /tables === undefined/, "a skeleton while the tables load");
  assert.match(s, /mode === "seat" && \(/, "Seat without a table: seat mode only");
  assert.ok(!/\.mutate(?:Async)?\(/.test(s), "the dialog raises picks; the page writes");
  assert.ok(s.split("\n").length <= 300, "within 300 lines");
});

test("the frame: one frame for the width, frameInUse while a dialog opened from the detail is up, P38 and the opener focus (B5, B6)", () => {
  const s = read("components/reservations/ReservationDetailFrame.tsx");
  assert.match(s, /orderDetailFrame\("page", useMediaQuery\(ORDERS_XL_QUERY\)\)/, "the column from 1280px, the sheet below");
  assert.match(s, /frameInUse\(heldFrame, forWidth, open && nestedOpen\)/, "the frame holds while a nested layer is up");
  assert.match(s, /keepOpenForNestedDialog\(e, sheetRef\.current\)/, "ruling P38");
  assert.match(s, /\{\.\.\.openerFocus\}/, "focus back to the opener");
  assert.match(s, /No booking selected/, "values 10.2");
  assert.match(s, /Pick a booking from the list to see details and seat the guest\./, "values 10.2");
  assert.match(s, /waiting \? null/, "nothing while the list has not answered");
});

test("the page: one status write instance, the choice settled in the hook, Seat with a table at once, Assign today only (B13, B5, values 19.5)", () => {
  const page = read(PAGE);
  assert.equal(page.match(/useReservationUpdate\(\)/g)?.length, 1, "ONE status useReservationUpdate instance (B13)");
  assert.match(page, /useReservationSeating\(updateReservation\)/, "the dialog's writes run on that instance");
  assert.match(page, /if \(r\.tableNo\) setStatus\(r, "Seated"\);\s*else seating\.open\(r, "seat"\);/, "Seat: a table → { status: Seated } at once; none → the dialog");
  assert.match(page, /r\.date === state\.today \? seating\.open\(r, "assign"\) : openEdit\(r\)/, "Assign: today → the dialog, another day → the form");
  assert.match(page, /onOpen=\{\(r\) => choice\.choose\(r\._id\)\}/, "a row press opens the detail (Ruling U3's Edit is gone)");
  assert.match(page, /onEdit=\{openEdit\}/, "the footer's Edit opens the form");
  assert.ok(!/Delete/.test(read("components/reservations/ReservationDetail.tsx")), "Delete has no entry in the detail (Ruling U7)");
  const hook = read("hooks/use-reservation-choice.ts");
  assert.match(hook, /settleResChoice\(held, key, xl, answered \? rows\[0\]\?\._id : undefined\)/, "settled during render, no first row until the list answers");
  assert.match(hook, /if \(choice !== held\) setHeld\(choice\)/, "stored only on a change");
  assert.match(hook, /resChoiceKey\(filterEdits, query\)/, "the typed query, never a debounced one");
  const seating = read("hooks/use-reservation-seating.ts");
  assert.match(seating, /\{ status: "Seated", tableNo \}/, "a pick in seat mode");
  assert.match(seating, /\{ tableNo \}/, "a pick in assign mode");
  assert.match(seating, /setTarget\(null\);\s*\} catch/, "closes on success; stays open on a failure");
  assert.ok(!/useAreas|areaId/.test(seating + hook), "no areas");
});
