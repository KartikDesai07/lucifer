import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { BillSlip } from "@/components/print/slip/SlipEngine";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import { BILL_DESIGNS } from "@pos/shared/print-template";
import { FIXED_NOW_MS, orderOf, settingsOf } from "./print-template-golden.fixtures";
import { stripComments } from "./source-pin-utils";
import { detailItemsHead } from "./order-detail-view";
import type { OrderItem } from "@/types";

// Bill line grouping on the PAPER (owner, 2026-11-02): a bill whose cold drink was ordered in two rounds prints exactly
// the bill of the same order with one "Cold Drink x2" line — every design and the legacy bill, totals untouched.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
// The non-Classic designs are one lazy chunk: without it every design silently renders as Classic.
before(() => loadSlipCode());
after(() => mock.timers.reset());

const coke = (kotRound: number, qty = 1): OrderItem => ({ productId: "p-coke", name: "Cold Drink", price: 40, qty, modifiers: [], instructions: "", kotRound });
const burger: OrderItem = { productId: "p-burger", name: "Veg Burger", price: 120, qty: 1, modifiers: ["Cheese"], instructions: "", kotRound: 1 };

const repeated = orderOf({ items: [coke(1), burger, coke(2)], gst: { rate: 5, mode: "exclusive" } });
const merged = orderOf({ items: [coke(1, 2), burger], gst: { rate: 5, mode: "exclusive" } });
const settings = settingsOf();

const count = (html: string, needle: string) => html.split(needle).length - 1;

test("landmark: the two orders carry the same totals (the oracle compares like with like)", () => {
  assert.equal(repeated.total, merged.total);
  assert.equal(repeated.subtotal, merged.subtotal);
  assert.equal(repeated.items.length, 3, "the stored order keeps its three round lines");
});

test("legacy bill: the repeated cold drink prints as one line, byte for byte the merged order's bill", () => {
  const html = renderToStaticMarkup(createElement(OrderReceipt, { order: repeated, settings }));
  assert.equal(count(html, "Cold Drink"), 1);
  assert.equal(html, renderToStaticMarkup(createElement(OrderReceipt, { order: merged, settings })));
});

test("landmark: the designs really render differently (the lazy chunk is loaded, not the Classic fallback)", () => {
  const html = (design: (typeof BILL_DESIGNS)[number]) =>
    renderToStaticMarkup(createElement(BillSlip, { order: merged, settings, template: defaultBillTemplate(design, settings) }));
  const classic = html("classic");
  for (const design of BILL_DESIGNS.filter((d) => d !== "classic")) assert.notEqual(html(design), classic, `${design} is not Classic`);
});

for (const design of BILL_DESIGNS) {
  test(`${design} bill: one Cold Drink line, byte for byte the merged order's bill`, () => {
    const template = defaultBillTemplate(design, settings);
    const html = renderToStaticMarkup(createElement(BillSlip, { order: repeated, settings, template }));
    assert.ok(html.includes("Veg Burger"), "landmark: the items block rendered");
    assert.equal(count(html, "Cold Drink"), 1, "one line for the cold drink");
    assert.equal(html, renderToStaticMarkup(createElement(BillSlip, { order: merged, settings, template })));
  });
}

test("Orders page detail lists the bill lines (grouped), and its item count still sums every qty", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const src = stripComments(readFileSync(path.join(root, "components/orders/OrderDetailBody.tsx"), "utf8"));
  assert.ok(src.includes('data-ui="order-detail-items"'), "landmark: the items box");
  assert.ok(src.includes("billLinesOf(order.items).map((item, i) => {"), "the detail rows come from billLinesOf");
  assert.ok(!src.includes("{order.items.map((item, i) => {"), "no raw per-round row list left in the items box");
  assert.equal(detailItemsHead(repeated), "3 items", "the head counts every qty of the stored lines (1 + 1 + 1)");
});
