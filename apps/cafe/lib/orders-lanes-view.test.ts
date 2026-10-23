// U2 Task 2 (2026-10-23): the Orders lanes as drawn (docs/superpowers/specs/2026-10-22-orders-html-values.md 3.2 cards,
// 3.3 phone strip; docs/superpowers/specs/2026-10-23-orders-match-html-design.md Q1, Q2, Q4, Q11, 6.2): a render of
// components/orders/OrdersLanes.tsx, and source pins on app/(dashboard)/orders/page.tsx, which owns the state and wires
// the lanes in (the status select goes, owner Q2).
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
import { DEFAULT_ORDERS_FILTERS, laneRows } from "./orders-lanes";
import { order, printed, settled, state } from "./orders-lanes.fixtures";
import { OrdersLanes } from "@/components/orders/OrdersLanes";
import type { Order } from "@/types";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (as common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const PAGE = "app/(dashboard)/orders/page.tsx";

// ── The lanes as drawn (values 3.2 cards, 3.3 phone strip; five lanes, owner Q1/Q2) ──────────────────────────────

const noop = (): void => undefined;
const lanesHtml = (props: Partial<Parameters<typeof OrdersLanes>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(OrdersLanes, {
      filters: DEFAULT_ORDERS_FILTERS,
      rows: [],
      more: false,
      loaded: true,
      onLane: noop,
      onChoose: noop,
      ...props,
    }),
  );
const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];
/** The inner HTML of the nth element carrying data-ui="<name>" (its own closing tag found by nesting depth). */
const innerOf = (html: string, name: string, nth = 0): string => {
  const open = [...html.matchAll(new RegExp(`<([a-z0-9]+) [^>]*data-ui="${name}"[^>]*>`, "g"))][nth];
  assert.ok(open, `landmark: data-ui="${name}" #${nth + 1} renders`);
  const tagName = open[1];
  let depth = 1;
  const i = (open.index ?? 0) + open[0].length;
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "g");
  re.lastIndex = i;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(i, m.index);
  }
  return html.slice(i);
};
const textOf = (h: string): string => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

test("OrdersLanes: a container holding the five cards (a list 560px or wider) and the phone strip (narrower)", () => {
  const html = lanesHtml();
  expectAll(tagOf(html, "orders-lanes"), ["@container"], "the lanes measure their own width (values 0.2 phoneLanes)");
  expectAll(tagOf(html, "orders-lane-cards"), ["hidden", "@min-[560px]:grid", "grid-cols-5", "gap-2"], "values 3.2 grid, five columns (Q2)");
  expectAll(
    tagOf(html, "orders-lane-strip"),
    ["flex", "flex-col", "@min-[560px]:hidden", "overflow-hidden", "rounded-[14px]", "border", "border-border", "bg-card"],
    "values 3.3 strip frame",
  );
  assert.equal(tagsOf(html, "orders-lane-card").length, 5, "five cards");
  assert.equal(tagsOf(html, "orders-lane-tab").length, 5, "five strip tabs");
});

