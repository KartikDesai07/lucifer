// U2 Task 3 (2026-10-23): the Orders toolbar, the Filters panel and the chips as drawn
// (docs/superpowers/specs/2026-10-22-orders-html-values.md 4 toolbar, 5 Filters panel, 6 chips;
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md Q4, Q5, 6.3, 6.13): renders of OrdersToolbar.tsx,
// OrdersDateBox.tsx and OrdersFiltersPanel.tsx, and pins on the page (the old search, selects, DatePicker, "{n} active" go).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf } from "./class-tags.fixtures";
import { DEFAULT_ORDERS_FILTERS, filterChips } from "./orders-lanes";
import { state } from "./orders-lanes.fixtures";
import { OrdersToolbar } from "@/components/orders/OrdersToolbar";
import { OrdersChips, OrdersFiltersPanel } from "@/components/orders/OrdersFiltersPanel";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (as common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const PAGE = "app/(dashboard)/orders/page.tsx";
const PANEL = "components/orders/OrdersFiltersPanel.tsx";

const noop = (): void => undefined;
const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];
/** The inner HTML of the nth element carrying data-ui="<name>" (its own closing tag found by nesting depth). */
const innerOf = (html: string, name: string, nth = 0): string => {
  const open = [...html.matchAll(new RegExp(`<([a-z0-9]+) [^>]*data-ui="${name}"[^>]*>`, "g"))][nth];
  assert.ok(open, `landmark: data-ui="${name}" #${nth + 1} renders`);
  const i = (open.index ?? 0) + open[0].length;
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g");
  re.lastIndex = i;
  for (let m = re.exec(html), depth = 1; m; m = re.exec(html)) if ((depth += m[1] ? -1 : 1) === 0) return html.slice(i, m.index);
  return html.slice(i);
};
const textOf = (h: string): string => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

const TOOLBAR_DEFAULTS = { phone: "", onPhone: noop, onClearPhone: noop, date: { kind: "today" } as const, onDate: noop };
const toolbarHtml = (props: Partial<Parameters<typeof OrdersToolbar>[0]> = {}): string =>
  renderToStaticMarkup(createElement(OrdersToolbar, { ...TOOLBAR_DEFAULTS, filtersOpen: false, onToggleFilters: noop, count: 0, ...props }));
const PANEL_DEFAULTS = { filters: DEFAULT_ORDERS_FILTERS, tables: ["T-1", "T-4"], onChange: noop, onReset: noop, onClose: noop };
const panelHtml = (props: Partial<Parameters<typeof OrdersFiltersPanel>[0]> = {}): string =>
  renderToStaticMarkup(createElement(OrdersFiltersPanel, { ...PANEL_DEFAULTS, ...props }));
const chipsHtml = (props: Partial<Parameters<typeof OrdersChips>[0]> = {}): string =>
  renderToStaticMarkup(createElement(OrdersChips, { chips: [], onClear: noop, onClearAll: noop, ...props }));

// ── The toolbar (values 4.1) ──────────────────────────────────────────────────────────────────────────────────────

