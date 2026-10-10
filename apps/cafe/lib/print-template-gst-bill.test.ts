import {
  BILL_FIXTURES, FIXED_NOW_MS, billGstShows, forceBillLocks, withClassicWrap, withLockedTitle, type BillFixture,
} from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { BillSlip } from "@/components/print/slip/SlipEngine";
import { GstSplitLines } from "@/components/pos/slip-gst-lines";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { classicBillTemplate } from "@/lib/print-template-legacy";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import { sampleBillOrder } from "@/lib/bill-print-sample";
import { NO_LIVE_GST } from "@/lib/gst-invoice";
import { receiptGst } from "@/lib/receipt";
import { stripComments } from "@/lib/source-pin-utils";
import { BILL_DESIGNS, type BillTemplate } from "@pos/shared/print-template";
import { invoiceFyOf } from "@pos/shared/invoice-number";
import type { Order, Settings } from "@/types";

// Print customization S10-C (01-PLAN A15, owner Q1 + Q2): a GST bill ALWAYS prints its invoice number when the order
// holds one ("Show bill number" keeps controlling only the daily Bill No. row) and prints its tax split (CGST / SGST,
// each half the rate and half the tax) under the GST line, on the legacy bill, on Classic (byte-identical to legacy)
// and on all four designs. A non-GST bill is untouched.

(globalThis as { React?: typeof React }).React = React;
before(() => loadSlipCode()); // the non-Classic designs are one lazy chunk
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const legacy = (order: Order, s: Settings): string => renderToStaticMarkup(createElement(OrderReceipt, { order, settings: s }));
const engine = (order: Order, s: Settings, template: BillTemplate): string =>
  renderToStaticMarkup(createElement(BillSlip, { order, settings: s, template }));
const oracle = (order: Order, s: Settings): string =>
  withLockedTitle(withClassicWrap(legacy(order, forceBillLocks(s, order))), billGstShows(order, s));
const fx = (id: string): BillFixture => BILL_FIXTURES.find((f) => f.id === id) as BillFixture;
const withInvoice = (order: Order, on: boolean): Order =>
  on ? order : { ...order, invoiceNumber: undefined, invoiceFy: undefined };
const gstOf = (o: Order) => receiptGst(o, NO_LIVE_GST);
const halfText = (gst: number): string => (Number.isInteger(gst / 2) ? `₹${gst / 2}` : `₹${Math.floor(gst / 2)}.50`);
const splitHtml = (rate: number, gst: number): string =>
  `<div class="pl-2 text-[0.83em]">CGST @${rate / 2}%: ${halfText(gst)}</div><div class="pl-2 text-[0.83em]">SGST @${rate / 2}%: ${halfText(gst)}</div>`;
const invoiceRow = (label: string, wrap: boolean): string =>
  wrap
    ? `<div class="flex flex-wrap justify-between gap-2 font-bold"><span>Invoice No.</span><span class="ml-auto text-right">${label}</span></div>`
    : `<div class="flex justify-between gap-2 font-bold"><span>Invoice No.</span><span class="text-right">${label}</span></div>`;
const billRow = (wrap: boolean): string =>
  wrap
    ? '<div class="flex flex-wrap justify-between gap-2 font-bold"><span>Bill No.</span><span class="ml-auto text-right">12</span></div>'
    : '<div class="flex justify-between gap-2 font-bold"><span>Bill No.</span><span class="text-right">12</span></div>';
const GST_IDS = ["split", "cancelled-reason", "excl-gst-discount-charges", "incl-gst"] as const;
const LABELS: Record<(typeof GST_IDS)[number], string> = {
  split: "2627/000045", "cancelled-reason": "2627/000046", "excl-gst-discount-charges": "2627/123456", "incl-gst": "2627/000001",
};

test("landmarks: the golden's GST fixtures carry an invoice, with odd and even halves, in both modes", () => {
  const halves = GST_IDS.map((id) => ({ id, gst: gstOf(fx(id).order) }));
  assert.ok(halves.every((h) => h.gst.show && h.gst.gstAmount > 0 && h.gst.gstAmount < 1000 && fx(h.id).order.invoiceNumber !== undefined));
  assert.ok(halves.some((h) => h.gst.gstAmount % 2 === 1), "an odd half (to the paisa) is covered");
  assert.ok(halves.some((h) => h.gst.gstAmount % 2 === 0), "an even half (whole rupees) is covered");
  assert.ok(halves.some((h) => h.gst.inclusive) && halves.some((h) => !h.gst.inclusive), "both modes are covered");
});

