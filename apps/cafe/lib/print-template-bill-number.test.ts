import { BILL_FIXTURES, FIXED_NOW_MS, billGstShows, type BillFixture } from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { BillSlip } from "@/components/print/slip/SlipEngine";
import { classicBillTemplate } from "@/lib/print-template-legacy";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { BILL_DESIGNS, type BillTemplate } from "@pos/shared/print-template";
import type { Order, Settings } from "@/types";

// Print customization S4 (01-PLAN Amendment A7, owner Q1, s78): "Show bill number" (billShowNumber) is the SOLE control
// of the bill number line on every design, GST or not. SlipEngine.billBlockVisible prints a billNo line iff billShowNumber,
// ignoring the block's own `on` and its GST lock (review fix, s78), so a reprint after numbering is turned off shows no
// old number and the editor's preview (whose billNo row has no switch) cannot disagree with the print. These legs moved
// here from print-template-golden.test.ts and print-template-golden-stored.test.ts (both at their ~300-line budget) and
// were then re-based on that rule. The stored legs go through OrderReceipt (the call site every print lane uses); the
// engine leg calls BillSlip directly.

(globalThis as { React?: typeof React }).React = React; // jsx:"preserve" -> tsx compiles to React.createElement
before(() => loadSlipCode()); // the non-Classic designs are one lazy chunk (the matrix suites load it the same way)
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS })); // the bill's "Printed ..." line
after(() => mock.timers.reset());

const bill = (order: Order | null, settings: Settings, banner?: string): string =>
  renderToStaticMarkup(createElement(OrderReceipt, { order, settings, banner }));
const engineBill = (order: Order | null, settings: Settings, banner?: string, template?: BillTemplate): string =>
  renderToStaticMarkup(createElement(BillSlip, { order, settings, banner, template: template ?? classicBillTemplate(settings) }));