test("OrdersToolbar: the row (8px, wrapping) holds the search box, the date box and the Filters button", () => {
  const html = toolbarHtml();
  expectAll(tagOf(html, "orders-toolbar"), ["flex", "flex-wrap", "gap-2"], "values 4.1 row");
  expectAll(
    tagOf(html, "orders-search"),
    ["flex", "h-10", "min-w-0", "flex-[1_1_220px]", "max-tab:basis-0", "items-center", "gap-2", "rounded-[9px]", "border", "border-border", "bg-card", "px-2.5"],
    "values 4.1 search box: flex 1 1 220px (0px on the phone), 40px, radius 9, 0 10px",
  );
  expectAll(
    tagOf(html, "orders-date"),
    ["relative", "flex", "min-w-[130px]", "flex-[0_1_160px]", "max-tab:hidden"],
    "values 4.1 date box: flex 0 1 160px, min 130px, hidden on the phone",
  );
  expectAll(
    tagOf(html, "orders-filters-button"),
    ["flex", "h-10", "flex-none", "items-center", "gap-2", "rounded-[9px]", "border", "bg-card", "px-[13px]", "text-[13.5px]", "font-medium", "text-foreground", "hover:border-subtle-foreground"],
    "values 4.1 Filters button",
  );
  const order = ["orders-search", "orders-date", "orders-filters-button"].map((n) => html.indexOf(`data-ui="${n}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "search, date box, Filters in the HTML's order");
});

test("OrdersToolbar search: the phone-only box says so (owner Q4); the round ✕ 'Clear search' only while typed", () => {
  const html = toolbarHtml();
  const input = tagOf(html, "orders-search-input");
  assert.match(input, /placeholder="Search by customer phone"/, "placeholder (owner Q4, as U1 Q22)");
  assert.match(input, /aria-label="Search by customer phone"/, "its name (owner Q4)");
  assert.match(input, /inputMode="tel"|inputmode="tel"/, "the phone keypad");
  // The final fix wave (moved on purpose): type="search" let Chrome wipe the typed phone on Escape — with the Filters
  // panel open one Escape closed the panel AND dropped the search (and the choice). A text box keeps it; the ✕ clears.
  assert.match(input, /type="text"/, "a plain text box: Escape never wipes the typed phone");
  assert.ok(!/type="search"/.test(input), "not a search box (Chrome clears those on Escape)");
  assert.match(input, /value=""/, "the typed value");
  expectAll(
    input,
    ["min-w-0", "flex-1", "border-0", "bg-transparent", "px-0.5", "py-px", "text-[14px]", "max-tab:text-base", "leading-[normal]", "text-foreground", "outline-none", "placeholder:text-subtle-foreground"],
    "values 4.1 input: 14px (16px below 720px, ruling R36)",
  );
  const icon = /<svg[^>]*>[\s\S]*?<\/svg>/.exec(innerOf(html, "orders-search"))?.[0] ?? "";
  assert.match(icon, /width="15"/, "the 15px icon");
  assert.match(icon, /<circle cx="11" cy="11" r="7"/, "the HTML's magnifier");
  expectAll(/<svg[^>]*>/.exec(icon)?.[0] ?? "", ["flex-none", "text-subtle-foreground"], "the icon in --text-3");
  assert.equal(tagOf(html, "orders-search-clear"), "", "no ✕ while the box is empty");
  assert.equal(tagOf(toolbarHtml({ phone: "   " }), "orders-search-clear"), "", "no ✕ for spaces only (trimmed)");
  const typed = toolbarHtml({ phone: "98765" });
  const clear = tagOf(typed, "orders-search-clear");
  assert.match(clear, /title="Clear search"/, "the HTML's title");
  assert.match(clear, /aria-label="Clear search"/, "and its name");
  expectAll(
    clear,
    ["flex", "size-6", "flex-none", "items-center", "justify-center", "rounded-[50%]", "border-0", "bg-surface-3", "text-[11px]", "text-muted-foreground"],
    "values 4.1 clear: 24px round --surface-3, 11px --text-2",
  );
  assert.equal(textOf(innerOf(typed, "orders-search-clear")), "✕", "its glyph");
});

test("OrdersToolbar date box: the chosen date's words, 13.5px 500, the chevron at right 11 / top 13", () => {
  const html = toolbarHtml();
  const box = tagOf(html, "orders-date-box");
  expectAll(
    box,
    ["flex", "h-10", "w-full", "items-center", "rounded-[9px]", "border", "border-border", "bg-card", "pl-3", "pr-8", "text-[13.5px]", "font-medium", "text-foreground"],
    "values 4.1 date select",
  );
  expectAll(box, ["outline-none", "focus-visible:ring-2", "focus-visible:ring-ring"], "a keyboard focus ring in place of the outline (WCAG 2.4.7, U1's pattern)");
  assert.match(box, /aria-label="Date: Today"/, "named with its value");
  assert.equal(textOf(innerOf(html, "orders-date-box")), "Today", "opens on Today (owner Q5)");
  expectAll(tagOf(html, "orders-date-chevron"), ["pointer-events-none", "absolute", "top-[13px]", "right-[11px]", "text-muted-foreground"], "values 4.1 chevron");
  assert.match(tagOf(html, "orders-date-chevron"), /width="14"/, "the 14px chevron");
  assert.equal(textOf(innerOf(toolbarHtml({ date: { kind: "day", date: "2026-10-22" } }), "orders-date-box")), "22 Oct 2026", "a picked day");
  assert.equal(textOf(innerOf(toolbarHtml({ date: { kind: "all" } }), "orders-date-box")), "All dates", "All dates");
});

test("OrdersToolbar Filters: --border closed with no chip; --text when open or with chips; the word hidden on the phone; the count badge", () => {
  const closed = toolbarHtml();
  const btn = tagOf(closed, "orders-filters-button");
  assert.ok(classesOf(btn).includes("border-border") && !classesOf(btn).includes("border-foreground"), "closed, no chip: --border");
  assert.match(btn, /aria-expanded="false"/, "closed");
  assert.ok(!/aria-controls=/.test(btn), "no aria-controls while the panel is not there");
  expectAll(tagOf(closed, "orders-filters-label"), ["max-tab:hidden"], "values 4.1: the word is hidden on the phone");
  assert.equal(textOf(innerOf(closed, "orders-filters-label")), "Filters", "the word");
  assert.equal(tagOf(closed, "orders-filters-count"), "", "no badge without chips");
  const open = tagOf(toolbarHtml({ filtersOpen: true }), "orders-filters-button");
  expectAll(open, ["border-foreground"], "open: --text border");
  assert.match(open, /aria-expanded="true"/, "open");
  assert.match(open, /aria-controls="orders-filters"/, "controls the panel");
  const counted = toolbarHtml({ count: 2 });
  expectAll(tagOf(counted, "orders-filters-button"), ["border-foreground"], "with chips: --text border");
  expectAll(
    tagOf(counted, "orders-filters-count"),
    ["flex", "h-[19px]", "min-w-[19px]", "items-center", "justify-center", "rounded-[10px]", "bg-primary", "px-[5px]", "text-[11px]", "font-bold", "text-primary-foreground"],
    "values 4.1 count badge on --accent",
  );
  assert.equal(textOf(innerOf(counted, "orders-filters-count")), "2", "the count = the chips shown");
  assert.match(tagOf(counted, "orders-filters-button"), /aria-label="Filters, 2 applied"/, "the count is in its name (the word is hidden on the phone)");
});

// ── The Filters panel (values 5.1) ────────────────────────────────────────────────────────────────────────────────

test("OrdersFiltersPanel: in the page flow, radius 12, padding 14, groups 14px apart, rising in; Date (phone only), Payment, Table, the footer", () => {
  const html = panelHtml();
  const panel = tagOf(html, "orders-filters");
  expectAll(panel, ["flex", "flex-col", "gap-3.5", "rounded-[12px]", "border", "border-border", "bg-card", "p-3.5", "motion-safe:animate-html-rise-fast"], "values 5.1 panel");
  assert.match(panel, /id="orders-filters"/, "the Filters button's aria-controls target");
  assert.ok(!classesOf(panel).some((c) => /^(fixed|absolute)$/.test(c) || c.startsWith("shadow")), "in the flow, no shadow (values 5.1)");
  const groups = ["orders-filter-date", "orders-filter-payment", "orders-filter-table", "orders-filters-foot"].map((n) => html.indexOf(`data-ui="${n}"`));
  assert.ok(groups.every((i) => i > 0), "every part renders");
  assert.deepEqual([...groups].sort((a, b) => a - b), groups, "Date, Payment, Table, then the footer");
  expectAll(tagOf(html, "orders-filter-date"), ["flex", "flex-col", "gap-2", "tab:hidden"], "Date leads on the phone only (values 5.1)");
  expectAll(tagOf(html, "orders-filter-payment"), ["flex", "flex-col", "gap-2"], "values 5.1 group");
  assert.ok(!html.includes("Order type") && !html.includes("All types"), "no Order type group (design 7)");
  const labels = tagsOf(html, "orders-filter-label").map((_, i) => textOf(innerOf(html, "orders-filter-label", i)));
  assert.deepEqual(labels, ["Date", "Payment", "Table"], "the groups' labels");
  for (const [i, ui] of ["orders-filter-date", "orders-filter-payment"].entries()) {
    const by = /aria-labelledby="([^"]+)"/.exec(tagOf(html, ui))?.[1] ?? "";
    assert.ok(by && !/aria-label=/.test(tagOf(html, ui)), `${ui} is named by its visible label, not a repeated aria-label`);
    assert.ok(tagsOf(html, "orders-filter-label")[i].includes(`id="${by}"`), `${ui}'s label carries that id`);
  }
  expectAll(
    tagOf(html, "orders-filter-label"),
    ["text-[11.5px]", "font-semibold", "tracking-[.06em]", "uppercase", "text-subtle-foreground"],
    "values 5.1 label",
  );
});

test("OrdersFiltersPanel pills: Date Today · Yesterday · All dates · Pick a day…; Payment Any · Cash · Online · Split · Due · Credit; the chosen one in --ink", () => {
  const html = panelHtml({ filters: state({ payment: "Due", date: { kind: "yesterday" } }) });
  const pills = tagsOf(html, "orders-filter-option");
  const words = pills.map((_, i) => textOf(innerOf(html, "orders-filter-option", i)));
  assert.deepEqual(
    words,
    ["Today", "Yesterday", "All dates", "Pick a day…", "Any", "Cash", "Online", "Split", "Due", "Credit"],
    "the phone's Date pills, then the Payment pills (design 6.3)",
  );
  const base = ["h-8", "whitespace-nowrap", "rounded-[999px]", "border", "px-3", "text-[13px]", "font-medium"];
  pills.forEach((tag, i) => expectAll(tag, base, `pill ${words[i]} (values 5.1)`));
  // The final fix wave (moved on purpose): the Date pills are one single choice, as the date box's rows — the chosen one
  // aria-current="true" (the repo's single-choice mark: the list rows, the /pos categories), never a toggle's
  // aria-pressed; "Pick a day…" opens the calendar (aria-haspopup="dialog"). The Payment pills keep aria-pressed.
  const on = pills.map((tag) => /aria-current="true"|aria-pressed="true"/.test(tag));
  assert.deepEqual(on, [false, true, false, false, false, false, false, false, true, false], "Yesterday and Due are chosen");
  for (const [i, tag] of pills.entries()) {
    expectAll(tag, on[i] ? ["border-ink", "bg-ink", "text-on-ink"] : ["border-border", "bg-card", "text-foreground"], `pill ${words[i]}'s look`);
  }
  for (const [i, tag] of pills.slice(0, 4).entries()) {
    assert.ok(!/aria-pressed=/.test(tag), `Date pill ${words[i]}: no toggle state (one choice of four)`);
    assert.equal(/aria-current="true"/.test(tag), on[i], `Date pill ${words[i]}: aria-current only when chosen`);
  }
  assert.match(pills[3], /aria-haspopup="dialog"/, "Pick a day… opens the calendar");
  for (const [i, tag] of pills.slice(4).entries()) {
    assert.match(tag, new RegExp(`aria-pressed="${on[i + 4]}"`), `Payment pill ${words[i + 4]}: aria-pressed, as before`);
    assert.ok(!/aria-current=/.test(tag), `Payment pill ${words[i + 4]}: no aria-current`);
  }
  assert.match(tagsOf(panelHtml(), "orders-filter-option")[4], /aria-pressed="true"/, "Any with no payment");
  assert.match(tagsOf(panelHtml(), "orders-filter-option")[0], /aria-current="true"/, "Today by default");
  const day = tagsOf(panelHtml({ filters: state({ date: { kind: "day", date: "2026-10-22" } }) }), "orders-filter-option");
  assert.match(day[3], /aria-current="true"/, "a picked day lights Pick a day… (the current date choice)");
  assert.ok(day.slice(0, 3).every((tag) => !/aria-current=/.test(tag)), "and no other Date pill");
});

test("OrdersDateBox rows: Today / Yesterday / All dates are one single choice (aria-current on the chosen one, never aria-pressed); 'Pick a day…' opens the calendar (aria-haspopup=\"dialog\")", () => {
  const src = read("components/orders/OrdersDateBox.tsx");
  assert.ok(!/aria-pressed/.test(src), "no toggle state on a date row");
  const row = src.slice(src.indexOf("function DateRow("), src.indexOf("\n}\n", src.indexOf("function DateRow(")));
  assert.ok(row.length > 0, "landmark: DateRow");
  assert.match(row, /aria-current=\{on \? "true" : undefined\}/, "the chosen row says so (as the phone's Date pills)");
  assert.match(row, /aria-haspopup=\{popup \? "dialog" : undefined\}/, "a row that opens the calendar says so");
  assert.match(src, /<DateRow key=\{choice\.kind\} label=\{dateLabel\(choice\)\} on=\{date\.kind === choice\.kind\} onClick=\{\(\) => choose\(choice\)\} \/>/, "the three dates: no popup");
  assert.match(src, /<DateRow label=\{PICK_A_DAY\} on=\{date\.kind === "day"\} popup onClick=\{\(\) => setPicking\(true\)\} \/>/, "Pick a day…: the calendar");
});

test("OrdersFiltersPanel Table: the kit select 260 x 38, radius 9, 13.5px 400, the 14px --text-2 chevron; 'All tables' or the table", () => {
  const html = panelHtml();
  // React writes ">" in an attribute as &gt; (the [&>svg]: variants).
  const trigger = tagOf(html, "orders-filter-table-select").replace(/&gt;/g, ">");
  expectAll(
    trigger,
    ["h-[38px]", "w-full", "max-w-[260px]", "cursor-pointer", "rounded-[9px]", "border-border", "bg-card", "py-0", "pl-3", "pr-[11px]", "text-[13.5px]", "text-foreground", "[&>svg]:size-3.5", "[&>svg]:opacity-100", "[&>svg]:text-muted-foreground"],
    "values 5.1 table select",
  );
  assert.match(trigger, /role="combobox"/, "the kit Select (no native select, pin P13)");
  // The final fix wave (moved on purpose): its name is its visible label "Table" (aria-labelledby, as the Date and Payment
  // groups), no longer the off-screen "Filter by table" (WCAG 2.5.3: the name contains the words on screen).
  assert.ok(!/aria-label=/.test(trigger), "no hidden name of its own");
  const by = /aria-labelledby="([^"]+)"/.exec(trigger)?.[1] ?? "";
  const label = tagsOf(html, "orders-filter-label")[2] ?? "";
  assert.ok(by !== "" && label.includes(`id="${by}"`), "named by the group's visible label");
  assert.equal(textOf(innerOf(html, "orders-filter-label", 2)), "Table", "the name: 'Table'");
  assert.equal(textOf(innerOf(html, "orders-filter-table-select")), "All tables", "no table chosen");
  assert.equal(textOf(innerOf(panelHtml({ filters: state({ tableNo: "T-4" }) }), "orders-filter-table-select")), "T-4", "the chosen table");
});

