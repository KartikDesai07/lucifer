// U2 Task 4 (2026-10-23): the Orders list as drawn (docs/superpowers/specs/2026-10-22-orders-html-values.md 7 list head,
// 8 table, 9 cards, 10.3 row states, 13 empty; docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.4, 6.5,
// Q6, Q10): a render of components/orders/OrderTable.tsx (the list box with its table and card rows, skeleton and empty
// state) and OrdersListParts.tsx (the list head, Load more), and source pins on app/(dashboard)/orders/page.tsx, which
// places them in the scroller and reads the clock once a minute (no request). The words: orders-row.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf } from "./class-tags.fixtures";
import { STATUS_CLASSES } from "./ui";
import { listHead } from "./orders-row";
import { ORDERS_SCROLLER_CLASS } from "./orders-layout";
import { NOW, minutesBefore, order, printed, settled } from "./orders-lanes.fixtures";
import { OrderTable } from "@/components/orders/OrderTable";
import { OrdersListHead, OrdersLoadMore } from "@/components/orders/OrdersListParts";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (as orders-lanes-view.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const PAGE = "app/(dashboard)/orders/page.tsx";
const TABLE = "components/orders/OrderTable.tsx";

const noop = (): void => undefined;
const tableHtml = (props: Partial<Parameters<typeof OrderTable>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(OrderTable, { orders: [], now: NOW, chosenId: null, onChoose: noop, loading: false, empty: null, ...props }),
  );
const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];
/** The text of every element carrying data-ui="<name>" (its own closing tag found by nesting depth). */
const textsOf = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`<([a-z0-9]+) [^>]*data-ui="${name}"[^>]*>`, "g"))].map((open) => {
    const start = (open.index ?? 0) + open[0].length;
    const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g");
    re.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = m.index;
        break;
      }
    }
    return html.slice(start, end).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
  });

const ROWS = [
  printed("014", { tableNo: "T-4", total: 1063, tokenNumber: 12, createdAt: minutesBefore(68) }),
  order("015", { createdAt: minutesBefore(5) }),
  settled("016", 954, 0, "Due"),
  order("017", { status: "Cancelled", total: 768 }),
];
// Ruling P7: the Order and Customer columns give way (min 0) where the HTML's 150 / 110 minimums would overflow the
// box (t820: the HTML clips Settle); at a 764px list they are still 157.125 / 120.875. The Items variant is the HTML's.
const COLS = "minmax(0,1.3fr)_minmax(0,1fr)_92px_124px_92px_84px";
const COLS_ITEMS = "minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(140px,1.4fr)_92px_124px_92px_84px";

// The verification fix (V-A, classic scrollbars; moved on purpose): the list box's own container sat INSIDE the list
// scroller, so a classic (Windows, Electron) scrollbar of ~15px narrowed it and moved the HTML's thresholds (1024 lost the
// Items column, 820 became cards when the list overflowed). The form is measured on the list column now — the named
// container `list` (lib/orders-layout.ts ORDERS_LIST_COLUMN_CLASS), outside the scroller — at the HTML's listW
// thresholds plus the scroller's 20 + 20 side padding: the table from a 740px column, the Items column from 940px.
test("OrderTable: the list box, measured on the list column (no container of its own inside the scroller); the table head from a 740px column = a 700px list (the Items cell from 940px = 900px), values 8.1", () => {
  const html = tableHtml({ orders: ROWS });
  assert.equal(tagOf(html, "orders-list-wrap"), "", "no wrapper container of its own: the scroller's scrollbar cannot narrow what is measured");
  assert.match(html, /^<div data-ui="orders-list-box"/, "the list box is the outermost element");
  assert.ok(!html.includes("@container"), "no container inside the list: its queries reach the list column's named one");
  expectAll(tagOf(html, "orders-list-box"), ["overflow-hidden", "rounded-[12px]", "border", "border-border", "bg-card"], "values 8.1 list box");
  expectAll(
    tagOf(html, "orders-table-head"),
    ["hidden", "@min-[740px]/list:grid", `grid-cols-[${COLS}]`, `@min-[940px]/list:grid-cols-[${COLS_ITEMS}]`, "gap-3", "px-4", "py-2.5", "bg-surface-2", "border-b", "border-border", "text-[11px]", "font-semibold", "tracking-[.06em]", "uppercase", "text-subtle-foreground"],
    "values 8.1 head",
  );
  assert.deepEqual(textsOf(html, "orders-table-head-cell"), ["Order", "Customer", "Items", "Time", "Status", "Amount", ""], "design 11 head words");
  expectAll(tagOf(html, "orders-table-head-cell", 2), ["hidden", "@min-[940px]/list:block"], "the Items head from a 940px column (a 900px list)");
  expectAll(tagOf(html, "orders-table-head-cell", 5), ["text-right"], "Amount right-aligned");
});