// ── The bill number: "Show bill number" is the sole control on every design, GST or not (owner, s78, 01-PLAN A7) ──
// SlipEngine.billBlockVisible: the billNo line prints iff billShowNumber, IGNORING the block's own `on` and its GST lock
// (the editor's billNo row has no switch, so the preview can never disagree with the print). It also needs a number on
// the order (an unpaid order has none), as the legacy bill does.
const BILL_NO_RE = /Bill (?:No|#)/;
const NUMBER_ROW_12 = '<div class="flex flex-wrap justify-between gap-2 font-bold"><span>Bill No.</span><span class="ml-auto text-right">12</span></div>';
const LEGACY_NUMBER_ROW_12 = '<div class="flex justify-between gap-2 font-bold"><span>Bill No.</span><span class="text-right">12</span></div>';
const withBillNo = (tpl: BillTemplate, on: boolean): BillTemplate => ({ ...tpl, blocks: tpl.blocks.map((b) => (b.type === "billNo" ? { ...b, on } : b)) });
const storedWith = (s: Settings, tpl: BillTemplate): Settings => ({ ...s, billTemplate: JSON.parse(JSON.stringify(tpl)) });
const fixture = (id: string): BillFixture => BILL_FIXTURES.find((f) => f.id === id) as BillFixture;

test("stored bill number: with billShowNumber OFF no bill number prints, GST or not, billNo on or off (Classic)", () => {
  const gst = fixture("incl-gst");
  const plain = fixture("gst-off");
  assert.ok(billGstShows(gst.order, gst.settings) && gst.order.billNumber === 12, "landmark: a GST order that has a bill number");
  assert.ok(!billGstShows(plain.order, plain.settings) && plain.order.billNumber !== undefined, "landmark: a non-GST order that has one too");
  for (const fx of [gst, plain]) {
    const base = classicBillTemplate({ ...fx.settings, billShowNumber: true });
    assert.equal(base.blocks.find((b) => b.type === "billNo")?.on, true, `landmark: [${fx.id}] the template's billNo block is on`);
    assert.ok(bill(fx.order, storedWith({ ...fx.settings, billShowNumber: true }, base)).includes(NUMBER_ROW_12), `landmark: [${fx.id}] with billShowNumber on the same bill prints the number row`);
    for (const on of [true, false]) {
      const html = bill(fx.order, storedWith({ ...fx.settings, billShowNumber: false }, withBillNo(base, on)));
      assert.ok(html.includes(fx.order.orderId), `landmark: [${fx.id} on=${on}] the bill really rendered`);
      assert.ok(!BILL_NO_RE.test(html), `[${fx.id}] billNo on=${on} + billShowNumber off: no bill number line (GST lock or not)`);
    }
  }
  assert.ok(bill(gst.order, storedWith(gst.settings, classicBillTemplate(gst.settings))).includes("TAX INVOICE"), "landmark: the GST bill's lock still prints its title");
});

test("stored bill number: with billShowNumber ON the number prints whatever billNo's own `on` is, GST or not (Classic)", () => {
  for (const id of ["incl-gst", "gst-off"]) {
    const fx = fixture(id);
    const s = { ...fx.settings, billShowNumber: true };
    const base = classicBillTemplate(s);
    for (const on of [true, false]) {
      assert.equal(withBillNo(base, on).blocks.find((b) => b.type === "billNo")?.on, on, `landmark: [${id}] the block really is on=${on}`);
      assert.ok(bill(fx.order, storedWith(s, withBillNo(base, on))).includes(NUMBER_ROW_12), `[${id}] showNumber on + billNo on=${on}: the number row prints`);
    }
  }
  const unpaid = fixture("partial-due");
  assert.equal(unpaid.order.billNumber, undefined, "landmark: an order with no bill number yet");
  const html = bill(unpaid.order, storedWith({ ...unpaid.settings, billShowNumber: true }, classicBillTemplate({ ...unpaid.settings, billShowNumber: true })));
  assert.ok(html.includes(unpaid.order.orderId) && !BILL_NO_RE.test(html), "showNumber on but no number on the order: no blank label");
});

test("stored bill number: the template path and today's legacy bill agree on whether the number prints, for every fixture", () => {
  let printed = 0;
  let hidden = 0;
  for (const fx of BILL_FIXTURES) {
    for (const showNumber of [true, false]) {
      const s = { ...fx.settings, billShowNumber: showNumber };
      for (const on of [true, false]) {
        const legacy = BILL_NO_RE.test(bill(fx.order, s));
        const stored = BILL_NO_RE.test(bill(fx.order, storedWith(s, withBillNo(classicBillTemplate(s), on))));
        assert.equal(stored, legacy, `[${fx.id} showNumber=${showNumber} billNo on=${on}] the engine's gate equals OrderReceipt's`);
        if (legacy) printed++;
        else hidden++;
      }
    }
  }
  assert.ok(printed > 0 && hidden > 0, `landmark: both outcomes occurred (printed=${printed}, hidden=${hidden})`);
  const numbered = fixture("incl-gst");
  assert.ok(bill(numbered.order, numbered.settings).includes(LEGACY_NUMBER_ROW_12), "landmark: legacy prints its own (unwrapped) row, so the two sides really are different renderers");
});

test("stored bill number: Modern / Express / Cafe follow the same rule through the lazy chunk", () => {
  const designs = BILL_DESIGNS.filter((d) => d !== "classic");
  assert.deepEqual(designs, ["modern", "express", "cafe"], "landmark: the three lazy-chunk designs");
  for (const design of designs) {
    for (const fx of [fixture("incl-gst"), fixture("gst-off")]) {
      const tpl = defaultBillTemplate(design, fx.settings);
      assert.equal(tpl.design, design);
      for (const on of [true, false]) {
        assert.equal(withBillNo(tpl, on).blocks.find((b) => b.type === "billNo")?.on, on, `landmark: [${design}] billNo on=${on}`);
        const html = (showNumber: boolean): string => bill(fx.order, storedWith({ ...fx.settings, billShowNumber: showNumber }, withBillNo(tpl, on)));
        const cell = `${design} ${fx.id} billNo on=${on}`;
        assert.ok(html(true).includes(fx.order.orderId) && html(false).includes(fx.order.orderId), `landmark: [${cell}] the design rendered the order`);
        assert.ok(!BILL_NO_RE.test(html(false)), `${cell}: showNumber off prints no bill number`);
        assert.ok(BILL_NO_RE.test(html(true)), `${cell}: showNumber on prints the number, whatever the block's own on`);
      }
    }
  }
});

// From print-template-golden.test.ts "bill golden: the lock legs are really exercised ..." (its last two asserts).
test("engine bill number: GST does not force the number row; billShowNumber alone decides it (BillSlip, Classic)", () => {
  const gstBill = BILL_FIXTURES.find((f) => f.id === "incl-gst");
  assert.ok(gstBill, "landmark: the inclusive-GST fixture exists");
  assert.ok(billGstShows(gstBill.order, gstBill.settings), "landmark: it is a GST bill (the case a lock could have forced)");
  // The bill number is NOT forced by GST (owner, s78): "Show bill number" is its sole control, so off prints none.
  assert.ok(engineBill(gstBill.order, { ...gstBill.settings, billShowNumber: true }).includes("Bill No."), "landmark: a GST bill with billShowNumber on prints the number row");
  assert.ok(!engineBill(gstBill.order, { ...gstBill.settings, billShowNumber: false }).includes("Bill No."), "a GST bill with billShowNumber off prints no number row");
});
