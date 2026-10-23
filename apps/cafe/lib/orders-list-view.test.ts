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
const COLS = "minmax(150px,1.3fr)_minmax(110px,1fr)_92px_124px_92px_84px";
const COLS_ITEMS = "minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(140px,1.4fr)_92px_124px_92px_84px";

test("OrderTable: the list box in its own container; the table head from a 700px list (the Items cell from 900px), values 8.1", () => {
  const html = tableHtml({ orders: ROWS });
  expectAll(tagOf(html, "orders-list-wrap"), ["@container"], "the list measures its own width (values 0.2 listW)");
  expectAll(tagOf(html, "orders-list-box"), ["overflow-hidden", "rounded-[12px]", "border", "border-border", "bg-card"], "values 8.1 list box");
  expectAll(
    tagOf(html, "orders-table-head"),
    ["hidden", "@min-[700px]:grid", `grid-cols-[${COLS}]`, `@min-[900px]:grid-cols-[${COLS_ITEMS}]`, "gap-3", "px-4", "py-2.5", "bg-surface-2", "border-b", "border-border", "text-[11px]", "font-semibold", "tracking-[.06em]", "uppercase", "text-subtle-foreground"],
    "values 8.1 head",
  );
  assert.deepEqual(textsOf(html, "orders-table-head-cell"), ["Order", "Customer", "Items", "Time", "Status", "Amount", ""], "design 11 head words");
  expectAll(tagOf(html, "orders-table-head-cell", 2), ["hidden", "@min-[900px]:block"], "the Items head from a 900px list");
  expectAll(tagOf(html, "orders-table-head-cell", 5), ["text-right"], "Amount right-aligned");
});

