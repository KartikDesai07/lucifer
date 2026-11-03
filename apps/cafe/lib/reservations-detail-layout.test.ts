// U6 Task 3 (2026-11-03; split out of reservations-layout.test.ts by the final fix wave, M1: files <= 300 lines): the booking
// detail, the seat / assign dialog, the frame and the page's wiring (values 10, 14, 19.5; design 7, 8.2, B5, B6, B13, B18, B27).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import * as layout from "./reservations-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const PAGE = "app/(dashboard)/reservations/page.tsx";

function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

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
  assert.match(page, /useReservationSeating\(updateReservation, state\.list, reservations\.data !== undefined\)/, "the dialog's writes run on that instance");
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


test("final fix wave: the seating hook closes on a gone booking and sends nothing (M9); the page hands it the live list (M9)", () => {
  const seating = read("hooks/use-reservation-seating.ts");
  assert.match(seating, /liveSeatBooking\(list, target\.r\._id\) === null/, "the dialog's booking is looked up in the live list");
  assert.match(seating, /if \(gone\) setTarget\(null\)/, "a gone booking closes the dialog");
  assert.match(seating, /if \(gone\) return;/, "a pick sends no write for a gone booking");
  assert.match(seating, /target && !gone/, "Seat without a table sends no write for a gone booking");
});

test("final fix wave: the Other time chip's aria-label reads the picked time (M5); the table chips use the form's rule (I1)", () => {
  const dt = read("components/reservations/ReservationDayTimeFields.tsx");
  assert.match(dt, /aria-label=\{otherPicked \? `Other time: \$\{clockOf\(time\)\.full\}` : "Other time"\}/, "Other time: 7:15 PM when picked");
  const field = read("components/reservations/ReservationTableField.tsx");
  assert.match(field, /formChip\(t, values, list, editingId, today, nowMs\)/, "the chip tile is the form's, not the seat dialog's");
  assert.ok(!/seatTile/.test(field), "no seatTile in the form's table field");
});