test("OrdersFiltersPanel footer: Reset (--text-2) and Done (--ink), 34px, 8px apart over the --border-2 rule", () => {
  const html = panelHtml();
  expectAll(tagOf(html, "orders-filters-foot"), ["flex", "justify-end", "gap-2", "border-t", "border-border-2", "pt-3"], "values 5.1 footer");
  expectAll(tagOf(html, "orders-filters-reset"), ["h-[34px]", "border-0", "bg-transparent", "px-3", "text-[13px]", "font-medium", "text-muted-foreground"], "Reset");
  expectAll(tagOf(html, "orders-filters-done"), ["h-[34px]", "rounded-[8px]", "border-0", "bg-ink", "px-4", "text-[13px]", "font-semibold", "text-on-ink"], "Done");
  assert.equal(textOf(innerOf(html, "orders-filters-reset")), "Reset", "Reset");
  assert.equal(textOf(innerOf(html, "orders-filters-done")), "Done", "Done");
});

test("OrdersFiltersPanel: Escape closes it unless a popover or select inside took the key first (design 6.13)", () => {
  const src = read(PANEL);
  assert.match(src, /document\.addEventListener\("keydown", onKey\)/, "listens on the document while open");
  assert.match(src, /return \(\) => document\.removeEventListener\("keydown", onKey\)/, "and stops when it closes");
  assert.match(src, /e\.key === "Escape" && !e\.defaultPrevented/, "a Radix layer that handled Escape (prevents default) keeps the panel open");
  assert.match(src, /onClose\(root\.current\?\.contains\(document\.activeElement\) \?\? false\)/, "it tells whether the focus was inside it");
  assert.match(src, /data-ui="orders-filters-done" onClick=\{close\}/, "Done closes the same way");
  const page = read(PAGE);
  assert.match(page, /if \(focusWasInside\) filtersButton\.current\?\.focus\(\);/, "the focus goes back to the Filters button only from inside the panel");
  assert.match(page, /filtersRef=\{filtersButton\}/, "the toolbar hands its Filters button to the page");
});

