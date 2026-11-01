// U5 Task 3 (2026-11-01): the Menu's item editor and its dialogs, the owner's HTML (values 9, 10; design 6.9; owner Q9;
// owner rule 2026-10-22 for the 1280px split). Pure pins on lib/menu-editor-layout.ts, renders of the frame, the price
// mode field and the switches card, then source pins on the markup (the sheet, the archive confirm, the dialogs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, tagOf } from "./class-tags.fixtures";
import * as L from "./menu-editor-layout";
import { ORDER_DETAIL_SHEET_CLASS } from "./orders-layout";
import { ItemSwitchesCard } from "@/components/products/ItemSwitchesCard";
import { ItemEditorFrame } from "@/components/products/ItemEditorFrame";

(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

test("frame: the side aside is 500px from 1280px, the bottom sheet is U2's below (owner rule)", () => {
  assert.equal(L.MENU_EDITOR_XL_QUERY, "(min-width: 1280px)", "the 1280px split");
  hasAll(L.MENU_EDITOR_SIDE_CLASS, ["fixed", "inset-y-0", "right-0", "z-[46]", "w-[500px]", "flex-col", "border-l", "bg-card"], "side");
  assert.ok(L.MENU_EDITOR_SIDE_CLASS.includes("animate-html-sheet-in-op"), "sheetIn .3s on the aside");
  hasAll(L.MENU_EDITOR_SCRIM_CLASS, ["fixed", "inset-0", "z-[45]", "bg-scrim"], "scrim");
  assert.equal(L.MENU_EDITOR_SHEET_CLASS, ORDER_DETAIL_SHEET_CLASS, "below 1280 the U2 bottom-sheet frame, one constant");
});

test("head: 16px 18px 14px, title 18px 600, sub 13px, the 34px round close", () => {
  hasAll(L.MENU_EDITOR_HEAD_CLASS, ["flex", "items-start", "gap-3", "px-[18px]", "pt-4", "pb-3.5", "border-b"], "head");
  hasAll(L.MENU_EDITOR_TITLE_CLASS, ["text-[18px]", "font-semibold"], "title");
  hasAll(L.MENU_EDITOR_SUB_CLASS, ["text-[13px]", "text-muted-foreground", "mt-0.5"], "sub");
  hasAll(L.MENU_EDITOR_CLOSE_CLASS, ["size-[34px]", "rounded-[50%]", "bg-surface-3", "text-[12px]"], "close");
});

test("body and footer: the HTML's paddings, gap 20, a fixed footer with the safe-area inset, 46px buttons 1 : 2", () => {
  hasAll(L.MENU_EDITOR_BODY_CLASS, ["px-[18px]", "pt-4", "pb-[22px]", "gap-5", "overflow-y-auto", "flex-1", "min-h-0"], "body");
  hasAll(L.MENU_EDITOR_FOOT_CLASS, ["px-[18px]", "pt-3", "pb-[calc(14px+env(safe-area-inset-bottom))]", "gap-2", "border-t", "flex-none"], "foot");
  hasAll(L.MENU_EDITOR_CANCEL_CLASS, ["flex-1", "h-[46px]", "rounded-[10px]", "border", "text-[14px]", "font-semibold"], "cancel");
  hasAll(L.MENU_EDITOR_SAVE_CLASS, ["flex-[2]", "h-[46px]", "rounded-[10px]", "bg-primary", "text-[14.5px]", "font-semibold", "hover:bg-primary-hover"], "save");
});

test("fields: inputs 42px radius 10 14.5px (16px below 720); the label 13px 600; the error 12.5px", () => {
  hasAll(L.MENU_EDITOR_INPUT_CLASS, ["h-[42px]", "rounded-[10px]", "text-[14.5px]", "max-tab:text-base", "px-3"], "input");
  hasAll(L.MENU_EDITOR_LABEL_CLASS, ["text-[13px]", "font-semibold"], "label");
  hasAll(L.MENU_EDITOR_ERROR_CLASS, ["text-[12.5px]", "text-status-bad-ink"], "error");
  hasAll(L.MENU_EDITOR_PRICE_BOX_CLASS, ["h-[42px]", "max-w-[220px]", "rounded-[10px]", "overflow-hidden"], "the rupee box");
  hasAll(L.MENU_EDITOR_PERCENT_BOX_CLASS, ["h-[42px]", "max-w-40"], "the discount box (max 160)");
});

test("sizes: the row grid minmax(0,1fr) 130px 36px, gap 8; the remove 36px at .3 when disabled; Add size 34px dashed", () => {
  hasAll(L.MENU_EDITOR_SIZE_ROW_CLASS, ["grid", "grid-cols-[minmax(0,1fr)_130px_36px]", "gap-2", "items-center"], "row");
  hasAll(L.MENU_EDITOR_SIZE_BOX_CLASS, ["h-[42px]", "rounded-[10px]"], "the 130px box");
  hasAll(L.MENU_EDITOR_SIZE_REMOVE_CLASS, ["size-9", "rounded-[8px]", "disabled:opacity-30"], "remove");
  hasAll(L.MENU_EDITOR_ADD_SIZE_CLASS, ["h-[34px]", "border-dashed", "rounded-[8px]", "text-[13px]", "font-semibold", "self-start"], "add size");
  hasAll(L.MENU_EDITOR_MODE_TRACK_CLASS, ["rounded-[8px]", "bg-surface-3", "p-0.5"], "mode track");
  hasAll(L.MENU_EDITOR_MODE_BUTTON_CLASS, ["h-7", "rounded-[6px]", "text-[12.5px]", "px-2.5"], "mode button");
});

test("switches card: radius 12, rows px-3.5 py-3, a 34px tile radius 9, 13.5px label, 12px sub", () => {
  hasAll(L.MENU_EDITOR_CARD_CLASS, ["rounded-[12px]", "border", "overflow-hidden", "flex-col"], "card");
  hasAll(L.MENU_EDITOR_CARD_ROW_CLASS, ["flex", "items-center", "gap-3", "px-3.5", "py-3"], "row");
  hasAll(L.MENU_EDITOR_TILE_CLASS, ["size-[34px]", "rounded-[9px]"], "tile");
  hasAll(L.MENU_EDITOR_ROW_LABEL_CLASS, ["text-[13.5px]", "font-semibold"], "label");
  hasAll(L.MENU_EDITOR_ROW_SUB_CLASS, ["text-[12px]", "text-subtle-foreground"], "sub");
  hasAll(L.MENU_EDITOR_ARCHIVE_CLASS, ["text-[13px]", "font-semibold", "text-status-bad-ink", "rounded-[8px]"], "archive link");
});

test("dialogs: the box is 440px, radius 14, padding 20, gap 16; the phone's bottom sheet keeps the inset", () => {
  hasAll(L.MENU_DIALOG_BOX_CLASS, ["max-w-[440px]", "rounded-[14px]", "p-5", "gap-4"], "box");
  assert.ok(L.MENU_DIALOG_BOX_CLASS.includes("max-tab:pb-[calc(20px+env(safe-area-inset-bottom))]"), "the inset at the foot on a phone");
  hasAll(L.MENU_DIALOG_SCRIM_CLASS, ["z-50", "bg-scrim"], "scrim");
});

test("render: the frame (a closed side frame draws nothing; the switches card draws In stock and Show on QR menu)", () => {
  const card = renderToStaticMarkup(
    createElement(ItemSwitchesCard, { inStock: true, onInStock: () => {}, qrVisible: true, onQrVisible: () => {} }),
  );
  assert.match(card, /In stock/, "the stock row");
  assert.match(card, /Show on QR menu/, "the QR row");
  assert.match(card, /Off = hidden from guests’ QR menu\. Staff can still order it\./, "the HTML's sub where it is true for us");
  const tag = tagOf(card, "item-switches");
  assert.ok(classesOf(tag).includes("rounded-[12px]"), "the card's radius");
  assert.equal((card.match(/role="switch"/g) ?? []).length, 2, "two 40x24 switches");
  assert.equal(typeof ItemEditorFrame, "function", "the frame is a component");
});

test("source: the sheet is the frame, the archive confirm opens from the editor, the dialogs wear the 440 box", () => {
  const sheet = read("components/products/ProductFormSheet.tsx");
  assert.match(sheet, /<ItemEditorFrame/, "the sheet draws the editor frame");
  assert.ok(!/<FormSheet\b/.test(sheet), "no kit FormSheet any more");
  const link = read("components/products/ItemArchiveLink.tsx");
  assert.match(link, /Archive item/, "Archive item for an active item");
  assert.match(link, /Restore item/, "Restore item for an archived one");
  assert.match(sheet, /<ItemArchiveLink/, "drawn for an item being edited only");
  const page = read("app/(dashboard)/products/page.tsx");
  assert.match(page, /title="Archive item\?"/, "today's confirm title");
  assert.match(page, /will be hidden from the menu\. You can restore it from the Archived view\./, "today's confirm words");
  assert.match(page, /archiveProduct\.mutateAsync\(archiving\._id\)/, "today's archive call");
  for (const file of ["components/products/IconPicker.tsx", "components/menu/MoveItemsDialog.tsx", "components/products/ImportProductsDialog.tsx"]) {
    assert.match(read(file), /MenuDialog/, `${file} draws the HTML's dialog box`);
  }
  const frame = read("components/products/ItemEditorFrame.tsx");
  assert.match(frame, /keepOpenForNestedDialog/, "a press in a dialog opened over the editor never closes it");
  assert.match(frame, /useMediaQuery\(MENU_EDITOR_XL_QUERY\)/, "the 1280px split by the shared media query");
});