test("legacy == Classic over invoice on/off x Show bill number on/off, for every fixture", () => {
  let cells = 0;
  for (const f of BILL_FIXTURES) {
    for (const invoice of [true, false]) {
      for (const billShowNumber of [true, false]) {
        const order = withInvoice(f.order, invoice);
        const s: Settings = { ...f.settings, billShowNumber };
        assert.equal(engine(order, s, classicBillTemplate(s)), oracle(order, s), `[${f.id} invoice=${invoice} number=${billShowNumber}]`);
        cells++;
      }
    }
  }
  assert.equal(cells, BILL_FIXTURES.length * 4);
});

test("exact markup: legacy and Classic print Bill No., Invoice No. (in that order, before the rest) and the split under the GST line", () => {
  for (const id of GST_IDS) {
    const { order, settings } = fx(id);
    const g = gstOf(order);
    const s: Settings = { ...settings, billShowNumber: true };
    for (const [lane, html, wrap] of [["legacy", legacy(order, s), false], ["Classic", engine(order, s, classicBillTemplate(s)), true]] as const) {
      const label = LABELS[id];
      assert.ok(html.includes(billRow(wrap) + invoiceRow(label, wrap)), `[${id} ${lane}] Bill No. then Invoice No. rows, adjacent`);
      assert.ok(html.indexOf("Invoice No.") < html.indexOf("Order</span>"), `[${id} ${lane}] the invoice sits above the Order line`);
      assert.equal(html.split("Invoice No.").length - 1, 1, `[${id} ${lane}] exactly one invoice row`);
      assert.equal(html.split("CGST @").length - 1, 1, `[${id} ${lane}] one CGST line`);
      assert.ok(html.includes(splitHtml(g.rate, g.gstAmount)), `[${id} ${lane}] the CGST then SGST lines, exact`);
      const gstLine = g.inclusive ? "incl. GST @" : "GST @";
      assert.ok(html.indexOf(gstLine) < html.indexOf("CGST @"), `[${id} ${lane}] the split follows the GST line`);
      if (!g.inclusive) assert.ok(html.indexOf("CGST @") < html.indexOf("Packing") || !html.includes("Packing"), `[${id} ${lane}] before the charges`);
    }
  }
});

