// U5 Task 4 (2026-11-01): /categories in the owner's HTML (values 10 category editor, 11 categories view; design 6.10, 6.11).
// Pins on lib/menu-categories-layout.ts, a render of a row, then source pins on the page, the editor, the delete check and
// the toast hooks (the requests, the order of the delete check's branches and the reorder recovery are pinned in
// menu-categories-paths.test.ts and category-arrange-hook-paths.test.ts, unchanged in meaning).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import { stripComments } from "./source-pin-utils";
import { classesOf, tagOf, tagsOf } from "./class-tags.fixtures";
import * as L from "./menu-categories-layout";
import { MENU_DIALOG_BOX_CLASS } from "./menu-editor-layout";
import { CategoryRow } from "@/components/menu/CategoryRow";
import type { Category } from "@/types";

(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const lines = (rel: string): number => readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length;
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

test("the phone is below 720px (the HTML's ph); the chips show from there", () => {
  assert.equal(L.MENU_CATEGORIES_PHONE_QUERY, "(width < 45rem)", "720px as a media query");
});

test("note and card: 13px --text-2 pretty; a white card radius 12, 1px --border, clipped (values 11)", () => {
  hasAll(L.CATEGORY_NOTE_CLASS, ["flex-none", "text-[13px]", "text-muted-foreground", "text-pretty"], "note");
  hasAll(L.CATEGORY_CARD_CLASS, ["flex-none", "rounded-[12px]", "border", "border-border", "bg-card", "overflow-clip"], "card");
});

test("row: padding 10px 12px 10px 10px, gap 12, divided by --border-2, hover --hover where a pointer can hover (values 11)", () => {
  hasAll(L.CATEGORY_ROW_CLASS, ["flex", "items-center", "gap-3", "py-2.5", "pr-3", "pl-2.5", "border-border-2", "[&:not(:first-child)]:border-t", "pointer-fine:hover:bg-hover"], "row");
});

test("arrows: 28x22 stacked 2px apart, radius 6, chevrons; the first / last at .3 (aria-disabled, never disabled)", () => {
  hasAll(L.CATEGORY_ARROWS_CLASS, ["flex", "flex-none", "flex-col", "gap-0.5"], "arrows");
  hasAll(L.CATEGORY_ARROW_CLASS, ["h-[22px]", "w-7", "rounded-[6px]", "text-muted-foreground", "aria-disabled:opacity-30", "pointer-fine:hover:bg-surface-3"], "an arrow");
});

test("grip: a 28px box, touch-action none is the caller's literal; the 44px hit area on touch (ruling R1)", () => {
  hasAll(L.CATEGORY_GRIP_CLASS, ["size-7", "flex-none", "pointer-coarse:after:absolute", "pointer-coarse:after:-inset-2", "aria-disabled:opacity-30"], "grip");
});

test("dot 10px; name 14.5px 600 over the meta 12.5px --text-3 with an ellipsis (values 11)", () => {
  hasAll(L.CATEGORY_DOT_CLASS, ["size-2.5", "flex-none", "rounded-[50%]"], "dot");
  hasAll(L.CATEGORY_NAME_LINK_CLASS, ["block", "min-w-0", "flex-1"], "name link");
  hasAll(L.CATEGORY_NAME_CLASS, ["block", "text-[14.5px]", "font-semibold"], "name");
  hasAll(L.CATEGORY_META_CLASS, ["block", "text-[12.5px]", "text-subtle-foreground", "whitespace-nowrap", "overflow-hidden", "text-ellipsis"], "meta");
});

test("chips: 26px pills from 720px; the station --surface-3, No KOT --warn-t / --warn-i (values 11)", () => {
  hasAll(L.CATEGORY_STATION_CHIP_CLASS, ["h-[26px]", "rounded-[999px]", "bg-surface-3", "text-muted-foreground", "text-[12px]", "font-medium", "max-tab:hidden", "pl-2", "pr-2.5", "gap-1.5", "flex-none"], "station chip");
  hasAll(L.CATEGORY_NO_KOT_CHIP_CLASS, ["h-[26px]", "rounded-[999px]", "bg-status-warn-tint", "text-status-warn-ink", "text-[12px]", "font-semibold", "max-tab:hidden", "pl-2", "pr-[9px]", "gap-[5px]", "flex-none"], "No KOT chip");
});

test("edit / delete: 34px, radius 8; delete --bad-i with --bad-t hover, --text-3 while it holds items", () => {
  hasAll(L.CATEGORY_ICON_BUTTON_CLASS, ["size-[34px]", "rounded-[8px]", "flex-none"], "icon button");
  hasAll(L.CATEGORY_EDIT_CLASS, ["text-muted-foreground", "pointer-fine:hover:bg-surface-3"], "edit");
  hasAll(L.CATEGORY_DELETE_CLASS, ["text-status-bad-ink", "pointer-fine:hover:bg-status-bad-tint"], "delete");
  hasAll(L.CATEGORY_DELETE_BLOCKED_CLASS, ["text-subtle-foreground", "pointer-fine:hover:bg-status-bad-tint"], "delete while it holds items");
});

const category = (over: Partial<Category> = {}): Category => ({ _id: "c1", name: "Starters", order: 1, ...over }) as Category;

function row(over: Partial<Parameters<typeof CategoryRow>[0]> = {}): string {
  const c = over.category ?? category();
  const props = {
    category: c,
    index: 1,
    total: 3,
    counts: { active: 3, archived: 0 },
    soldOut: 0,
    hue: "#E8590C",
    stationName: "Kitchen",
    phone: false,
    disabled: false,
    onMove: () => {},
    onEdit: () => {},
    onDelete: () => {},
    ...over,
  };
  // dnd-kit types make `children` required in props; the lint rule forbids it there: pass it as the argument.
  const Sortable = SortableContext as React.ComponentType<{ items: string[]; children?: React.ReactNode }>;
  const Dnd = DndContext as React.ComponentType<{ children?: React.ReactNode }>;
  return renderToStaticMarkup(createElement(Dnd, null, createElement(Sortable, { items: [c._id] }, createElement(CategoryRow, props))));
}

test("render: a row has the grip, both arrows, the dot, the name link with its meta, the station chip, Edit and Delete", () => {
  const html = row();
  assert.ok(classesOf(tagOf(html, "category-row")).includes("py-2.5"), "the row's padding");
  assert.match(html, /aria-label="Drag to reorder Starters"/, "the grip keeps its label");
  assert.match(html, /aria-label="Move Starters up"/, "the up arrow keeps its label");
  assert.match(html, /aria-label="Move Starters down"/, "the down arrow keeps its label");
  assert.match(html, /href="\/products\?category=c1"/, "the name block opens the category's items (today's count link destination)");
  assert.match(html, /3 items/, "the meta");
  assert.match(tagOf(html, "category-station"), /title="Kitchen station"/, "the station chip's title");
  assert.match(html, /Kitchen<\/span>/, "the station's name");
  assert.match(html, /title="Edit category"/, "Edit's title");
  assert.ok(!/aria-disabled="true"[^>]*aria-label="Move Starters (up|down)"/.test(html), "a middle row's arrows are both on");
  assert.equal(tagsOf(html, "category-no-kot").length, 0, "no No KOT chip for a kitchen category");
});

test("render: the first row's up arrow and the last row's down arrow are aria-disabled; the labels stay (P41, P42)", () => {
  const first = row({ index: 0 });
  assert.match(first, /aria-disabled="true"[^>]*aria-label="Move Starters up"|aria-label="Move Starters up"[^>]*aria-disabled="true"/, "the first row's up arrow is aria-disabled");
  const last = row({ index: 2 });
  assert.match(last, /aria-label="Move Starters down"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Move Starters down"/, "the last row's down arrow is aria-disabled");
  assert.ok(!/<button[^>]*\sdisabled=""/.test(first), "never the disabled attribute (R23)");
});

test("render: a No KOT category shows the chip; on the phone the meta says it instead", () => {
  const off = row({ category: category({ noKot: true }) });
  assert.equal(tagsOf(off, "category-no-kot").length, 1, "the chip");
  assert.match(tagOf(off, "category-no-kot"), /title="KOT is off for this category"/, "its title");
  assert.ok(!/3 items · No KOT/.test(off), "the desktop meta has no No KOT");
  const phone = row({ category: category({ noKot: true }), phone: true });
  assert.match(phone, /3 items · No KOT/, "the phone's meta carries it");
});

test("render: Delete says why while the category holds items, else offers the delete (values 11)", () => {
  const held = row({ counts: { active: 0, archived: 2 } });
  assert.match(held, /title="Move or archive its items first"/, "archived items count too");
  assert.ok(classesOf(tagOf(held, "category-delete")).includes("text-subtle-foreground"), "--text-3 while blocked");
  const empty = row({ counts: undefined });
  assert.match(empty, /title="Delete category"/, "an empty category");
  assert.ok(classesOf(tagOf(empty, "category-delete")).includes("text-status-bad-ink"), "--bad-i when it can go");
  assert.match(empty, /0 items/, "an unknown count reads as none");
});

test("render: the grip carries touch-none, the row never does (the page must keep scrolling on a phone)", () => {
  const html = row();
  const grip = html.match(/<button[^>]*aria-label="Drag to reorder Starters"[^>]*>/)?.[0] ?? "";
  assert.ok(classesOf(grip).includes("touch-none"), "the handle");
  assert.ok(!classesOf(tagOf(html, "category-row")).includes("touch-none"), "not the row");
});

test("source: the page, the editor and the delete check are split and within 300 lines; the page wears the frame, the strip and the note", () => {
  for (const f of ["app/(dashboard)/categories/page.tsx", "components/menu/CategoryEditorDialog.tsx", "components/menu/CategoryDeleteDialog.tsx", "lib/menu-categories-layout.ts", "lib/menu-view.ts"]) {
    assert.ok(lines(f) <= 300, `${f} stays within 300 lines (has ${lines(f)})`);
  }
  const page = read("app/(dashboard)/categories/page.tsx");
  assert.match(page, /<RefreshStrip/, "the shared strip replaces the inline line");
  assert.match(page, /ui="menu"/, "the Menu's strip");
  assert.match(page, /menuStripShows\(\{ hasData: categories\.data !== undefined, isError: categories\.isError, isPaused: categories\.isPaused \}\)/, "shown only on a failed or paused read with the list on screen");
  assert.match(page, /onRetry=\{\(\) => void categories\.refetch\(\)\}/, "Try again re-reads, as before");
  assert.ok(!/Couldn&apos;t refresh ·/.test(page), "the inline line is gone");
  assert.match(page, /line=\{headerLine\}/, "the header's line");
  assert.match(page, /categoriesHeaderLine\(/, "the line from the helper (a first-load products error leaves the shell's line)");
  assert.match(page, /Drag a row or use the arrows — New Order and the QR menu follow this order\./, "today's sentence, kept");
  assert.match(page, /CATEGORY_NOTE_CLASS/, "in the note");
  assert.match(page, /<CategoryDeleteDialog/, "the delete check is its own component");
});

test("source: the category editor wears the 440 box, the HTML's words, Save 46px; the writes stay", () => {
  const src = read("components/menu/CategoryEditorDialog.tsx");
  assert.match(src, /<MenuDialog/, "the dialog box of the Menu (440px, the phone's bottom sheet)");
  assert.match(src, /editing \? "Edit category" : "Add category"/, "the title");
  assert.match(src, /Categories group items in New Order and the QR menu\./, "the sub");
  assert.match(src, /Where this category’s KOTs print\./, "the station's help");
  assert.match(src, /editing \? "Save changes" : "Add category"/, "the Save label");
  assert.match(src, /MENU_EDITOR_INPUT_CLASS/, "the 42px input");
  assert.match(src, /MENU_EDITOR_SAVE_CLASS/, "the 46px Save");
  assert.match(src, /MENU_SELECT_TRIGGER_CLASS/, "the 38px kit select");
  assert.ok(!/<select\b/.test(src), "never a native select");
  assert.match(src, /useStations\(\)/, "the stations read, timing as before");
  assert.match(src, /createCategory\.mutateAsync\(\{ name: trimmed, order: nextCategoryOrder\(list\)/, "the create body");
  assert.ok(MENU_DIALOG_BOX_CLASS.includes("max-w-[440px]"), "the box is the 440px one");
});

test("source: the delete check keeps its words and four branches in the confirm-sheet look", () => {
  const src = read("components/menu/CategoryDeleteDialog.tsx");
  for (const word of ["CONFIRM_SHEET_SCRIM_CLASS", "CONFIRM_SHEET_PANEL_CLASS", "CONFIRM_SHEET_BUTTON_CLASS", "CONFIRM_SHEET_DESTRUCTIVE_CLASS"]) {
    assert.match(src, new RegExp(word), `wears ${word}`);
  }
  assert.match(src, /View \{deletingItemCount === 1 \? "it" : "them"\}/, "View them kept");
  assert.match(src, /deleteCategory\.mutateAsync\(\{ id: deleting\._id, name: deleting\.name \}\)/, "today's delete call, the name for the toast");
});

test("source: the hooks toast the HTML's words and send the same requests", () => {
  const hooks = read("hooks/use-categories.ts");
  assert.match(hooks, /toast\.success\(categoryAddedToast\(created\.name\)\)/, "added");
  assert.match(hooks, /toast\.success\(categorySavedToast\(saved\.name\)\)/, "saved");
  assert.match(hooks, /toast\.success\(categoryDeletedToast\(name\)\)/, "deleted");
  assert.match(hooks, /apiSend<Category>\(`\/api\/categories\/\$\{id\}`, "PUT", data\)/, "the PUT is today's");
  assert.match(hooks, /apiSend<\{ deleted: true \}>\(`\/api\/categories\/\$\{id\}`, "DELETE"\)/, "the DELETE is today's");
  assert.match(hooks, /toast\.error\(err\.message \|\| "Could not update category"\)/, "the update error words are today's");
  assert.match(hooks, /toast\.error\(err\.message \|\| "Could not remove category"\)/, "the delete error words are today's");
  assert.match(hooks, /toast\.error\(err\.message \|\| "Could not add category"\)/, "the add error words are today's");
  assert.match(hooks, /extraInvalidate|PRODUCT_KEYS\.all/, "a delete still refreshes the items");
});