test("OrdersLanes cards: the chosen lane (Open) has the 2px --text outline, its count, total and line; the others an empty number row and a fixed line", () => {
  const rows = laneRows("open", [order("3", { total: 768 }), printed("1", { total: 1063, tableNo: "T-1" })], false);
  const html = lanesHtml({ rows });
  const cards = tagsOf(html, "orders-lane-card");
  const base = ["flex", "min-w-0", "flex-col", "items-start", "gap-[3px]", "rounded-[12px]", "border", "bg-card", "pt-[11px]", "px-3.5", "pb-3", "text-left", "text-foreground", "hover:border-subtle-foreground"];
  cards.forEach((tag, i) => expectAll(tag, base, `card ${i + 1} (values 3.2)`));
  expectAll(cards[1], ["border-foreground", "[box-shadow:0_0_0_1px_var(--foreground)]"], "the chosen card's outline");
  assert.match(cards[1], /aria-pressed="true"/, "the chosen card is pressed");
  for (const i of [0, 2, 3, 4]) {
    expectAll(cards[i], ["border-border"], `card ${i + 1} is not chosen`);
    assert.ok(!classesOf(cards[i]).some((c) => c.includes("box-shadow")), `card ${i + 1} has no outline`);
    assert.match(cards[i], /aria-pressed="false"/, `card ${i + 1} is not pressed`);
  }
  assert.equal(textOf(innerOf(html, "orders-lane-num", 1)), "2₹1,831", "the chosen card's count and total");
  for (const i of [0, 2, 3, 4]) assert.equal(innerOf(html, "orders-lane-num", i), "", `card ${i + 1}'s number row stays empty (Q1)`);
  expectAll(tagOf(html, "orders-lane-num", 0), ["flex", "h-7", "min-w-0", "max-w-full", "items-baseline", "gap-2"], "every number row keeps its 28px height");
  assert.deepEqual(
    tagsOf(html, "orders-lane-line").map((_, i) => textOf(innerOf(html, "orders-lane-line", i))),
    ["Every order", "1 bill waiting to be paid", "Settled bills", "Money still owed", "Not charged"],
    "the chosen card's line and the others' fixed lines",
  );
  expectAll(tagOf(html, "orders-lane-line", 1), ["text-status-warn-ink"], "bills waiting reads in --warn-i");
  expectAll(tagOf(html, "orders-lane-line", 0), ["text-subtle-foreground"], "a fixed line reads in --text-3");
  expectAll(tagOf(html, "orders-lane-count", 0), ["text-[22px]", "font-semibold", "tracking-[-0.02em]"], "values 3.2 count");
  expectAll(tagOf(html, "orders-lane-amount", 0), ["font-mono", "text-[13px]", "text-muted-foreground", "truncate"], "values 3.2 amount");
  expectAll(tagOf(html, "orders-lane-head", 0), ["flex", "items-center", "gap-[7px]", "text-[12.5px]", "font-medium", "text-muted-foreground"], "values 3.2 head");
  expectAll(tagOf(html, "orders-lane-dot", 1), ["size-2", "rounded-[50%]", STATUS_CLASSES.info.dot], "Open's 8px --info dot");
});

test("OrdersLanes strip: the chosen tab shows its dot and count, the others the dot alone; the current row the total, the line and Settle {code}", () => {
  const rows = laneRows("open", [order("3", { total: 768 }), printed("1", { total: 1063, tableNo: "T-1" })], false);
  const chosen: Order[] = [];
  const html = lanesHtml({ rows, onChoose: (o) => chosen.push(o) });
  const tabs = tagsOf(html, "orders-lane-tab");
  assert.match(html, /role="tablist"/, "the tabs are a tablist (values 3.3)");
  tabs.forEach((tag, i) => {
    assert.match(tag, /role="tab"/, `tab ${i + 1} is a tab`);
    expectAll(tag, ["relative", "flex", "h-[50px]", "min-w-0", "flex-col", "items-center", "justify-center", "gap-0.5", "px-0.5"], `tab ${i + 1} (values 3.3)`);
  });
  assert.match(tabs[1], /aria-selected="true"/, "Open is the selected tab");
  expectAll(tabs[1], ["bg-card"], "the chosen tab on --surface");
  for (const i of [0, 2, 3, 4]) {
    assert.match(tabs[i], /aria-selected="false"/, `tab ${i + 1} is not selected`);
    expectAll(tabs[i], ["bg-surface-2"], `tab ${i + 1} on --surface-2`);
  }
  assert.equal(tagsOf(html, "orders-lane-tab-count").length, 1, "only the chosen tab shows a count (Q1)");
  assert.equal(textOf(innerOf(html, "orders-lane-tab-count")), "2", "the chosen tab's count");
  expectAll(tagOf(html, "orders-lane-tab-count"), ["text-[19px]", "font-semibold", "tracking-[-0.02em]", "leading-none"], "values 3.3 count");
  expectAll(tagOf(html, "orders-lane-current"), ["flex", "min-w-0", "items-center", "gap-2.5", "px-3", "py-[7px]"], "values 3.3 current row");
  assert.equal(textOf(innerOf(html, "orders-lane-current-amount")), "₹1,831", "the current lane's total");
  assert.equal(textOf(innerOf(html, "orders-lane-current-line")), "1 bill waiting to be paid", "the current lane's line");
  const settle = tagOf(html, "orders-lane-settle");
  expectAll(settle, ["flex", "h-[30px]", "flex-none", "items-center", "rounded-[8px]", "bg-ink", "px-[11px]", "text-[12.5px]", "font-semibold", "text-on-ink", "whitespace-nowrap"], "values 3.3 action (text centred, design 8)");
  assert.equal(textOf(innerOf(html, "orders-lane-settle")), "Settle T1", "Settle {code} for the first printed bill (recentOrderCode)");
});

