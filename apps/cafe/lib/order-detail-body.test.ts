// U2 Task 6 (2026-10-23): the order detail's body as drawn (docs/superpowers/specs/2026-10-22-orders-html-values.md 11.4
// body and customer row, 11.5 items box, sums and total, 11.6 cancel note; docs/superpowers/specs/2026-10-23-orders-match-
// html-design.md 6.8, Q9): components/orders/OrderDetailBody.tsx and the void trail inside its items box
// (components/orders/OrderVoidTrail.tsx), rendered to static markup; the words are lib/order-detail-view.ts's (tested in
// lib/order-detail-view.test.ts). Then the source pins: the sheet renders the body, the body renders detailSums.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { detailSums } from "./order-detail-view";
import {
  ORDER_DETAIL_BOX_HEAD_CLASS,
  ORDER_DETAIL_LINE_CLASS,
  ORDER_DETAIL_QTY_CLASS,
  ORDER_DETAIL_RULE_CLASS,
} from "./orders-layout";
import { minutesBefore, order, settled } from "./orders-lanes.fixtures";
import { stripComments } from "./source-pin-utils";
import { OrderDetailBody } from "@/components/orders/OrderDetailBody";
import type { Order } from "@/types";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (as order-detail-view.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const hasAll = (cls: string, needles: string[], what: string): void => {
  for (const n of needles) assert.ok(tokens(cls).includes(n), `${what}: "${n}" (has "${cls}")`);
};
const html = (o: Order): string => renderToStaticMarkup(createElement(OrderDetailBody, { order: o }));
const line = (over: Record<string, unknown> = {}) => ({ productId: "p1", name: "Tea", price: 50, qty: 1, modifiers: [], instructions: "", kotRound: 1, ...over });

/** The HTML's Table 1 on our data: a walk-in's open tab, three lines (the first with its meta), a charge and exclusive GST. */
const table1 = (over: Record<string, unknown> = {}): Order =>
  order("014", {
    tableNo: "T-1",
    items: [
      line({ name: "Kaju Badam Milk Shake", variation: "Large", price: 180, modifiers: ["Extra thick"] }),
      line({ productId: "p2", name: "Butter Naan", price: 59, qty: 4 }),
      line({ productId: "p3", name: "Coca Cola", price: 50 }),
    ],
    subtotal: 466,
    charges: [{ type: "table", label: "Service charge", amount: 23 }],
    chargeAmount: 23,
    gstAmount: 23,
    gstRate: 5,
    gstMode: "exclusive",
    total: 512,
    ...over,
  });

// ── values 11.4: the body's parts never shrink (the body itself, ORDER_DETAIL_SCROLL_CLASS: orders-detail-frame.test.ts) ─

test("OrderDetailBody: the customer row, the items box and (cancelled) the note, each flex-none — the body scrolls, nothing in it shrinks", () => {
  const cancelled = html(table1({ status: "Cancelled", cancelledAt: minutesBefore(0), cancelledBy: "Rohan", cancelReason: "Guest left" }));
  for (const part of ["order-detail-customer", "order-detail-items", "order-detail-note"]) {
    expectAll(tagOf(cancelled, part), ["flex-none"], `${part} never shrinks`);
  }
  assert.equal(tagOf(html(table1()), "order-detail-note"), "", "an open tab has no note");
});

test("OrderDetailBody: a walk-in's customer row — the 36px '?' avatar on --surface-3 / --text-3, 'Walk-in customer' 14/600 and 'No customer added' 12.5 --text-3, both cut with an ellipsis; no '+ Add customer' (values 11.4; design 6.8)", () => {
  const out = html(table1());
  expectAll(tagOf(out, "order-detail-customer"), ["flex", "items-center", "gap-2.5"], "values 11.4 customer row");
  const avatar = tagOf(out, "order-detail-avatar");
  expectAll(avatar, ["flex", "size-9", "flex-none", "items-center", "justify-center", "rounded-[50%]", "text-[12.5px]", "font-semibold", "bg-surface-3", "text-subtle-foreground"], "values 11.4 avatar (walk-in)");
  assert.match(avatar, /aria-hidden="true"/, "the initials repeat the name: hidden from a screen reader");
  assert.equal(textOf(out, "order-detail-avatar"), "?", "no customer: '?'");
  expectAll(tagOf(out, "order-detail-customer-text"), ["min-w-0", "flex-1"], "the text column may shrink");
  expectAll(tagOf(out, "order-detail-customer-name"), ["block", "truncate", "text-[14px]", "font-semibold"], "values 11.4 name");
  expectAll(tagOf(out, "order-detail-customer-sub"), ["block", "truncate", "text-[12.5px]", "text-subtle-foreground"], "values 11.4 sub");
  assert.deepEqual([textOf(out, "order-detail-customer-name"), textOf(out, "order-detail-customer-sub")], ["Walk-in customer", "No customer added"], "the HTML's walk-in words, our sub");
  assert.ok(!out.includes("Add customer") && !out.includes("<button"), "no '+ Add customer' (a customer is attached in the payment sheet)");
});

test("OrderDetailBody: a named customer — the initials on --accent-t / --accent-i, the name, no second line (we hold no phone or visits)", () => {
  const out = html(table1({ customerId: "c1", customerName: "Neha Joshi" }));
  expectAll(tagOf(out, "order-detail-avatar"), ["bg-accent", "text-accent-foreground"], "values 11.4 avatar with a customer");
  assert.equal(textOf(out, "order-detail-avatar"), "NJ", "the initials");
  assert.equal(textOf(out, "order-detail-customer-name"), "Neha Joshi", "the name");
  assert.equal(tagOf(out, "order-detail-customer-sub"), "", "no second line");
});

// ── values 11.5: the items box ──────────────────────────────────────────────────────────────────────────────────────

test("OrderDetailBody: the items box on --surface-2, a 1px --border-2 rule, radius 12, padding 12 14 14; its head '{n} items' · 'Amount' 11.5/600 uppercase .06em --text-3 (values 11.5)", () => {
  const out = html(table1());
  expectAll(tagOf(out, "order-detail-items"), ["relative", "rounded-[12px]", "border", "border-border-2", "bg-surface-2", "px-3.5", "pt-3", "pb-3.5"], "values 11.5 box");
  hasAll(ORDER_DETAIL_BOX_HEAD_CLASS, ["flex", "items-baseline", "justify-between", "pb-1", "text-[11.5px]", "font-semibold", "uppercase", "tracking-[0.06em]", "text-subtle-foreground"], "values 11.5 head");
  assert.deepEqual(classesOf(tagOf(out, "order-detail-items-head")), tokens(ORDER_DETAIL_BOX_HEAD_CLASS), "the head reads the shared class");
  assert.equal(textOf(out, "order-detail-items-head"), "6 itemsAmount", "Σ quantity (1 + 4 + 1), then 'Amount'");
});

test("OrderDetailBody: a line per item — the grid 28px 1fr auto, 2px 8px apart, 8px above and below, on the baseline; '{qty}×' Geist Mono 13/600 --text-2; the name 13.5/500 (orderItemLabel); the meta 12px --text-3; the amount Geist Mono 13.5", () => {
  const out = html(table1());
  hasAll(ORDER_DETAIL_LINE_CLASS, ["grid", "grid-cols-[28px_minmax(0,1fr)_auto]", "items-baseline", "gap-x-2", "gap-y-0.5", "py-2"], "values 11.5 line");
  hasAll(ORDER_DETAIL_QTY_CLASS, ["font-mono", "text-[13px]", "font-semibold", "text-muted-foreground"], "values 11.5 qty");
  const lines = tagsOf(out, "order-detail-line");
  assert.equal(lines.length, 3, "three lines");
  lines.forEach((tag, i) => assert.deepEqual(classesOf(tag), tokens(ORDER_DETAIL_LINE_CLASS), `line ${i + 1} reads the shared class`));
  tagsOf(out, "order-detail-line-qty").forEach((tag, i) => assert.deepEqual(classesOf(tag), tokens(ORDER_DETAIL_QTY_CLASS), `qty ${i + 1}`));
  assert.deepEqual([0, 1, 2].map((i) => textOf(out, "order-detail-line-qty", i)), ["1×", "4×", "1×"], "the HTML's '{qty}×'");
  expectAll(tagOf(out, "order-detail-line-text"), ["min-w-0"], "the name column may shrink (names wrap)");
  expectAll(tagOf(out, "order-detail-line-name"), ["block", "text-[13.5px]", "font-medium"], "values 11.5 name");
  assert.ok(!classesOf(tagOf(out, "order-detail-line-name")).includes("truncate"), "names wrap (values 11.5: no nowrap)");
  assert.deepEqual([0, 1, 2].map((i) => textOf(out, "order-detail-line-name", i)), ["Kaju Badam Milk Shake (Large)", "Butter Naan", "Coca Cola"], "orderItemLabel: the name with its variation");
  expectAll(tagOf(out, "order-detail-line-meta"), ["block", "text-[12px]", "text-subtle-foreground"], "values 11.5 meta");
  assert.equal(tagsOf(out, "order-detail-line-meta").length, 1, "an empty meta draws nothing (the HTML's is a 0-height line)");
  tagsOf(out, "order-detail-line-total").forEach((tag, i) => expectAll(tag, ["font-mono", "text-[13.5px]"], `amount ${i + 1}`));
  assert.deepEqual([0, 1, 2].map((i) => textOf(out, "order-detail-line-total", i)), ["₹180", "₹236", "₹50"], "price × qty");
});

test("OrderDetailBody: the meta joins our removed / added modifiers and the instructions with ', ' (orderItemModifierLines)", () => {
  const out = html(table1({ items: [line({ name: "Pizza", modifiers: ["Extra cheese", "Olives"], removedModifiers: ["Mushroom"], instructions: " Well done " })] }));
  assert.equal(textOf(out, "order-detail-line-meta"), "NO Mushroom, + Extra cheese, Olives, Well done", "removals, additions, then the note");
});

test("OrderDetailBody: a reward line keeps its struck price and 'FREE', with its note 'Reward — free' as its meta (today's, design 6.8)", () => {
  const reward = line({ productId: "p9", name: "Red Bull", price: 125, reward: true, note: "Reward — free" });
  const out = html(table1({ items: [reward, line({ productId: "p8", name: "Brownie", price: 120, reward: true })] }));
  assert.equal(textOf(out, "order-detail-line-total"), "₹125 FREE", "the worth struck, then FREE");
  expectAll(tagOf(out, "order-detail-line-total"), ["whitespace-nowrap", "font-mono", "text-[13.5px]"], "the reward amount stays on one line");
  assert.match(out, /<span class="[^"]*\bline-through\b[^"]*">₹125<\/span>/, "the worth is struck");
  assert.deepEqual([textOf(out, "order-detail-line-meta"), textOf(out, "order-detail-line-meta", 1)], ["Reward — free", REWARD_ITEM_LINE_NOTE], "the stored note, else the shared constant (a line stored before the note)");
});

test("OrderDetailBody: the sums are detailSums' rows — 13px --text-2, 6px apart, each label and its Geist Mono value; --bad-i for the discount, --bill-i for 'Due at billing' (values 11.5; Q9)", () => {
  const o = table1({ discount: 20, subtotal: 486 });
  const out = html(o);
  expectAll(tagOf(out, "order-detail-sums"), ["flex", "flex-col", "gap-1.5", "text-[13px]", "text-muted-foreground"], "values 11.5 sums");
  const rows = tagsOf(out, "order-detail-sum");
  const want = detailSums(o).rows;
  assert.equal(rows.length, want.length, "a row per detailSums row");
  want.forEach((r, i) => {
    assert.equal(textOf(out, "order-detail-sum-label", i), r.label, `row ${i + 1} label`);
    assert.equal(textOf(out, "order-detail-sum-value", i), r.value, `row ${i + 1} value`);
    expectAll(rows[i], ["flex", "justify-between"], `row ${i + 1}`);
  });
  tagsOf(out, "order-detail-sum-value").forEach((tag, i) => expectAll(tag, ["font-mono"], `value ${i + 1}`));
  expectAll(rows[1], ["text-status-bad-ink"], "the discount in --bad-i");
  for (const i of [0, 2, 3]) assert.ok(!/text-status-/.test(rows[i]), `row ${i + 1} keeps the sums' --text-2`);
  const due = html({ ...settled("1", 600, 0, "Due"), subtotal: 600 });
  expectAll(tagsOf(due, "order-detail-sum").at(-1) ?? "", ["text-status-bill-ink"], "'Due at billing' in --bill-i");
  assert.equal(textOf(due, "order-detail-sum-label", 1), "Due at billing", "Q9's words");
});

test("OrderDetailBody: two dashed 1.5px --border rules (6 0 8 above the sums, 10 0 10 under them), then the total: its label 14/600, the amount Geist Mono 22/600 -.02em", () => {
  const out = html(table1());
  hasAll(ORDER_DETAIL_RULE_CLASS, ["border-t-[1.5px]", "border-dashed", "border-border"], "values 11.5 divider");
  const rules = tagsOf(out, "order-detail-rule");
  assert.equal(rules.length, 2, "two rules");
  expectAll(rules[0], [...tokens(ORDER_DETAIL_RULE_CLASS), "mt-1.5", "mb-2"], "divider 1: margin 6 0 8");
  expectAll(rules[1], [...tokens(ORDER_DETAIL_RULE_CLASS), "my-2.5"], "divider 2: margin 10 0 10");
  for (const r of rules) assert.match(r, /aria-hidden="true"/, "a rule is decoration");
  expectAll(tagOf(out, "order-detail-total"), ["flex", "items-baseline", "justify-between"], "values 11.5 total");
  expectAll(tagOf(out, "order-detail-total-label"), ["text-[14px]", "font-semibold"], "values 11.5 total label");
  expectAll(tagOf(out, "order-detail-total-value"), ["font-mono", "text-[22px]", "font-semibold", "tracking-[-0.02em]", "text-foreground"], "values 11.5 total value");
  assert.deepEqual([textOf(out, "order-detail-total-label"), textOf(out, "order-detail-total-value")], ["To pay", "₹512"], "an open tab: 'To pay'");
  /** Where the nth element carrying data-ui="<ui>" opens in the markup. */
  const at = (ui: string, nth = 0): number => [...out.matchAll(new RegExp(`data-ui="${ui}"`, "g"))][nth]?.index ?? -1;
  const seq = [at("order-detail-items-head"), at("order-detail-line"), at("order-detail-line", 2), at("order-detail-rule"), at("order-detail-sums"), at("order-detail-rule", 1), at("order-detail-total")];
  assert.ok(seq.every((x, i) => x >= 0 && (i === 0 || x > seq[i - 1])), `the HTML's order: head, lines, rule, sums, rule, total (${seq.join(" ")})`);
});

test("OrderDetailBody: a settled bill reads 'Bill total'; a cancelled one 'Not charged' with the amount struck in --text-3 (values 11.5, 11.10)", () => {
  assert.equal(textOf(html({ ...settled("1", 905, 905), subtotal: 905 }), "order-detail-total-label"), "Bill total", "settled");
  const out = html(table1({ status: "Cancelled", cancelledAt: minutesBefore(0) }));
  assert.equal(textOf(out, "order-detail-total-label"), "Not charged", "cancelled");
  expectAll(tagOf(out, "order-detail-total-value"), ["text-subtle-foreground", "line-through"], "struck in --text-3");
  assert.ok(!classesOf(tagOf(out, "order-detail-total-value")).includes("text-foreground"), "never --text when struck");
});

// ── values 11.6: the cancel note ────────────────────────────────────────────────────────────────────────────────────

test("OrderDetailBody: a cancelled order's red note — radius 10, --bad-t / --bad-i, padding 11 12, 13/500 — with our words (values 11.6; design 6.8)", () => {
  const out = html(table1({ status: "Cancelled", cancelledAt: minutesBefore(0), cancelledBy: "Rohan", cancelReason: "Guest left" }));
  expectAll(tagOf(out, "order-detail-note"), ["rounded-[10px]", "bg-status-bad-tint", "text-status-bad-ink", "px-3", "py-[11px]", "text-[13px]", "font-medium"], "values 11.6 note");
  assert.equal(textOf(out, "order-detail-note"), "Cancelled at 9:30 PM by Rohan.Reason: Guest left", "two lines: when and who, then why");
  assert.ok(out.indexOf('data-ui="order-detail-items"') < out.indexOf('data-ui="order-detail-note"'), "under the items box (values 11.4 order)");
});

// ── design 6.8: the void trail inside the items box ────────────────────────────────────────────────────────────────

test("OrderVoidTrail in the items box after the total: a dashed rule, the caption as the box head, each void '{qty}×', the name struck in --text-3, 'round n · reason — who, date', its amount struck (a reward 'FREE')", () => {
  const voids = [
    { productId: "v1", name: "Hot Cappuccino", price: 130, qty: 1, kotRound: 1, modifiers: ["Oat milk"], reason: "Customer sent it back", voidedBy: "Priya Shah", at: "2026-10-14T07:47:24.000Z" },
    { productId: "v2", name: "Red Bull", price: 125, qty: 2, kotRound: 2, reward: true, reason: "Kitchen mistake", voidedBy: "Rohan", at: "2026-10-14T08:10:00.000Z" },
  ];
  const out = html(table1({ voids }));
  const box = out.slice(out.indexOf('data-ui="order-detail-items"'));
  assert.ok(box.indexOf('data-ui="order-detail-total"') < box.indexOf('data-ui="order-detail-voids"'), "after the total, inside the box");
  expectAll(tagOf(out, "order-detail-voids-rule"), [...tokens(ORDER_DETAIL_RULE_CLASS), "my-2.5"], "the dashed rule before it");
  assert.deepEqual(classesOf(tagOf(out, "order-detail-voids-head")), tokens(ORDER_DETAIL_BOX_HEAD_CLASS), "the caption in the box head's look");
  assert.equal(textOf(out, "order-detail-voids-head"), "Voided after the kitchen was notified", "today's caption (design 11: stays)");
  const lines = tagsOf(out, "order-detail-void");
  assert.equal(lines.length, 2, "a line per void");
  lines.forEach((tag, i) => assert.deepEqual(classesOf(tag), tokens(ORDER_DETAIL_LINE_CLASS), `void ${i + 1}: an item line's grid`));
  assert.deepEqual([0, 1].map((i) => textOf(out, "order-detail-void-qty", i)), ["1×", "2×"], "the quantity voided");
  expectAll(tagOf(out, "order-detail-void-name"), ["block", "text-[13.5px]", "font-medium", "text-subtle-foreground", "line-through"], "the name struck in --text-3");
  assert.equal(textOf(out, "order-detail-void-name"), "Hot Cappuccino", "orderItemLabel");
  expectAll(tagOf(out, "order-detail-void-meta"), ["block", "text-[12px]", "text-subtle-foreground"], "the meta lines");
  assert.deepEqual([textOf(out, "order-detail-void-meta"), textOf(out, "order-detail-void-meta", 1)], ["+ Oat milk", "round 1 · Customer sent it back — Priya Shah, 14 Oct 2026"], "its modifiers, then round · reason — who, date");
  expectAll(tagOf(out, "order-detail-void-total"), ["font-mono", "text-[13.5px]", "text-subtle-foreground", "line-through"], "the amount struck");
  assert.deepEqual([textOf(out, "order-detail-void-total"), textOf(out, "order-detail-void-total", 1)], ["₹130", "₹250 FREE"], "a reward void: its worth struck, then FREE");
  assert.equal(tagOf(html(table1()), "order-detail-voids"), "", "no voids: no trail");
});

// ── Source pins ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("OrderDetailBody renders detailSums, detailCustomer, detailItemsHead, cancelNote and detailLineMeta (the words in one tested place), never a sum of its own", () => {
  const body = read("components/orders/OrderDetailBody.tsx");
  for (const call of ["detailSums(order)", "detailCustomer(order)", "detailItemsHead(order)", "cancelNote(order)", "detailLineMeta(item)"]) assert.ok(body.includes(call), `the body reads ${call}`);
  assert.ok(!body.includes("function lineMeta(") && !body.includes("orderItemModifierLines("), "no meta words of its own (U2 Task 7: detailLineMeta)");
  assert.match(body, /from "@\/lib\/order-detail-view";/, "from lib/order-detail-view.ts");
  for (const own of ["order.subtotal", "order.paidAmount", "chargesFromOrder(", "discountLineLabel(", "receiptGst("]) assert.ok(!body.includes(own), `no figures of its own: ${own}`);
  assert.match(body, /<OrderVoidTrail voids=\{order\.voids\} \/>/, "the void trail inside the box");
});

test("OrderDetailSheet: the body is OrderDetailBody, kept through a sheet's close; today's badges, rows and separators are gone", () => {
  const sheet = read("components/orders/OrderDetailSheet.tsx");
  assert.match(sheet, /<KeepWhileClosing show=\{!!order\}>\s*\{order && <OrderDetailBody order=\{order\} \/>\}\s*<\/KeepWhileClosing>/, "the body, drawn through a close");
  assert.match(sheet, /import \{ OrderDetailBody \} from "@\/components\/orders\/OrderDetailBody";/, "imported");
  for (const gone of ["<Badge", "<Separator", "Served by", "function Row(", "<OrderVoidTrail", "PAY_STYLES"]) assert.ok(!sheet.includes(gone), `today's body is gone: ${gone}`);
  const lines = readFileSync(path.join(CAFE_ROOT, "components/orders/OrderDetailSheet.tsx"), "utf8").split("\n").length;
  assert.ok(lines <= 620, `OrderDetailSheet.tsx stays under Ruling P2's ~620 lines (has ${lines})`);
});