test("the popovers are named dialogs (axe aria-dialog-name), and no new control drops its outline without a focus ring", () => {
  const box = read("components/orders/OrdersDateBox.tsx");
  assert.match(box, /<PopoverContent\s+aria-label=\{picking \? "Pick a day" : "Date"\}/, "the date box's popover: 'Date', then 'Pick a day' for the calendar");
  assert.match(read(PANEL), /<PopoverContent aria-label="Pick a day"/, "the phone's Pick a day popover");
  assert.match(read(PANEL), /role="region" aria-label="Filters"/, "the Filters panel is a named region");
  // The search input alone keeps no focus look (values 4.1: the HTML's box has none; its caret shows the focus).
  for (const file of ["components/orders/OrdersToolbar.tsx", "components/orders/OrdersDateBox.tsx", PANEL]) {
    for (const cls of read(file).match(/"[^"\n]*\boutline-none\b[^"\n]*"/g) ?? []) {
      if (cls.includes("placeholder:text-subtle-foreground")) continue;
      assert.ok(cls.includes("focus-visible:ring-2"), `${file}: ${cls} drops the outline without a focus-visible ring`);
    }
  }
});

// ── The chips (values 6) ──────────────────────────────────────────────────────────────────────────────────────────

test("OrdersChips: nothing without chips; each chip 28px --accent-t / --accent-i with the 18px ✕ circle in a token tint; Clear all", () => {
  assert.equal(chipsHtml(), "", "no chip: no row (values 6 chipsD)");
  const chips = filterChips(state({ payment: "Cash", tableNo: "T-4" }), false);
  const html = chipsHtml({ chips });
  expectAll(tagOf(html, "orders-chips"), ["flex", "flex-wrap", "items-center", "gap-1.5"], "values 6 row");
  const tags = tagsOf(html, "orders-chip");
  assert.equal(tags.length, 2, "one chip per filter");
  tags.forEach((tag, i) =>
    expectAll(
      tag,
      ["flex", "h-7", "items-center", "gap-1.5", "rounded-[999px]", "border-0", "bg-accent", "pl-2.5", "pr-1.5", "text-[12.5px]", "font-semibold", "text-accent-foreground"],
      `chip ${i + 1} (values 6)`,
    ),
  );
  assert.deepEqual(tags.map((_, i) => textOf(innerOf(html, "orders-chip", i))), ["Paid by Cash✕", "T-4✕"], "the label, then the ✕");
  assert.match(tags[0], /aria-label="Remove Paid by Cash"/, "each chip says what it removes");
  expectAll(
    tagOf(html, "orders-chip-x"),
    ["flex", "size-[18px]", "items-center", "justify-center", "rounded-[50%]", "bg-primary/14", "text-[9px]"],
    "the ✕ circle: the HTML's rgba(15,98,254,.14) as the accent's 14% tint (design 6.3: follows presets and dark)",
  );
  expectAll(tagOf(html, "orders-chips-clear"), ["border-0", "bg-transparent", "px-1", "text-[12.5px]", "font-medium", "text-muted-foreground"], "values 6 Clear all");
  assert.equal(textOf(innerOf(html, "orders-chips-clear")), "Clear all", "Clear all");
});