test("OrderTable rows: a table row and a card row per order, switched by the list's width; the whole row opens through its title button", () => {
  const html = tableHtml({ orders: ROWS, chosenId: "014" });
  const rows = tagsOf(html, "orders-row");
  const cards = tagsOf(html, "orders-card");
  assert.equal(rows.length, 4, "a table row per order");
  assert.equal(cards.length, 4, "a card row per order");
  for (const [i, tag] of rows.entries()) {
    expectAll(tag, ["relative", "hidden", "@min-[740px]/list:grid", `grid-cols-[${COLS}]`, `@min-[940px]/list:grid-cols-[${COLS_ITEMS}]`, "items-center", "gap-3", "px-4", "py-[11px]"], `table row ${i + 1} (values 8.1)`);
  }
  for (const [i, tag] of cards.entries()) {
    expectAll(tag, ["relative", "flex", "@min-[740px]/list:hidden", "flex-col", "gap-1.5", "px-3.5", "py-3"], `card row ${i + 1} (values 9.1)`);
  }
  expectAll(rows[0], ["border-t-0", "bg-accent"], "the first row has no top rule; the chosen row on --accent-t");
  expectAll(rows[1], ["border-t", "border-border-2", "hover:bg-hover"], "the next rows: a --border-2 rule, the intended --hover");
  assert.ok(!classesOf(rows[1]).includes("bg-accent"), "an unchosen row is not tinted");
  assert.equal(tagsOf(html, "orders-row-bar").length, 1, "the selection bar on the chosen row only");
  expectAll(tagOf(html, "orders-row-bar"), ["absolute", "left-0", "top-2", "bottom-2", "w-[3px]", "rounded-r-[3px]", "bg-primary"], "values 8.1 bar");
  expectAll(tagOf(html, "orders-card-bar"), ["absolute", "left-0", "top-2.5", "bottom-2.5", "w-[3px]", "rounded-r-[3px]", "bg-primary"], "values 9.1 bar");

  const opens = tagsOf(html, "orders-row-open");
  assert.equal(opens.length, 4, "every table row has its title button");
  for (const tag of [...opens, ...tagsOf(html, "orders-card-open")]) {
    assert.match(tag, /^<button type="button"/, "the title is a real button");
    expectAll(tag, ["after:absolute", "after:inset-0"], "stretched over the row by an ::after layer");
    expectAll(tag, ["outline-none", "focus-visible:after:ring-2", "focus-visible:after:ring-inset", "focus-visible:after:ring-ring"], "its focus ring rings the whole row");
  }
  assert.match(opens[0], /aria-label="Table T-4 #014"/, "its name: the title and the number");
  assert.match(opens[0], /aria-current="true"/, "the chosen row says so");
  assert.ok(!/aria-current/.test(opens[1]), "an unchosen row carries no aria-current");
  assert.match(tagsOf(html, "orders-card-open")[0], /aria-current="true"/, "the chosen card says so too");
  const buttons = [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.ok(buttons.length > 0, "landmark: buttons render");
  for (const b of buttons) assert.ok(!/<button\b/.test(b.slice(7)), `no control inside another (axe nested-interactive): ${b.slice(0, 80)}`);
});

test("OrderTable row cells: tile, title, sub, customer, items, time and age, the pill, the amount, the due line and Settle (values 8.1, 10.3)", () => {
  const html = tableHtml({ orders: ROWS, chosenId: "014" });
  assert.deepEqual(textsOf(html, "orders-row-tile"), ["T4", "WI", "WI", "WI"], "the code tiles");
  expectAll(tagOf(html, "orders-row-tile", 0), ["size-9", "flex-none", "rounded-[9px]", "text-[12px]", "font-bold", "bg-status-bill-tint", "text-status-bill-ink"], "a billed tab's tile");
  expectAll(tagOf(html, "orders-row-tile", 1), ["bg-surface-3", "text-foreground"], "a plain tile");
  expectAll(tagOf(html, "orders-row-title"), ["block", "truncate", "text-[14px]", "font-semibold"], "values 8.1 title");
  expectAll(tagOf(html, "orders-row-sub"), ["block", "truncate", "font-mono", "text-[11.5px]", "text-subtle-foreground"], "the sub never wraps (design 6.4)");
  assert.equal(textsOf(html, "orders-row-sub")[0], "#014 · Dine-in · Token 12", "the sub");
  assert.deepEqual(textsOf(html, "orders-row-customer"), ["Walk-in", "Walk-in", "Walk-in", "Walk-in"], "walk-ins");
  expectAll(tagOf(html, "orders-row-customer-sub"), ["block", "truncate", "text-[12px]", "text-subtle-foreground"], "values 8.1 customer sub");
  expectAll(tagOf(html, "orders-row-items"), ["hidden", "@min-[940px]/list:block", "min-w-0", "truncate", "text-[13px]", "text-muted-foreground"], "the Items cell");
  expectAll(tagOf(html, "orders-row-time"), ["block", "whitespace-nowrap", "text-[13px]"], "the time");
  assert.equal(textsOf(html, "orders-row-time")[0], "8:22 PM", "the clock time");
  assert.equal(textsOf(html, "orders-row-age")[0], "Open 1h 8m", "the age");
  expectAll(tagOf(html, "orders-row-age", 0), ["text-[12px]", "font-semibold", "text-status-bad-ink"], "an hour open: --bad-i 600");
  expectAll(tagOf(html, "orders-row-age", 1), ["font-normal", "text-subtle-foreground"], "a fresh tab: --text-3 400");
  expectAll(tagOf(html, "orders-row-pill", 0), ["inline-flex", "h-6", "items-center", "gap-1.5", "rounded-[999px]", "px-[9px]", "text-[12px]", "font-semibold", "whitespace-nowrap", ...STATUS_CLASSES.bill.pill.split(" ")], "Bill printed");
  expectAll(tagOf(html, "orders-row-dot", 1), ["size-1.5", "rounded-[50%]", STATUS_CLASSES.info.dot], "In kitchen's dot");
  assert.deepEqual(textsOf(html, "orders-row-pill"), ["Bill printed", "In kitchen", "Due", "Cancelled"], "the pills (design 6.4)");
  expectAll(tagOf(html, "orders-row-amount", 0), ["block", "font-mono", "text-[14px]", "font-semibold"], "values 8.1 amount");
  expectAll(tagOf(html, "orders-row-amount", 3), ["line-through", "text-subtle-foreground"], "a cancelled amount is struck");
  assert.deepEqual(textsOf(html, "orders-row-due"), ["₹954 due"], "the due line under a due bill's amount");
  expectAll(tagOf(html, "orders-row-due"), ["block", "text-[11.5px]", "font-semibold", "text-status-bill-ink"], "values 8.1 due line");
  const settles = tagsOf(html, "orders-row-settle");
  assert.equal(settles.length, 2, "Settle on the open tabs only (no Collect, design 6.4)");
  expectAll(
    settles[0],
    ["relative", "z-[1]", "flex", "h-8", "items-center", "rounded-[8px]", "border", "border-border", "bg-card", "px-3", "text-[12.5px]", "font-semibold", "whitespace-nowrap", "text-foreground", "hover:bg-ink", "hover:text-on-ink", "hover:border-ink"],
    "values 8.1 Settle, its text centred (design 8), above the row's layer",
  );
  assert.deepEqual(textsOf(html, "orders-row-settle"), ["Settle", "Settle"], "the word");
});

test("OrderTable cards: tile 38, title + number, customer · items, the amount and the age (open), the clock (closed today) or the day (closed before), the pill and the due (values 9.1, Ruling P18)", () => {
  const html = tableHtml({ orders: ROWS });
  expectAll(tagOf(html, "orders-card-tile"), ["size-[38px]", "rounded-[9px]", "text-[12px]", "font-bold"], "the 38px tile");
  expectAll(tagOf(html, "orders-card-line1"), ["block", "truncate", "text-[14.5px]", "font-semibold"], "line 1");
  assert.equal(textsOf(html, "orders-card-line1")[0], "Table T-4 #014", "the title then the number");
  expectAll(tagOf(html, "orders-card-number"), ["font-mono", "text-[11.5px]", "font-normal", "text-subtle-foreground"], "the number");
  expectAll(tagOf(html, "orders-card-line2"), ["block", "truncate", "text-[12.5px]", "text-muted-foreground"], "line 2");
  assert.equal(textsOf(html, "orders-card-line2")[0], "Walk-in · —", "customer · items");
  expectAll(tagOf(html, "orders-card-amount"), ["block", "font-mono", "text-[14.5px]", "font-semibold"], "the amount");
  assert.deepEqual(textsOf(html, "orders-card-age"), ["1h 8m", "5 min", "9:25 PM", "9:25 PM"], "the age (open) or the clock (closed today)");
  // Ruling P18 (the verification fix, V-B): over All dates / Yesterday / a picked day, closed rows of another day read
  // their day ("17 Oct") where today's read the clock, so "#014" of two days never look alike; the table row's line
  // under its time already reads the day.
  const older = tableHtml({
    orders: [
      { ...settled("020", 500, 500), createdAt: "2026-10-17T14:46:00.000Z" },
      order("021", { status: "Cancelled", createdAt: "2026-10-18T10:00:00.000Z", cancelledAt: "2026-10-18T12:00:00.000Z" }),
    ],
  });
  assert.deepEqual(textsOf(older, "orders-card-age"), ["17 Oct", "18 Oct"], "a closed card of another day: its day (a cancelled one its cancel day)");
  assert.deepEqual(textsOf(older, "orders-row-age"), ["17 Oct", "18 Oct"], "the table row's line: the same day");
  assert.deepEqual(textsOf(older, "orders-row-time"), ["8:16 PM", "5:30 PM"], "the table row's time stays the clock");
  expectAll(tagOf(html, "orders-card-bottom"), ["flex", "items-center", "gap-2", "pl-12"], "the bottom line under the text column");
  expectAll(tagOf(html, "orders-card-pill"), ["h-[22px]", "px-2", "text-[11.5px]", "font-semibold"], "the card pill");
  assert.deepEqual(textsOf(html, "orders-card-due"), ["₹954 due"], "the due next to the pill");
  assert.equal(tagsOf(html, "orders-card-settle").length, 0, "no action on a card (values 9.1)");
});

test("OrderTable states: 6 skeleton rows in the current form while loading; the empty box with its words and our action (values 13)", () => {
  const loading = tableHtml({ loading: true, orders: ROWS });
  assert.equal(tagsOf(loading, "orders-skeleton-row").length, 6, "6 skeleton rows");
  assert.equal(tagsOf(loading, "orders-row").length, 0, "no rows while loading");
  expectAll(tagOf(loading, "orders-skeleton-row"), ["h-[90px]", "@min-[740px]/list:h-[58px]"], "the card row's 90px, the table row's 58px");
  assert.ok(tagOf(loading, "orders-table-head").length > 0, "the table head stays");
  const action = createElement("button", { type: "button", "data-ui": "probe-action" }, "Clear filters");
  const empty = tableHtml({ empty: { title: "No due orders today", text: "They will show up here as they happen." }, emptyAction: action });
  expectAll(tagOf(empty, "orders-empty"), ["flex", "flex-col", "items-center", "gap-1.5", "px-4", "py-14", "text-center"], "values 13 empty box");
  assert.deepEqual(textsOf(empty, "orders-empty-title"), ["No due orders today"], "the title");
  expectAll(tagOf(empty, "orders-empty-title"), ["text-[14px]", "font-semibold"], "14px 600");
  assert.deepEqual(textsOf(empty, "orders-empty-text"), ["They will show up here as they happen."], "the text");
  expectAll(tagOf(empty, "orders-empty-text"), ["text-[13px]", "text-muted-foreground"], "13px --text-2");
  assert.ok(empty.indexOf("probe-action") > empty.indexOf("orders-empty-text"), "our action under the words");
  assert.ok(empty.indexOf("orders-empty") > empty.indexOf("orders-list-box"), "inside the list box, after the head");
  // design 6.5 (fix round 1): the offline line sits INSIDE the list box, under the table head, in place of the rows.
  const line = createElement("p", { role: "status", "data-ui": "probe-offline" }, "You appear to be offline.");
  const offline = tableHtml({ notice: line, orders: ROWS, loading: true, empty: { title: "x", text: "y" } });
  const box = offline.indexOf('data-ui="orders-list-box"');
  const head = offline.indexOf('data-ui="orders-table-head"');
  const at = offline.indexOf('data-ui="probe-offline"');
  assert.ok(box >= 0 && head > box && at > head, "the notice renders inside the list box, after the table head");
  assert.equal(tagsOf(offline, "orders-row").length + tagsOf(offline, "orders-skeleton-row").length + tagsOf(offline, "orders-empty").length, 0, "the notice takes the rows' place");
  expectAll(tagOf(tableHtml({ notice: line }), "orders-list-box"), ["overflow-hidden", "rounded-[12px]", "border", "bg-card"], "the same list box frame");
});

test("Ruling P7: the Order and Customer columns give way (min 0) only where the HTML's minimums would overflow; the Items variant is the HTML's", () => {
  const src = read(TABLE);
  assert.ok(src.includes(`"grid-cols-[${COLS}] @min-[940px]/list:grid-cols-[${COLS_ITEMS}]"`), "COLS_CLASS: min 0 without Items, the HTML's minimums with Items");
  // values 8.2: at a 764px list (c1280) the box's content is 730 - 392 fixed - 60 gaps = 278 = 2.3fr, so the fr columns
  // are 157.125 / 120.875 with either minimum; at 704 (t820) 670 - 452 = 218 < 150 + 110, so min 0 keeps Settle whole.
  const fr = (listW: number): number => (listW - 2 - 32 - 392 - 60) / 2.3;
  assert.ok(Math.abs(fr(764) * 1.3 - 157.125) < 0.01 && Math.abs(fr(764) - 120.875) < 0.01, "c1280 widths unchanged");
  assert.ok(fr(704) * 1.3 < 150 && fr(704) * 2.3 + 452 === 670, "t820: the HTML's minimums would overflow; min 0 fits the box");
});

// The verification fix (V-A): the HTML's form is a function of listW = the list column's width minus the list padding
// (values 0.2: 20 + 20 from 720px, 12 + 12 on the phone); ours of the column's own width (a named container outside the
// scroller, so no scrollbar takes part). For every column width they agree, and at the plan's viewports they land where
// the compare has them: d1280 cards, c1280 table, t1024 table + Items (the owner's no-column rule), t820 table, p390 cards.
test("the list's form on the list column equals the HTML's on listW at every width (thresholds = 700 / 900 + the scroller's 20 + 20); a scrollbar never moves them", () => {
  const src = read(TABLE);
  const at = (re: RegExp, what: string): number => {
    const m = re.exec(src);
    assert.ok(m, `landmark: ${what}`);
    return Number(m![1]);
  };
  const tableFrom = at(/"hidden @min-\[(\d+)px\]\/list:grid /, "the table head's switch");
  const itemsFrom = at(/ITEMS_CLASS = "hidden @min-\[(\d+)px\]\/list:block /, "the Items cell's switch");
  assert.equal(at(/CARD_CLASS = "relative flex @min-\[(\d+)px\]\/list:hidden /, "the cards' switch"), tableFrom, "the cards hide exactly where the table shows");
  // The list padding the HTML subtracts is the scroller's own (lib/orders-layout.ts): px-5 (20) from 720px, px-3 (12) below.
  const pads = ORDERS_SCROLLER_CLASS.split(/\s+/);
  assert.ok(pads.includes("px-5") && pads.includes("max-tab:px-3"), "the scroller's side padding: 20 + 20, 12 + 12 on the phone (values 2.2 listPad)");
  const PHONE_BELOW = 720;
  const html = (col: number): string => {
    const listW = col - (col < PHONE_BELOW ? 24 : 40);
    return listW >= 900 ? "table+items" : listW >= 700 ? "table" : "cards";
  };
  const ours = (col: number): string => (col >= itemsFrom ? "table+items" : col >= tableFrom ? "table" : "cards");
  for (let col = 280; col <= 1700; col += 1) assert.equal(ours(col), html(col), `a ${col}px list column`);
  const SCROLLBAR = 15;
  for (const col of [744, 948]) assert.equal(ours(col), html(col), `${col}: the column is measured, so a ${SCROLLBAR}px scrollbar inside the scroller changes nothing`);
  // The plan's viewports (values 0.2: the nav 232 / 76; the detail column 400 from 1280; none below 1280, owner rule).
  const viewports: [string, number, string][] = [
    ["d1280", 1280 - 232 - 400, "cards"],
    ["c1280", 1280 - 76 - 400, "table"],
    ["t1024", 1024 - 76, "table+items"],
    ["t820", 820 - 76, "table"],
    ["p390", 390, "cards"],
    ["x1600", 1600 - 232 - 400, "table+items"],
  ];
  for (const [name, col, form] of viewports) assert.equal(ours(col), form, `${name} (a ${col}px column): ${form}, as the compare rows have it`);
});

test("OrdersListHead: the count in 600 --text, the scope, the sort words; the Due note under it (values 7, Q9)", () => {
  const html = renderToStaticMarkup(createElement(OrdersListHead, { head: listHead("due", 3, true, false) }));
  expectAll(tagOf(html, "orders-list-head"), ["flex", "items-baseline", "justify-between", "gap-2.5", "px-0.5", "pb-2", "text-[12.5px]", "text-muted-foreground"], "values 7 head");
  assert.deepEqual(textsOf(html, "orders-list-head-count"), ["3+"], "the count");
  expectAll(tagOf(html, "orders-list-head-count"), ["font-semibold", "text-foreground"], "600 --text");
  assert.match(html.replace(/<[^>]+>/g, ""), /^3\+ due orders/, "the left words");
  assert.deepEqual(textsOf(html, "orders-list-head-scope"), ["due orders"], "the scope words, their own field (listHead's scope)");
  assert.ok(!read("components/orders/OrdersListParts.tsx").includes(".slice(head.count.length)"), "no slicing of the left line");
  assert.deepEqual(textsOf(html, "orders-list-head-sort"), ["Newest first"], "the sort words");
  assert.deepEqual(textsOf(html, "orders-list-due-note"), ["Dues paid later are on the Customers page."], "the Due note (Q9)");
  expectAll(tagOf(html, "orders-list-due-note"), ["text-[12.5px]", "text-subtle-foreground"], "12.5px --text-3");
  const open = renderToStaticMarkup(createElement(OrdersListHead, { head: listHead("open", 8, false, false) }));
  assert.equal(tagOf(open, "orders-list-due-note"), "", "no note off the Due lane");
  const waiting = renderToStaticMarkup(createElement(OrdersListHead, { head: null }));
  expectAll(tagOf(waiting, "orders-list-head"), ["h-[25px]"], "before the list loads the head keeps its 25px");
});

test("OrdersLoadMore: a 40px button in the Filters button's look; Load more / Loading… / Retry; the error line above it", () => {
  const more = (p: Partial<Parameters<typeof OrdersLoadMore>[0]>) =>
    renderToStaticMarkup(createElement(OrdersLoadMore, { more: true, loading: false, failed: false, onMore: noop, ...p }));
  const html = more({});
  expectAll(tagOf(html, "orders-more"), ["flex", "flex-col", "items-center", "gap-2"], "centred under the list box");
  expectAll(tagOf(html, "orders-more-button"), ["h-10", "rounded-[9px]", "border", "border-border", "bg-card", "text-[13.5px]", "font-medium"], "the Filters button's look");
  assert.deepEqual(textsOf(html, "orders-more-button"), ["Load more"], "Load more");
  assert.deepEqual(textsOf(more({ loading: true }), "orders-more-button"), ["Loading…"], "Loading…");
  assert.match(tagOf(more({ loading: true }), "orders-more-button"), /disabled=""/, "one request per tap: disabled while loading");
  const failed = more({ failed: true });
  assert.deepEqual(textsOf(failed, "orders-more-button"), ["Retry"], "Retry");
  assert.deepEqual(textsOf(failed, "orders-more-error"), ["Couldn't load more orders. Check the connection, then tap Retry."], "the error words");
  expectAll(tagOf(failed, "orders-more-error"), ["text-[12.5px]", "text-status-bad-ink"], "12.5px --bad-i");
  assert.ok(failed.indexOf("orders-more-error") < failed.indexOf("orders-more-button"), "the error line above the button");
  assert.equal(more({ more: false }), "", "nothing when nothing more can be loaded");
});

test("OrderTable source: no View / Settle / Cancel icon buttons, no xl switch, queries on the list column at 740px and 940px (design 6.4, values 0.2)", () => {
  const src = read(TABLE);
  assert.ok(!src.includes('aria-label="View order"'), "no 'View order' eye: the whole row opens");
  assert.ok(!src.includes('size="icon"'), "no icon buttons");
  assert.ok(!src.includes("onCancel"), "Cancel moves into the detail (design 6.9)");
  assert.ok(src.includes("@min-[740px]/list:"), "the table from a 740px column (a 700px list)");
  assert.ok(src.includes("@min-[940px]/list:"), "the Items column from a 940px column (a 900px list)");
  assert.ok(!/@min-\[\d+px\]:/.test(src), "no unnamed container query (it would measure a nearer container)");
  assert.ok(!src.includes("@container"), "no container of its own inside the scroller (a classic scrollbar would narrow it)");
  assert.ok(!/(?<![\w@[-])(?:md|lg|xl):(?:block|hidden|grid|flex)\b/.test(src), "no viewport breakpoint switch");
  // Each button's own handler (fix round 1): the opening tag of the element carrying the data-ui must call onChoose.
  for (const ui of ["orders-row-open", "orders-card-open", "orders-row-settle"]) {
    const at = src.indexOf(`data-ui="${ui}"`);
    assert.ok(at > 0, `landmark: ${ui}`);
    const start = src.lastIndexOf("<button", at);
    const tag = src.slice(start, src.indexOf(">\n", at) + 1);
    assert.match(tag, /\sonClick=\{\(\) => onChoose\(order\)\}/, `${ui} itself calls onChoose(order) (Q6: Settle opens the detail)`);
  }
});

// ── The page places them (design 6.5) and reads the clock once a minute ──────────────────────────────────────────

test("the /orders page: one minute tick for the query's day, the lanes and the row ages (no request)", () => {
  const src = read(PAGE);
  assert.match(src, /import \{ useNow \} from "@\/hooks\/use-now";/, "the shared tick");
  assert.match(src, /const MINUTE_TICK_MS = 60_000;/, "once a minute");
  assert.match(src, /const now = useNow\(MINUTE_TICK_MS\) \?\? new Date\(\);/, "the page's one clock, from the shared tick");
  assert.equal(src.split("new Date()").length - 1, 1, "no other clock read on the page");
  assert.match(src, /useOrdersInfinite\(ordersQuery\(filters, now\)\)/, "the query's day follows the tick (past midnight Today is the new day)");
  assert.match(src, /<OrdersLanes[^>]*\bnow=\{now\}/, "the Open card's 30+ min line follows the tick");
  assert.match(src, /<OrderTable[^>]*\bnow=\{now\}/, "the row ages follow the tick");
});

test("the /orders page: the list head, the list box, Load more under it (also under an empty Paid / Due list, Q10); the interim wrapper is gone", () => {
  const src = read(PAGE);
  assert.ok(!src.includes('<div className="flex flex-col gap-4">'), "the Task 1 interim wrapper goes");
  assert.ok(!src.includes("<EmptyState") && !src.includes("No orders yet"), "today's 'No orders yet' and its New order button go (design 6.5)");
  assert.match(
    src,
    /const head = orders\.data === undefined \? null : listHead\(filters\.lane, shown\.length, orders\.hasNextPage, searching\);/,
    "the head counts the rows shown once the list has loaded",
  );
  assert.match(src, /<OrdersListHead head=\{head\} \/>\s*<OrderTable\b/, "the head over the list box");
  assert.match(src, /emptyText\(\{[^}]*\bloaded: list\.length\b[^}]*\}\)/, "the empty words count the loaded settled orders (Q10)");
  assert.match(src, /emptyText\(\{[^}]*\bmore: orders\.hasNextPage\b[^}]*\}\)/, "and know when more can be loaded");
  // Ruling P5: only the payment and the table are filters (never the date, the phone's chip included; the phone search
  // keeps its own words), and "Clear filters" shows exactly when the filters words show.
  assert.match(src, /const filtersOn = Boolean\(filters\.payment \|\| filters\.tableNo\);/, "filters = the payment and the table only");
  assert.match(src, /emptyText\(\{[^}]*\bfiltersOn,[^}]*\}\)/, "the empty words read that flag");
  assert.ok(!/filtersOn: chips\.length/.test(src), "the chips (the phone's date chip among them) never make the filters words");
  assert.match(src, /emptyAction=\{\s*filtersOn && !searching \?/, "Clear filters with the filters words only (a search's words win)");
  assert.match(src, /<OrderTable[^>]*\bonChoose=\{setDetail\}/, "a row opens the order (Task 5 owns the choice)");
  assert.match(
    src,
    /<OrderTable\b[\s\S]*?\bnotice=\{\s*orders\.isPaused && !orders\.data \? \(\s*<p role="status" className=\{ORDERS_OFFLINE_CLASS\}>/,
    "the offline line goes INTO the list box (design 6.5), under the table head",
  );
  const tableEnd = src.indexOf("/>", src.indexOf("<OrderTable"));
  const more = src.indexOf("<OrdersLoadMore");
  assert.ok(tableEnd > 0 && more > tableEnd, "Load more under the list box");
  const between = src.slice(tableEnd + 2, more);
  assert.ok(/^[\s{}]*$/.test(between), `Load more is not gated on rows: it shows under an empty list too (found ${JSON.stringify(between)})`);
  assert.match(src, /more=\{orders\.hasNextPage\}/, "whenever more can be loaded");
  assert.match(src, /failed=\{orders\.isFetchNextPageError\}/, "the inline retry, never the full-page error");
  assert.match(src, /onMore=\{\(\) => orders\.fetchNextPage\(\)\}/, "one request per tap");
});
