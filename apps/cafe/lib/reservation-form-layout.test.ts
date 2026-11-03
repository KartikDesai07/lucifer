// U6 Task 4 (2026-11-03): the reservation form's look and wiring (docs/superpowers/specs/2026-11-02-reservations-html-values.md 13;
// design 8.1, B4, B20, B23, B28). Pins on lib/reservation-form-layout.ts, then source pins on the form's files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import * as layout from "./reservation-form-layout";
import { MENU_EDITOR_BODY_CLASS, MENU_EDITOR_HEAD_CLASS, MENU_EDITOR_SHEET_CLASS, MENU_EDITOR_XL_QUERY } from "./menu-editor-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

test("the frame: the HTML's 480px aside from 1280px, U2's bottom sheet below, the head 16 18 14, the body a gap-5 grid", () => {
  hasAll(layout.RES_FORM_SIDE_CLASS, ["fixed", "inset-y-0", "right-0", "z-[46]", "w-[480px]", "flex-col", "border-l", "bg-card"], "aside");
  assert.equal(MENU_EDITOR_XL_QUERY, "(min-width: 1280px)", "the aside shows from 1280px");
  assert.ok(MENU_EDITOR_SHEET_CLASS.length > 0, "the bottom sheet is U2's frame");
  hasAll(MENU_EDITOR_HEAD_CLASS, ["gap-3", "px-[18px]", "pt-4", "pb-3.5"], "head 16 18 14");
  hasAll(MENU_EDITOR_BODY_CLASS, ["grid", "gap-5", "overflow-y-auto", "px-[18px]", "pt-4", "pb-[22px]"], "body");
});

test("the footer: 12 18 + the inset, the summary 13px over Save 48px 15px 600", () => {
  hasAll(layout.RES_FORM_FOOT_CLASS, ["flex-col", "gap-2.5", "border-t", "px-[18px]", "pt-3", "pb-[calc(14px+env(safe-area-inset-bottom))]", "max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]"], "footer");
  hasAll(layout.RES_FORM_SUMMARY_CLASS, ["gap-2", "text-[13px]"], "summary");
  hasAll(layout.RES_FORM_SUMMARY_TEXT_CLASS, ["truncate", "font-medium"], "summary text");
  hasAll(layout.RES_FORM_SAVE_CLASS, ["h-12", "rounded-[10px]", "bg-primary", "text-[15px]", "font-semibold"], "save");
});

test("the phone box 44px with the +91 cell, the inputs 15px (16px below 720), the stepper and the quick chips 44px", () => {
  hasAll(layout.RES_FORM_PHONE_BOX_CLASS, ["h-11", "rounded-[10px]", "overflow-clip"], "phone box");
  hasAll(layout.RES_FORM_PREFIX_CLASS, ["border-r", "bg-surface-2", "pl-3", "pr-2.5", "text-[14px]"], "+91 cell");
  hasAll(layout.RES_FORM_PHONE_INPUT_CLASS, ["text-[15px]", "tracking-[.02em]", "max-tab:text-base"], "phone input");
  hasAll(layout.RES_FORM_INPUT_CLASS, ["h-11", "text-[15px]", "max-tab:text-base", "aria-[invalid=true]:border-status-bad"], "name input");
  hasAll(layout.RES_FORM_STEPPER_CLASS, ["h-11", "rounded-[10px]"], "stepper");
  hasAll(layout.RES_FORM_STEP_CLASS, ["w-11", "text-[20px]"], "stepper button");
  hasAll(layout.RES_FORM_COUNT_CLASS, ["w-12", "text-[17px]", "font-semibold"], "count");
  hasAll(layout.RES_FORM_QUICK_CLASS, ["size-11", "rounded-[10px]", "text-[14px]", "font-semibold"], "quick chip");
});

test("the day chips 58 x 53 in a sideways scroller with More outside it (B4)", () => {
  hasAll(layout.RES_FORM_DAY_STRIP_CLASS, ["overflow-x-auto", "flex-1", "min-w-0", "[scrollbar-width:none]"], "strip");
  hasAll(layout.RES_FORM_DAY_CLASS, ["w-[58px]", "flex-none", "flex-col", "py-[7px]", "gap-px"], "day chip");
  hasAll(layout.RES_FORM_DAY_NUM_CLASS, ["text-[17px]", "font-semibold"], "day number");
  hasAll(layout.RES_FORM_MORE_CLASS, ["w-[58px]", "flex-none", "border-dashed", "min-h-[53px]"], "More");
  const days = read("components/reservations/ReservationDayTimeFields.tsx");
  assert.match(days, /<\/div>\s*<DatePicker/, "the DatePicker (More) is a sibling after the strip, never inside it");
});

