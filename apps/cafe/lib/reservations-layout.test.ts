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
