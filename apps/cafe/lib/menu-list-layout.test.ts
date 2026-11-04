// U5 Task 2 (2026-11-01): the Menu list's rows, the owner's HTML table / cards / badges / switches / bulk bar (values 5-8;
// design 6.4-6.7; owner Q2, Q3, Q4, Q6, Q7). Pins on lib/menu-list-layout.ts, renders of the switch, badges, bulk bar and
// the table / cards, then source pins on the markup and the retired row menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, textOf } from "./class-tags.fixtures";
import * as L from "./menu-list-layout";
import { MENU_LIST_SCROLLER_CLASS } from "./menu-layout";
import { TAB_BAR_HEIGHT_PX } from "./shell-layout";
import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { ItemBadges } from "@/components/menu/ItemBadges";
import { ItemArt } from "@/components/menu/ItemArt";
import { BulkBar } from "@/components/menu/BulkBar";
import { ItemsTable } from "@/components/menu/ItemsTable";
import { ItemCards } from "@/components/menu/ItemCards";
import type { Category, Product } from "@/types";

(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
function hasAll(cls: string, needles: string[], what: string): void {
  const have = tokens(cls);
  for (const n of needles) assert.ok(have.includes(n), `${what}: "${n}" (has "${cls}")`);
}

const noop = () => {};
const cat = { _id: "c1", name: "Waffles", order: 0 } as Category;
const categoryMap = new Map([["c1", cat]]);
const product = (over: Partial<Product> = {}): Product =>
  ({ _id: "p1", name: "Crispy Corn", categoryId: "c1", price: 229, discount: 0, available: true, image: "", modifiers: [], isActive: true, ...over }) as Product;

function table(over: Partial<React.ComponentProps<typeof ItemsTable>> = {}, products = [product()]): string {
  return renderToStaticMarkup(
    createElement(ItemsTable, {
      products,
      archived: false,
      isAdmin: true,
      categoryMap,
      hues: new Map([["c1", "#E8590C"]]),
      categoryPicked: false,
      selected: new Set<string>(),
      onToggleSelect: noop,
      onToggleAll: noop,
      onEdit: noop,
      onCopy: noop,
      onToggleAvailable: noop,
      onToggleQrVisible: noop,
      sort: { key: "category", dir: "asc" },
      onSortChange: noop,
      ...over,
    }),
  );
}

test("the grid (values 5.1, Q4): 18 | 2fr item | [1fr category] | 110 | 72 | 72 | 68 (Edit + Copy, owner C1), gap 14; the Category track only from a 738px list box", () => {
  hasAll(
    L.MENU_ROW_GRID_CLASS,
    ["grid", "grid-cols-[18px_minmax(200px,2fr)_110px_72px_72px_68px]", "gap-3.5", "items-center", "@[738px]/list:grid-cols-[18px_minmax(200px,2fr)_minmax(120px,1fr)_110px_72px_72px_68px]"],
    "the grid",
  );
  assert.ok(!tokens(L.MENU_ROW_GRID_NO_CATEGORY_CLASS).some((t) => t.startsWith("@[738px]")), "a picked category: no Category track at any width");
  hasAll(MENU_LIST_SCROLLER_CLASS, ["@container/list"], "the list scroller is the container `list` (its content box is the list box)");
  hasAll(L.MENU_CATEGORY_CELL_CLASS, ["hidden", "@[738px]/list:flex"], "the Category cell");
});

test("the head and rows (values 5.1, 5.2): head 9px 14px --surface-2 sticky; rows 10px 14px, --accent-t selected, archived dimmed, hover --hover on hover devices", () => {
  // Ruling M8 (V-2's V2-3): the HTML's head sticks 20px below the header and rows show through that strip (the scroller's top
  // padding): not copied, the head sticks at the scroller's top edge (the table shows only from 816px, where the padding is 20px).
  hasAll(L.MENU_HEAD_CLASS, ["sticky", "top-[-20px]", "bg-surface-2", "px-3.5", "py-[9px]", "text-[12.5px]", "font-medium", "text-muted-foreground", "border-b", "border-border"], "the head");
  hasAll(L.MENU_ROW_CLASS, ["px-3.5", "py-2.5", "pointer-fine:hover:bg-hover"], "a row");
  assert.equal(L.MENU_ROW_SELECTED_CLASS, "bg-status-info-tint", "selected = the HTML's --accent-t");
  assert.ok(!L.MENU_HEAD_CLASS.includes("top-0"), "the head no longer stops 20px below the header");
  hasAll(MENU_LIST_SCROLLER_CLASS, ["pt-5"], "the offset is the scroller's top padding from 720px");
  // Ruling M9 (V-1 a11y): the HTML's opacity .6 fails 4.5:1 (U4 K5): archived rows dim with tokens, the photo stays faded.
  hasAll(L.MENU_ARCHIVED_CLASS, ["text-muted-foreground", "[&_.text-foreground]:text-muted-foreground!", "[&_img]:opacity-60"], "archived rows dim with tokens");
  assert.ok(!L.MENU_ARCHIVED_CLASS.split(/\s+/).includes("opacity-60"), "never the row's own opacity (it fails contrast)");
  hasAll(L.MENU_ROWS_CLASS, ["[&>:not(:first-child)]:border-t", "[&>:not(:first-child)]:border-border-2"], "rows are divided by --border-2, none above the first");
  hasAll(L.MENU_LIST_BOX_CLASS, ["rounded-[12px]", "border", "border-border", "bg-card", "overflow-clip"], "the white list (clip, never hidden)");
});

test("the name (Q2): wraps, breaks an unbroken word anywhere, never cut (no truncate / ellipsis), 14px 600; line 2 holds the badges then the sizes text", () => {
  hasAll(L.MENU_NAME_CLASS, ["text-[14px]", "font-semibold", "[overflow-wrap:anywhere]"], "the name");
  const never = { name: L.MENU_NAME_CLASS, card: L.MENU_CARD_NAME_CLASS, sizes: L.MENU_SIZES_CLASS };
  for (const [name, cls] of Object.entries(never)) assert.ok(!/\btruncate\b|text-ellipsis|whitespace-nowrap/.test(cls), `${name}: never cut`);
  hasAll(L.MENU_SIZES_CLASS, ["text-[12px]", "text-subtle-foreground"], "the sizes text");
  hasAll(L.MENU_LINE2_CLASS, ["flex", "flex-wrap", "items-center"], "line 2 wraps");
  hasAll(L.MENU_PRICE_CELL_CLASS, ["font-mono", "text-[13.5px]", "font-semibold", "text-right"], "the price");
  hasAll(L.MENU_PRICE_STRUCK_CLASS, ["text-[12px]", "text-subtle-foreground", "line-through"], "the struck original");
});

test("the art (Q3): 34px, radius 8; the check is 18px radius 5 with a 1.5px border; Edit is a 32px pencil that lights --surface-3", () => {
  const html = renderToStaticMarkup(createElement(ItemArt, { name: "Crispy", image: "", size: 34 }));
  hasAll(classesOf(html.match(/<span [^>]*>/)?.[0] ?? "").join(" "), ["size-[34px]", "rounded-[8px]"], "ItemArt 34");
  hasAll(L.MENU_CHECK_CLASS, ["size-[18px]", "rounded-[5px]", "border-[1.5px]", "text-white"], "the check");
  hasAll(L.MENU_EDIT_CLASS, ["size-8", "rounded-[8px]", "pointer-fine:hover:bg-surface-3"], "Edit");
});

test("the switch (values 7.2): 40x24, radius 12, knob 18 at 3px / 19px, --ok for stock and --accent for QR, --surface-3 off; a Radix switch with its label", () => {
  hasAll(L.MENU_SWITCH_CLASS, ["h-6", "w-10", "rounded-[12px]", "bg-surface-3", "duration-150"], "the track");
  hasAll(L.MENU_SWITCH_KNOB_CLASS, ["size-[18px]", "left-[3px]", "top-[3px]", "data-[state=checked]:left-[19px]", "rounded-[50%]", "bg-white"], "the knob");
  assert.equal(L.MENU_SWITCH_ON_CLASS.ok, "data-[state=checked]:bg-status-ok", "stock on = --ok");
  assert.equal(L.MENU_SWITCH_ON_CLASS.accent, "data-[state=checked]:bg-primary", "QR on = --accent");
  const html = renderToStaticMarkup(createElement(MenuSwitch, { checked: true, onCheckedChange: noop, tone: "ok", "aria-label": "In stock: X" }));
  assert.match(html, /role="switch"/, "a switch");
  assert.match(html, /aria-checked="true"/, "its state");
  assert.match(html, /aria-label="In stock: X"/, "named");
  assert.ok(classesOf(html.match(/<button [^>]*>/)?.[0] ?? "").includes("data-[state=checked]:bg-status-ok"), "the tone's class is on the track");
});

test("the badges (values 7.1): table 20px / card 19px, the HTML's tones, No KOT in the warning tone; none for a plain item", () => {
  hasAll(L.MENU_BADGE_TABLE_CLASS, ["h-5", "text-[11px]", "font-semibold", "rounded-[10px]", "pl-1.5", "pr-[7px]", "gap-1"], "table badge");
  hasAll(L.MENU_BADGE_CARD_CLASS, ["h-[19px]", "text-[10.5px]", "rounded-[9px]", "pl-[5px]", "pr-1.5", "gap-[3px]"], "card badge");
  assert.equal(L.MENU_BADGE_TONE_CLASS["sold-out"], "bg-status-bad-tint text-status-bad-ink", "sold out");
  assert.equal(L.MENU_BADGE_TONE_CLASS.hidden, "bg-surface-3 text-muted-foreground", "hidden on QR");
  assert.equal(L.MENU_BADGE_TONE_CLASS.archived, "bg-surface-3 text-muted-foreground", "archived");
  assert.equal(L.MENU_BADGE_TONE_CLASS["no-kot"], "bg-status-warn-tint text-status-warn-ink", "No KOT");
  const html = renderToStaticMarkup(createElement(ItemBadges, { badges: ["sold-out", "hidden", "archived", "no-kot"], size: "table" }));
  for (const w of ["Sold out", "Hidden on QR", "Archived", "No KOT"]) assert.ok(html.includes(w), `${w} is drawn`);
  assert.equal(renderToStaticMarkup(createElement(ItemBadges, { badges: [], size: "card" })), "", "no badge, nothing");
  assert.ok(!/<p[ >]|<div[ >]/.test(html), "spans only: a badge never sits as a block in a paragraph");
});

test("the bulk bar (values 8; Q6): the ink bar, sticky at the scroller's foot, above the tab bar and its inset on a phone; 32px buttons, icon-only 38px below a 520px list", () => {
  hasAll(L.MENU_BULK_BAR_CLASS, ["bg-ink", "text-on-ink", "sticky", "bottom-0", "rounded-[10px]", "pl-3.5", "pr-2.5", "py-2", "gap-2", "flex-wrap"], "the bar");
  // A sticky bottom offset counts from the scroller's padding edge: the phone's 92px + inset foot padding already clears the
  // 59px tab bar + its inset, so the bar takes no offset of its own (measured: with one it floated 92px above the tab bar).
  assert.ok(!tokens(L.MENU_BULK_BAR_CLASS).some((t) => t.includes("bottom-[")), "no extra bottom offset: the scroller's foot padding is the clearance");
  assert.ok(tokens(MENU_LIST_SCROLLER_CLASS).includes("max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]") && 92 >= TAB_BAR_HEIGHT_PX, "the phone's foot padding (92px + inset) clears the tab bar (59px + inset)");
  hasAll(
    L.MENU_BULK_BUTTON_CLASS,
    ["h-8", "w-[38px]", "rounded-[8px]", "border-[rgba(255,255,255,.22)]", "text-[12.5px]", "font-semibold", "pointer-fine:hover:bg-[rgba(255,255,255,.1)]", "@[520px]/list:w-auto"],
    "a button",
  );
  hasAll(L.MENU_BULK_LABEL_CLASS, ["hidden", "@[520px]/list:inline"], "the label shows from a 520px list");
  hasAll(L.MENU_BULK_COUNT_CLASS, ["text-[13.5px]", "font-semibold"], "the count");
  const bar = (over: Partial<React.ComponentProps<typeof BulkBar>>) =>
    renderToStaticMarkup(createElement(BulkBar, { count: 1, isAdmin: true, archived: false, isPending: false, onAction: noop, onMove: noop, onArchive: noop, onClear: noop, ...over }));
  const admin = bar({});
  assert.ok(textOf(admin, "menu-bulk-bar").startsWith("1 item selected"), "singular count");
  for (const t of ["Mark sold out", "Back in stock", "Move to category", "Archive", "Clear selection"]) assert.match(admin, new RegExp(`aria-label="${t}"`), `${t} is a named button`);
  assert.ok(!admin.includes("More"), "the More menu is gone");
  const staff = bar({ isAdmin: false, count: 2 });
  assert.match(staff, /2 items selected/, "plural count");
  assert.ok(!staff.includes("Move to category") && !staff.includes('aria-label="Archive"'), "staff: the two stock actions only");
  const arch = bar({ archived: true });
  assert.match(arch, /aria-label="Restore"/, "the Archived view offers Restore");
  assert.ok(!arch.includes("Mark sold out") && !arch.includes("Move to category"), "and nothing else");
  const over = bar({ count: 501 });
  assert.match(over, /Select up to 500 items at a time\./, "the cap words are in the bar");
  assert.equal((over.match(/<button [^>]*disabled/g) ?? []).length, 4, "every action is off over the cap (Mark sold out, Back in stock, Move, Archive)");
  assert.equal(bar({ count: 0 }), "", "no selection, no bar");
});

test("table render: head words and sorts, a row's cells, the Category cell only while no category is picked, staff words (menu P8)", () => {
  const html = table();
  for (const w of ["Item", "Category", "Price", "Stock", "QR"]) assert.ok(textOf(html, "menu-table-head").includes(w), `head: ${w}`);
  assert.equal((html.match(/aria-sort="(ascending|descending|none)"/g) ?? []).length, 4, "the four sort heads carry aria-sort");
  assert.match(html, /aria-sort="ascending"/, "the active sort");
  assert.match(html, /title="Edit item"/, "the Edit pencil");
  assert.match(html, /Single price/, "the sizes text");
  assert.match(html, /₹229/, "the price");
  assert.match(html, /Waffles/, "the category (its cell and the narrow line 2)");
  const picked = table({ categoryPicked: true });
  assert.ok(!textOf(picked, "menu-table-head").includes("Category"), "a picked category: no Category head");
  assert.ok(!picked.includes("Waffles"), "and no category in the row either");
  const staff = table({ isAdmin: false });
  assert.match(staff, />Shown</, "staff read Shown in the QR column");
  assert.ok(!staff.includes('title="Edit item"') && !staff.includes("Shown on QR menu:"), "no Edit, no QR switch for staff");
  assert.match(table({}, [product({ publicVisible: false })]), /Hidden on QR/, "a hidden item wears its badge");
  const arch = table({ archived: true });
  assert.ok(!arch.includes("In stock: Crispy"), "an archived row has no stock switch");
  const archRow = arch.replace(/&amp;/g, "&");
  for (const token of L.MENU_ARCHIVED_CLASS.split(/\s+/)) assert.ok(archRow.includes(token), `an archived row carries ${token}`);
});

test("select-all (values 5.1): the head box is empty / dash / tick for none / some / all of the listed rows", () => {
  const two = [product({ _id: "a" }), product({ _id: "b", name: "Corn Chat" })];
  const head = (selected: string[]) => textOf(table({ selected: new Set(selected) }, two), "menu-table-head");
  assert.ok(!/[✓–]/.test(head([])), "none: empty");
  assert.ok(head(["a"]).includes("–"), "some: the en dash");
  assert.ok(head(["a", "b"]).includes("✓"), "all: the tick");
  assert.match(table({ selected: new Set(["a"]) }, two), /aria-checked="mixed"/, "a partial select-all is mixed to assistive tech");
});

test("cards render: price, category, sizes, badges, the stock cell, a select box only in Select mode (menu P9)", () => {
  const p = product({ variations: [{ name: "Small", price: 249 }, { name: "Large", price: 449 }], available: false });
  const base = { products: [p], archived: false, categoryMap, onToggleSelect: noop, onEdit: noop, onCopy: noop, onToggleAvailable: noop };
  const html = renderToStaticMarkup(createElement(ItemCards, { ...base, isAdmin: true, selectMode: false, selected: new Set<string>() }));
  assert.match(html, /₹249–449/, "the range");
  assert.match(html, /· Waffles · 2 sizes/, "category and sizes");
  assert.match(html, /Sold out/, "the stock label and the badge");
  assert.ok(!html.includes('role="checkbox"'), "no select box outside Select mode");
  const sel = renderToStaticMarkup(createElement(ItemCards, { ...base, isAdmin: false, selectMode: true, selected: new Set(["p1"]) }));
  assert.match(sel, /role="checkbox"[^>]*aria-checked="true"/, "Select mode shows the box, for staff too");
  hasAll(L.MENU_CARD_CLASS, ["px-3.5", "py-3", "gap-3"], "a card");
  hasAll(L.MENU_CARD_NAME_CLASS, ["text-[14.5px]", "font-semibold"], "the card's name");
  hasAll(L.MENU_CARD_STOCK_LABEL_CLASS, ["text-[10.5px]", "text-subtle-foreground"], "the stock label");
});

test("PIN: the row menu is retired (ruling M3): no ItemRowMenu file or import; the Edit pencil and the name open the editor; Archive / Restore stay in the bulk bar", () => {
  assert.equal(existsSync(path.join(CAFE_ROOT, "components/menu/ItemRowMenu.tsx")), false, "the file is deleted");
  for (const f of ["components/menu/ItemsTable.tsx", "components/menu/ItemCards.tsx", "components/menu/ItemsListSection.tsx", "components/menu/BulkBar.tsx", "app/(dashboard)/products/page.tsx"]) {
    assert.ok(!/ItemRowMenu/.test(read(f)), `${f} does not use ItemRowMenu`);
  }
  assert.match(read("components/menu/BulkBar.tsx"), /label="Restore"[\s\S]*label="Archive"/, "the bar offers both");
});

test("PIN: ItemsListSection mounts only the list for the current width (useMediaQuery(816px)); both CSS-gated while it is unknown", () => {
  const src = read("components/menu/ItemsListSection.tsx");
  assert.match(src, /const wide = useMediaQuery\(MENU_TABLE_QUERY\)/, "the section reads the table query");
  assert.match(src, /\{wide !== false && \(\s*<div className=\{gate \? MENU_TABLE_SSR_CLASS : undefined\}>\s*<ItemsTable/, "the table mounts only when wide is not false");
  assert.match(src, /\{wide !== true && \(\s*<div className=\{gate \? MENU_CARDS_SSR_CLASS : undefined\}>\s*<ItemCards/, "the cards mount only when wide is not true");
  assert.equal(L.MENU_TABLE_QUERY, "(min-width: 816px)", "816px = the HTML's listW >= 700 with the 76px nav");
  assert.match(src, /data-ui="menu-list-box"/, "one permanent white list wraps either form");
});

test("PIN: the toolbar's Select button hides exactly where the table shows (ruling M5: a 740px page box)", () => {
  const src = read("components/menu/ItemsToolbar.tsx");
  assert.match(src, /data-ui="menu-select-mode"[\s\S]{0,300}"@\[740px\]\/menu:hidden"/, "Select takes @[740px]/menu:hidden");
  assert.ok(!/lg:hidden/.test(src), "no lg rule left");
});

test("PIN: the toasts take the HTML's words, the name read from the products cache, no new request (Q7)", () => {
  const src = read("hooks/use-products.ts");
  for (const w of ["marked sold out", "is back in stock", "hidden from QR menu", "shown on QR menu", "archived · hidden everywhere", "restored"]) assert.ok(src.includes(w), `toast: ${w}`);
  assert.match(src, /qc\.getQueryData<Product\[\]>\(key\)/, "the name comes from the cache");
  assert.match(src, /toast\.success\(bulkToastText\(result\)\)/, "bulk toasts go through bulkToastText");
  assert.ok(!/Marked out of stock|Marked in stock|"Item archived"|"Item restored"/.test(src), "today's words are gone");
});