test("OrderTable rows: a table row and a card row per order, switched by the list's width; the whole row opens through its title button", () => {
  const html = tableHtml({ orders: ROWS, chosenId: "014" });
  const rows = tagsOf(html, "orders-row");
  const cards = tagsOf(html, "orders-card");
  assert.equal(rows.length, 4, "a table row per order");
  assert.equal(cards.length, 4, "a card row per order");
  for (const [i, tag] of rows.entries()) {
    expectAll(tag, ["relative", "hidden", "@min-[700px]:grid", `grid-cols-[${COLS}]`, `@min-[900px]:grid-cols-[${COLS_ITEMS}]`, "items-center", "gap-3", "px-4", "py-[11px]"], `table row ${i + 1} (values 8.1)`);
  }
  for (const [i, tag] of cards.entries()) {
    expectAll(tag, ["relative", "flex", "@min-[700px]:hidden", "flex-col", "gap-1.5", "px-3.5", "py-3"], `card row ${i + 1} (values 9.1)`);
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
  expectAll(tagOf(html, "orders-row-items"), ["hidden", "@min-[900px]:block", "min-w-0", "truncate", "text-[13px]", "text-muted-foreground"], "the Items cell");
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

test("OrderTable cards: tile 38, title + number, customer · items, the amount and the age (open) or the clock (settled), the pill and the due (values 9.1)", () => {
  const html = tableHtml({ orders: ROWS });
  expectAll(tagOf(html, "orders-card-tile"), ["size-[38px]", "rounded-[9px]", "text-[12px]", "font-bold"], "the 38px tile");
  expectAll(tagOf(html, "orders-card-line1"), ["block", "truncate", "text-[14.5px]", "font-semibold"], "line 1");
  assert.equal(textsOf(html, "orders-card-line1")[0], "Table T-4 #014", "the title then the number");
  expectAll(tagOf(html, "orders-card-number"), ["font-mono", "text-[11.5px]", "font-normal", "text-subtle-foreground"], "the number");
  expectAll(tagOf(html, "orders-card-line2"), ["block", "truncate", "text-[12.5px]", "text-muted-foreground"], "line 2");
  assert.equal(textsOf(html, "orders-card-line2")[0], "Walk-in · —", "customer · items");
  expectAll(tagOf(html, "orders-card-amount"), ["block", "font-mono", "text-[14.5px]", "font-semibold"], "the amount");
  assert.deepEqual(textsOf(html, "orders-card-age"), ["1h 8m", "5 min", "9:25 PM", "9:25 PM"], "the age (open) or the clock (settled)");
  expectAll(tagOf(html, "orders-card-bottom"), ["flex", "items-center", "gap-2", "pl-12"], "the bottom line under the text column");
  expectAll(tagOf(html, "orders-card-pill"), ["h-[22px]", "px-2", "text-[11.5px]", "font-semibold"], "the card pill");
  assert.deepEqual(textsOf(html, "orders-card-due"), ["₹954 due"], "the due next to the pill");
  assert.equal(tagsOf(html, "orders-card-settle").length, 0, "no action on a card (values 9.1)");
});

test("OrderTable states: 6 skeleton rows in the current form while loading; the empty box with its words and our action (values 13)", () => {
  const loading = tableHtml({ loading: true, orders: ROWS });
  assert.equal(tagsOf(loading, "orders-skeleton-row").length, 6, "6 skeleton rows");
  assert.equal(tagsOf(loading, "orders-row").length, 0, "no rows while loading");
  expectAll(tagOf(loading, "orders-skeleton-row"), ["h-[90px]", "@min-[700px]:h-[58px]"], "the card row's 90px, the table row's 58px");
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
});

test("OrdersListHead: the count in 600 --text, the scope, the sort words; the Due note under it (values 7, Q9)", () => {
  const html = renderToStaticMarkup(createElement(OrdersListHead, { head: listHead("due", 3, true, false) }));
  expectAll(tagOf(html, "orders-list-head"), ["flex", "items-baseline", "justify-between", "gap-2.5", "px-0.5", "pb-2", "text-[12.5px]", "text-muted-foreground"], "values 7 head");
  assert.deepEqual(textsOf(html, "orders-list-head-count"), ["3+"], "the count");
  expectAll(tagOf(html, "orders-list-head-count"), ["font-semibold", "text-foreground"], "600 --text");
  assert.match(html.replace(/<[^>]+>/g, ""), /^3\+ due orders/, "the left words");
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

test("OrderTable source: no View / Settle / Cancel icon buttons, no xl switch, container queries at 700px and 900px (design 6.4, values 0.2)", () => {
  const src = read(TABLE);
  assert.ok(!src.includes('aria-label="View order"'), "no 'View order' eye: the whole row opens");
  assert.ok(!src.includes('size="icon"'), "no icon buttons");
  assert.ok(!src.includes("onCancel"), "Cancel moves into the detail (design 6.9)");
  assert.ok(src.includes("@min-[700px]:"), "the table from a 700px list");
  assert.ok(src.includes("@min-[900px]:"), "the Items column from a 900px list");
  assert.ok(!/(?<![\w@[-])(?:md|lg|xl):(?:block|hidden|grid|flex)\b/.test(src), "no viewport breakpoint switch");
  assert.match(src, /onClick=\{\(\) => onChoose\(order\)\}/, "the title button and Settle call onChoose(order) (Q6)");
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
  assert.match(src, /<OrderTable[^>]*\bonChoose=\{setDetail\}/, "a row opens the order (Task 5 owns the choice)");
  const tableEnd = src.indexOf("/>", src.indexOf("<OrderTable"));
  const more = src.indexOf("<OrdersLoadMore");
  assert.ok(tableEnd > 0 && more > tableEnd, "Load more under the list box");
  const between = src.slice(tableEnd + 2, more);
  assert.ok(/^[\s{}]*$/.test(between), `Load more is not gated on rows: it shows under an empty list too (found ${JSON.stringify(between)})`);
  assert.match(src, /more=\{orders\.hasNextPage\}/, "whenever more can be loaded");
  assert.match(src, /failed=\{orders\.isFetchNextPageError\}/, "the inline retry, never the full-page error");
  assert.match(src, /onMore=\{\(\) => orders\.fetchNextPage\(\)\}/, "one request per tap");
});