test("OrdersLanes: no Settle action without a printed bill or on another lane; the chosen card stays plain before the list loads", () => {
  assert.equal(tagOf(lanesHtml({ rows: [order("1")] }), "orders-lane-settle"), "", "no printed bill: no action");
  const paid = lanesHtml({ filters: state({ lane: "paid" }), rows: [settled("1", 879, 879)] });
  assert.equal(tagOf(paid, "orders-lane-settle"), "", "Paid: no action");
  assert.match(tagsOf(paid, "orders-lane-card")[2], /aria-pressed="true"/, "Paid is the chosen card");
  assert.equal(textOf(innerOf(paid, "orders-lane-line", 2)), "Avg ₹879 per bill", "Paid's line");
  const loading = lanesHtml({ loaded: false });
  assert.equal(innerOf(loading, "orders-lane-num", 1), "", "before the list loads the chosen card shows no number");
  assert.equal(textOf(innerOf(loading, "orders-lane-line", 1)), "Tabs at the tables now", "and its fixed line");
});

test("OrdersLanes: while a phone is typed no lane is lit; the strip reads '{n} found' / 'Searching all orders'", () => {
  const html = lanesHtml({ filters: state({ lane: "paid", phone: "98765" }), rows: [settled("1", 879, 879), order("2")] });
  for (const [i, tag] of tagsOf(html, "orders-lane-card").entries()) {
    assert.match(tag, /aria-pressed="false"/, `card ${i + 1} is not lit while searching`);
    assert.equal(innerOf(html, "orders-lane-num", i), "", `card ${i + 1} shows no number while searching`);
  }
  for (const [i, tag] of tagsOf(html, "orders-lane-tab").entries()) assert.match(tag, /aria-selected="false"/, `tab ${i + 1} is not selected`);
  assert.equal(textOf(innerOf(html, "orders-lane-current-amount")), "2 found", "the HTML's searching row");
  assert.equal(textOf(innerOf(html, "orders-lane-current-line")), "Searching all orders", "the HTML's searching line");
  assert.equal(tagOf(html, "orders-lane-settle"), "", "no action while searching");
});

// ── The page wires them (owner Q2: the lanes replace the status select) ──────────────────────────────────────────

test("the /orders page: the lanes lead the top block; the status select is gone (owner Q2); one state, one query, the lane rows", () => {
  const src = read(PAGE);
  assert.ok(!src.includes('ariaLabel="Filter by status"'), "no 'Filter by status' select: the lanes replace it (owner Q2)");
  assert.ok(!src.includes('allLabel="All statuses"'), "no 'All statuses' choice");
  assert.ok(!/\bORDER_STATUSES\b|\bSTATUS_OPTIONS\b/.test(src), "no status options");
  assert.match(src, /useState<OrdersFilterState>\(DEFAULT_ORDERS_FILTERS\)/, "the page's filter state is OrdersFilterState");
  assert.match(src, /useOrdersInfinite\(ordersQuery\(filters, new Date\(\)\)\)/, "the one list query is ordersQuery's (no new request)");
  assert.match(src, /seedFromUrl\(window\.location\.search\)/, "the URL seeding goes through seedFromUrl");
  assert.match(src, /laneRows\(filters\.lane, list, searching\)/, "the rows shown are the lane's");
  assert.match(
    src,
    /<div data-ui="orders-top" className=\{ORDERS_TOP_CLASS\}>\s*<OrdersLanes\b/,
    "the lanes are the top block's first part (values 2.2)",
  );
  assert.match(src, /onChoose=\{setDetail\}/, "Settle {code} opens that order's detail (Task 5 owns the choice)");
  assert.match(src, /onLane=\{pickLane\}/, "a lane tap goes through pickLane");
  const pick = src.slice(src.indexOf("const pickLane"), src.indexOf("};", src.indexOf("const pickLane")));
  assert.ok(pick.includes('setPhoneInput("")'), "a lane tap clears the typed phone");
  assert.ok(/phone: ""/.test(pick), "and the searched phone (no 350 ms ghost)");
  assert.ok(pick.includes("setDetail(null)"), "and the choice");
});