test("owner Q1: with Show bill number off the invoice still prints and the Bill No. row does not, on every lane and design", () => {
  for (const id of GST_IDS) {
    const { order, settings } = fx(id);
    for (const billShowNumber of [true, false]) {
      const s: Settings = { ...settings, billShowNumber };
      const lanes: Array<[string, string]> = [["legacy", legacy(order, s)]];
      for (const design of BILL_DESIGNS) lanes.push([design, engine(order, s, defaultBillTemplate(design, s))]);
      for (const [lane, html] of lanes) {
        assert.ok(html.includes(LABELS[id]), `[${id} ${lane} number=${billShowNumber}] the invoice number prints`);
        assert.equal(/Bill (?:No|#)/.test(html), billShowNumber, `[${id} ${lane} number=${billShowNumber}] Bill No. follows the switch alone`);
      }
    }
  }
});

test("a Classic design with its Bill number line turned off still prints a GST bill's invoice, and nothing without one", () => {
  const { order, settings } = fx("split");
  const s: Settings = { ...settings, billShowNumber: false };
  const base = classicBillTemplate({ ...s, billShowNumber: true });
  const off: BillTemplate = { ...base, blocks: base.blocks.map((b) => (b.type === "billNo" ? { ...b, on: false } : b)) };
  assert.ok(engine(order, s, off).includes(invoiceRow("2627/000045", true)), "invoice prints with the block off");
  const bare = engine(withInvoice(order, false), s, off);
  assert.ok(!bare.includes("Invoice No.") && !/Bill (?:No|#)/.test(bare), "no invoice on the order and numbering off: neither row");
});

test("all four designs print the invoice and the split, in their own money style, odd and even halves", () => {
  const style: Record<string, (gst: number) => string> = {
    classic: halfText,
    cafe: halfText,
    modern: (g) => (Number.isInteger(g / 2) ? String(g / 2) : `${Math.floor(g / 2)}.50`),
    express: (g) => (Number.isInteger(g / 2) ? String(g / 2) : `${Math.floor(g / 2)}.50`),
  };
  for (const id of GST_IDS) {
    const { order, settings } = fx(id);
    const g = gstOf(order);
    for (const design of BILL_DESIGNS) {
      const html = engine(order, { ...settings, billShowNumber: true }, defaultBillTemplate(design, { ...settings, billShowNumber: true }));
      const where = `[${id} ${design}]`;
      assert.ok(html.includes(LABELS[id]) && html.includes("Invoice No"), `${where} invoice`);
      assert.ok(html.includes(`CGST @${g.rate / 2}%`) && html.includes(`SGST @${g.rate / 2}%`), `${where} split labels`);
      assert.equal(html.split(style[design](g.gstAmount)).length - 1 >= 2, true, `${where} both halves in the design's money style`);
      assert.ok(html.indexOf(g.inclusive ? "incl. GST @" : "GST @") < html.indexOf("CGST @"), `${where} the split follows the GST line`);
    }
  }
  const odd = engine(fx("split").order, fx("split").settings, defaultBillTemplate("modern", fx("split").settings));
  assert.ok(odd.includes("17.50") && !odd.includes("₹17.50"), "modern: an odd half to the paisa, no symbol");
});

test("a non-GST bill is untouched: no split, no invoice row, same output with or without invoice fields it cannot hold", () => {
  for (const id of ["gst-off", "paid-cash", "partial-due", "reward-note"]) {
    const { order, settings } = fx(id);
    const s: Settings = { ...settings, billShowNumber: true };
    for (const html of [legacy(order, s), ...BILL_DESIGNS.map((d) => engine(order, s, defaultBillTemplate(d, s)))]) {
      assert.ok(html.includes(order.orderId), `landmark: [${id}] rendered`);
      assert.ok(!html.includes("CGST") && !html.includes("SGST") && !html.includes("Invoice No"), `[${id}] no GST lines`);
    }
    assert.equal(legacy(order, s), legacy(withInvoice(order, false), s), `[${id}] legacy output is the same with no invoice`);
  }
});

test("GstSplitLines: half the rate and half the tax across the usual rates (whole and odd halves)", () => {
  for (const [rate, gst] of [[5, 25], [5, 24], [12, 76], [18, 113], [28, 280]] as const) {
    const html = renderToStaticMarkup(createElement(GstSplitLines, { gst: { rate, gstAmount: gst } }));
    assert.equal(html, splitHtml(rate, gst));
  }
});

test("a GST sample bill carries invoice 1 in the FY of its date; a non-GST sample carries none", () => {
  const on = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" as const };
  for (const [createdAt, fy] of [["2027-03-31T18:29:59.000Z", 2026], ["2027-03-31T18:30:00.000Z", 2027], ["2026-10-04T05:15:00.000Z", 2026]] as const) {
    const o = sampleBillOrder(on, 7, createdAt);
    assert.deepEqual([o.invoiceNumber, o.invoiceFy], [1, fy], createdAt);
    assert.equal(o.invoiceFy, invoiceFyOf(new Date(createdAt)));
  }
  const off = sampleBillOrder({ ...on, gstEnabled: false }, 7, "2026-10-04T05:15:00.000Z");
  assert.ok(off.invoiceNumber === undefined && off.invoiceFy === undefined);
});

test("source pins: renderers read order.invoiceNumber / order.invoiceFy literally; one split component serves legacy, Classic and the GST sample", () => {
  const read = (p: string): string => stripComments(readFileSync(path.join(process.cwd(), p), "utf8"));
  for (const file of ["components/pos/OrderReceipt.tsx", "components/print/slip/slip-context.ts"]) {
    const src = read(file);
    assert.ok(/\border\.invoiceNumber\b/.test(src) && /\border\.invoiceFy\b/.test(src), `${file} reads both invoice keys by name (the parity harvest sees them)`);
  }
  for (const file of ["components/pos/OrderReceipt.tsx", "components/print/slip/bill-classic-blocks.tsx", "components/settings/GstSampleBill.tsx"]) {
    const src = read(file);
    assert.equal(src.split("<GstSplitLines").length - 1, 2, `${file} renders the split under both GST lines`);
    assert.ok(!/CGST/.test(src), `${file} never spells the split itself`);
  }
  const themed = read("components/print/slip/bill-themed-blocks.tsx");
  assert.ok(themed.includes("theme.halfAmount(gst.gstAmount)") && !/\binr\(gst\.gstAmount \/ 2\)/.test(themed), "themes format a half through their own halfAmount");
  assert.ok(read("components/print/slip/SlipEngine.tsx").includes("showNumber || hasInvoice"), "the billNo block shows with numbering on OR an invoice");
});