// ── The page wires them (owner Q4, Q5; design 6.3) ───────────────────────────────────────────────────────────────

test("the /orders page: the toolbar, the Filters panel and the chips follow the lanes; the old search, selects, DatePicker and '{n} active' are gone", () => {
  const src = read(PAGE);
  assert.match(
    src,
    /<OrdersLanes\b[\s\S]*?\/>\s*<OrdersToolbar\b[\s\S]*?\/>\s*\{filtersOpen && \(\s*<OrdersFiltersPanel\b[\s\S]*?\/>\s*\)\}\s*<OrdersChips\b/,
    "lanes, toolbar, the panel while open, the chips (values 2.2: the top block's parts)",
  );
  assert.ok(!/<DatePicker\b/.test(src) && !src.includes("components/shared/DatePicker"), "no DatePicker on the page (owner Q5: the date box)");
  assert.ok(!/\bactive</.test(src) && !src.includes("activeFilterCount") && !src.includes("<Badge"), "no '{n} active' badge (design 6.3: the Filters count)");
  assert.ok(!src.includes("FilterSelect") && !src.includes("OrderFilterSelect"), "no old filter selects");
  assert.ok(!src.includes("Search orders by customer phone"), "the old search words go (owner Q4)");
  assert.ok(!/<Input\b/.test(src), "the search is the toolbar's");
  assert.match(src, /const PHONE_DEBOUNCE_MS = 350;/, "the 350 ms phone wait stays");
  assert.match(src, /count=\{chips\.length\}/, "the Filters count = the chips shown");
  assert.match(src, /filterChips\(filters, phoneWidth\)/, "the chips from the page's state, the date chip on the phone only");
  assert.match(src, /onClear=\{\(key\) => setFilter\(CHIP_CLEARS\[key\]\)\}/, "a chip clears its own filter");
  assert.match(src, /onClearAll=\{clearFilters\}/, "Clear all");
  assert.match(src, /onReset=\{clearFilters\}/, "Reset is Clear all (the HTML's ov.clear)");
  const clear = src.slice(src.indexOf("const clearFilters"), src.indexOf("};", src.indexOf("const clearFilters")));
  assert.ok(clear.includes('setPhoneInput("")'), "Clear all clears the typed phone");
  // U2 Task 5 fix round 1: through editFilters, which also counts the edit (ruling P11: it drops the chosen order).
  assert.ok(clear.includes("editFilters(clearAllFilters)"), "and the debounced one with payment and table (the date stays)");
  const search = src.slice(src.indexOf("const clearSearch"), src.indexOf("};", src.indexOf("const clearSearch")));
  assert.ok(search.includes('setPhoneInput("")') && /phone: ""/.test(search), "the ✕ clears the typed and the searched phone at once");
  assert.match(src, /onClearPhone=\{clearSearch\}/, "the ✕ goes through clearSearch");
});