test("the slot grid repeat(auto-fill,minmax(74px,1fr)) 46px; the table chips 52px in repeat(auto-fill,minmax(92px,1fr)); the note min 64px", () => {
  hasAll(layout.RES_FORM_SLOTS_CLASS, ["grid-cols-[repeat(auto-fill,minmax(74px,1fr))]", "gap-1.5"], "slot grid");
  hasAll(layout.RES_FORM_SLOT_CLASS, ["h-[46px]", "rounded-[9px]", "text-[13px]", "font-semibold", "gap-1"], "slot");
  hasAll(layout.RES_FORM_SLOT_OFF_CLASS, ["line-through", "opacity-50", "cursor-not-allowed"], "a passed slot");
  hasAll(layout.RES_FORM_DOT_CLASS, ["size-[5px]", "rounded-[50%]"], "load dot");
  hasAll(layout.RES_FORM_OTHER_CLASS, ["h-[46px]", "rounded-[9px]"], "Other time chip");
  hasAll(layout.RES_FORM_TABLES_CLASS, ["grid-cols-[repeat(auto-fill,minmax(92px,1fr))]", "gap-1.5"], "table grid");
  hasAll(layout.RES_FORM_TABLE_CLASS, ["min-h-[52px]", "rounded-[10px]", "px-2.5", "min-w-0"], "table chip");
  hasAll(layout.RES_FORM_TABLE_LABEL_CLASS, ["text-[13.5px]", "font-semibold", "[overflow-wrap:anywhere]"], "chip label (long names wrap; the chip is items-start, so 109 needs no w-full)");
  hasAll(layout.RES_FORM_MESSAGE_CLASS, ["rounded-[9px]", "px-[11px]", "py-[9px]", "text-[12.5px]", "leading-[1.45]"], "message box");
  hasAll(layout.RES_FORM_NOTE_CLASS, ["min-h-16", "rounded-[10px]", "text-[14px]", "max-tab:text-base"], "note");
});

test("tokens only, and nothing 109 lacks (no raw palette, no light-dark, no color-mix)", () => {
  const all = Object.values(layout).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))).join(" ");
  assert.ok(!/\b(?:text|bg|border)-(?:red|green|blue|amber|orange|zinc|slate|gray|emerald)-\d/.test(all), "no raw palette classes");
  assert.ok(!/light-dark|color-mix|in oklab|mask-image/.test(all), "WebView 109 CSS only");
});

test("the form: its own write instances, no request of its own, no areas, no native pickers, the page's list and floor plan by props (P20 / P21 / P22)", () => {
  const sheet = read("components/reservations/ReservationFormSheet.tsx");
  assert.match(sheet, /useReservationCreate\(\)/, "its own create instance");
  assert.match(sheet, /useReservationUpdate\(\)/, "its own edit instance (the page's status instance stays the busy flag)");
  assert.ok(!/useTables\(|useReservations\(|useAreas|useTableAreas|areaId/.test(sheet), "no read of its own, no areas (P22)");
  assert.match(sheet, /tableNo/, "landmark: the table is the form's");
  assert.match(sheet, /mutateAsync\(\{ id: reservation\._id, data: editPayload\(v, reservation\), toast: updatedToast \}\)/, "edit: editPayload (Q6) and the updated toast");
  assert.match(sheet, /createReservation\.mutateAsync\(createPayload\(v\)\)/, "create: createPayload");
  assert.match(sheet, /onCreated\(saved\.date\)/, "after a create the page shows that day (B20)");
  assert.match(sheet, /Fix the highlighted fields to continue/, "the failed-Save words");
  assert.match(sheet, /autoFocus/, "the Mobile number takes the focus");
  assert.match(sheet, /Delete reservation/, "Delete lives in the form (ruling U7)");
  assert.match(sheet, /onDelete\(reservation\)/, "...and raises the page's confirm");
  assert.ok(!/<select|type="date"|type="time"/.test(read("components/reservations/ReservationDayTimeFields.tsx") + sheet), "no native pickers");
  const frame = read("components/reservations/ReservationFormFrame.tsx");
  assert.match(frame, /keepOpenForNestedDialog\(e, panelRef\.current\)/, "a press in the delete confirm never closes the form");
});

test("the page: the form gets the page's list, floor plan and clock; a delete closes both; the create reveals its day", () => {
  const page = read("app/(dashboard)/reservations/page.tsx");
  assert.match(page, /list=\{state\.list\}\s+tables=\{state\.tables\}/, "the list and the floor plan come from the page's one read");
  assert.match(page, /onCreated=\{state\.reveal\}/, "a create reveals its day on Upcoming, search cleared");
  assert.match(page, /onDelete=\{setDeleting\}/, "Delete opens today's confirm over the form");
  assert.match(page, /setDeleting\(null\);\s*setFormOpen\(false\);/, "on success both close");
  assert.match(page, /prefill=\{prefill \?\? undefined\}/, "Book again's prefill stays state");
  const hook = read("hooks/use-reservations-page.ts");
  assert.match(hook, /setTabState\("upcoming"\);\s*setQueryState\(""\);/, "reveal: Upcoming and the search cleared");
});

test("TimePicker's label prop shows instead of the clock and the time (/events keeps its look)", () => {
  const picker = read("components/shared/TimePicker.tsx");
  assert.match(picker, /label\?: React\.ReactNode;/, "the optional label");
  assert.match(picker, /\{custom \?\? \(/, "a given label replaces the clock and the time");
});
