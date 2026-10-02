import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { sampleGstBill, SAMPLE_ITEM_PRICE } from "@/lib/gst-sample-bill";
import type { GstConfig } from "@/lib/receipt";
import { stripComments } from "@/lib/source-pin-utils";

// Settings > GST & taxes shows a sample bill (components/settings/GstSampleBill.tsx)
// and a worked example per mode (GstModePicker.tsx). Both are priced by
// lib/gst-sample-bill.ts, which must call the real bill maths and add none of
// its own; the sample bill lines are a SECOND copy of the totals block in
// components/pos/OrderReceipt.tsx. Source-read pins, the same technique as
// bill-header-preview-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const HELPER = "apps/cafe/lib/gst-sample-bill.ts";
const SAMPLE = "apps/cafe/components/settings/GstSampleBill.tsx";
const PICKER = "apps/cafe/components/settings/GstModePicker.tsx";
const FIELDS = "apps/cafe/components/settings/GstFields.tsx";
const PAGE = "apps/cafe/app/(dashboard)/settings/taxes/page.tsx";
const RECEIPT = "apps/cafe/components/pos/OrderReceipt.tsx";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";

const cfg = (gstRate: number, gstMode: GstConfig["gstMode"], gstEnabled = true): GstConfig => ({
  gstEnabled,
  gstRate,
  gstMode,
});

test("the sample item is one item at 100 rupees", () => {
  assert.equal(SAMPLE_ITEM_PRICE, 100);
});

test("exclusive GST is added on top of the sample item", () => {
  const five = sampleGstBill(cfg(5, "exclusive"));
  assert.ok(five);
  assert.equal(five.subtotal, 100);
  assert.equal(five.gst.show, true);
  assert.equal(five.gst.inclusive, false);
  assert.equal(five.gst.gstAmount, 5);
  assert.equal(five.total, 105);
  const eighteen = sampleGstBill(cfg(18, "exclusive"));
  assert.ok(eighteen);
  assert.equal(eighteen.gst.gstAmount, 18);
  assert.equal(eighteen.total, 118);
  for (const [rate, gstAmount] of [[12, 12], [28, 28]] as const) {
    const bill = sampleGstBill(cfg(rate, "exclusive"));
    assert.ok(bill);
    assert.equal(bill.gst.gstAmount, gstAmount, `exclusive ${rate}%`);
    assert.equal(bill.total, SAMPLE_ITEM_PRICE + gstAmount, `exclusive ${rate}%`);
  }
});

test("inclusive GST at 12% and 28% rounds the taxable value to whole rupees", () => {
  // Math.round(100 / 1.12) = 89 and Math.round(100 / 1.28) = 78.
  for (const [rate, taxable] of [[12, 89], [28, 78]] as const) {
    const bill = sampleGstBill(cfg(rate, "inclusive"));
    assert.ok(bill);
    assert.equal(bill.total, SAMPLE_ITEM_PRICE, `inclusive ${rate}%`);
    assert.equal(bill.gst.taxable, taxable, `inclusive ${rate}%`);
    assert.equal(bill.gst.gstAmount, SAMPLE_ITEM_PRICE - taxable, `inclusive ${rate}%`);
  }
});

test("inclusive GST is carved out of the sample item price", () => {
  const five = sampleGstBill(cfg(5, "inclusive"));
  assert.ok(five);
  assert.equal(five.total, 100);
  assert.equal(five.gst.show, true);
  assert.equal(five.gst.inclusive, true);
  assert.equal(five.gst.gstAmount, 5);
  assert.equal(five.gst.taxable, 95);
  const eighteen = sampleGstBill(cfg(18, "inclusive"));
  assert.ok(eighteen);
  assert.equal(eighteen.total, 100);
  assert.equal(eighteen.gst.taxable, 85);
  assert.equal(eighteen.gst.gstAmount, 15);
});

test("no GST shows at a 0% rate or with GST switched off", () => {
  for (const mode of ["inclusive", "exclusive"] as const) {
    const zero = sampleGstBill(cfg(0, mode));
    assert.ok(zero);
    assert.equal(zero.gst.show, false);
    assert.equal(zero.total, 100);
    const off = sampleGstBill(cfg(18, mode, false));
    assert.ok(off);
    assert.equal(off.gst.show, false);
    assert.equal(off.total, 100);
  }
});

test("a blank or out-of-range rate gives no sample bill", () => {
  for (const rate of [Number.NaN, -1, 101, Number.POSITIVE_INFINITY]) {
    assert.equal(sampleGstBill(cfg(rate, "exclusive")), null, `rate ${rate}`);
  }
  assert.ok(sampleGstBill(cfg(0, "exclusive")), "landmark: 0 is a valid rate");
  assert.ok(sampleGstBill(cfg(100, "exclusive")), "landmark: 100 is a valid rate");
});

const helperRaw = readSrc(HELPER);
const helperSrc = stripComments(helperRaw);
const sampleSrc = stripComments(readSrc(SAMPLE));
const receiptSrc = stripComments(readSrc(RECEIPT));

test("PIN: the helper prices through the real bill maths and does none of its own", () => {
  assert.ok(helperSrc.includes("computeOrderTotals("), "must call computeOrderTotals(");
  assert.ok(helperSrc.includes("receiptGst("), "must call receiptGst(");
  // Raw bytes, comments included: no rounding or other Math at all.
  assert.ok(helperRaw.includes("computeOrderTotals"), "landmark: the raw read sees the source");
  assert.ok(!helperRaw.includes("Math."), "the helper must not use Math at all");
});

test("PIN: the helper stamps GST the way a new order snapshots it", () => {
  const snapshot = "gstRate: cfg.gstEnabled ? cfg.gstRate : 0";
  assert.ok(helperSrc.includes(snapshot), "the helper must use the order snapshot rule");
  const route = stripComments(readSrc(ORDERS_ROUTE));
  assert.ok(
    route.includes("gstRate: gstCfg.gstEnabled ? gstCfg.gstRate : 0"),
    "landmark: the orders route snapshots GST this way",
  );
});

// The sample bill tax lines, as the receipt prints them.
const BODY_LITERALS = [
  "GST @${gst.rate}%",
  "+${inr(gst.gstAmount)}",
  "incl. GST @{gst.rate}%: {inr(gst.gstAmount)} (taxable",
  "<span>TOTAL</span>",
  'label="Subtotal"',
  "text-[1.17em] font-bold",
];

test("PIN: the sample bill tax lines match the receipt literally", () => {
  for (const needle of BODY_LITERALS) {
    assert.ok(receiptSrc.includes(needle), `landmark: the receipt prints ${needle}`);
    assert.ok(sampleSrc.includes(needle), `the sample bill must print ${needle}`);
  }
});

test("PIN: the sample bill shows the tax lines on the receipt gates", () => {
  for (const gate of ["{gst.show && !gst.inclusive && (", "{gst.show && gst.inclusive && ("]) {
    assert.ok(sampleSrc.includes(gate), `the sample bill must gate on ${gate}`);
  }
  for (const gate of ["{gst?.show && !gst.inclusive && (", "{gst?.show && gst.inclusive && ("]) {
    assert.ok(receiptSrc.includes(gate), `landmark: the receipt gates on ${gate}`);
  }
});

test("PIN: the GSTIN line needs showGstNumber AND the bill carrying GST AND a number", () => {
  assert.ok(sampleSrc.includes("showGstNumber={cfg.showGstNumber}"), "must pass the saved Bill print flag");
  assert.ok(sampleSrc.includes("{showGstNumber && gst.show && gstNumber && ("), "must gate the GSTIN line");
  assert.ok(sampleSrc.includes("GSTIN: {gstNumber}"), "must print the GSTIN line");
  assert.ok(receiptSrc.includes("{cfg.showGstNumber && ("), "landmark: the receipt gates GSTIN on showGstNumber");
  assert.ok(receiptSrc.includes("{gst?.show && gstNumber && ("), "landmark: and on the bill carrying GST");
});

test("PIN: the sample bill paper comes from the same class maps as the receipt", () => {
  for (const needle of ["PAPER_WIDTH_CLASS[cfg.paperWidth]", "PRINT_FONT_CLASS[cfg.fontSize]"]) {
    assert.ok(receiptSrc.includes(needle), `landmark: the receipt uses ${needle}`);
    assert.ok(sampleSrc.includes(needle), `the sample bill must use ${needle}`);
  }
});

test("PIN: both previews price through the helper", () => {
  for (const [name, rel] of [["sample bill", SAMPLE], ["mode picker", PICKER]] as const) {
    const src = stripComments(readSrc(rel));
    assert.ok(src.includes("sampleGstBill("), `the ${name} must call sampleGstBill(`);
  }
});

test("PIN: each mode tile prices its OWN mode, and the GST page passes the live rate", () => {
  const picker = stripComments(readSrc(PICKER));
  // Anchored on the identifier boundary so a renamed or hardcoded mode fails.
  assert.match(
    picker,
    /sampleGstBill\(\{ gstEnabled: true, gstRate: rate, gstMode: mode \}\)/,
    "the tile example must price its own mode at the live rate",
  );
  assert.match(picker, /<ModeExample mode=\{option\} rate=\{rate\} \/>/, "each tile must pass its own option");
  const fields = stripComments(readSrc(FIELDS));
  assert.match(fields, /<GstModePicker value=\{field\.value\} onChange=\{field\.onChange\} rate=\{gstRate\} \/>/);
});

test("PIN: each mode radio is named by its label alone and described by the copy and the example", () => {
  const picker = stripComments(readSrc(PICKER));
  for (const needle of [
    "aria-labelledby={`${name}-${option}-label`}",
    "aria-describedby={`${name}-${option}-description ${name}-${option}-example`}",
    "id={`${name}-${option}-label`}",
    "id={`${name}-${option}-description`}",
    "id={`${name}-${option}-example`}",
  ]) {
    assert.ok(picker.includes(needle), `the mode picker must carry ${needle}`);
  }
});

// The receipt's order: Subtotal, then the added-GST line, then TOTAL, then the
// inclusive note. Each line exists, once, at an increasing offset.
const ORDERED_LINES = [
  'label="Subtotal"',
  "GST @${gst.rate}%",
  "<span>TOTAL</span>",
  "incl. GST @{gst.rate}%",
];

test("PIN: the sample bill prints its totals lines in the receipt's order", () => {
  for (const [name, src] of [["sample bill", sampleSrc], ["receipt", receiptSrc]] as const) {
    let last = -1;
    for (const needle of ORDERED_LINES) {
      const at = src.indexOf(needle);
      assert.ok(at >= 0, `the ${name} must contain ${needle}`);
      assert.equal(src.indexOf(needle, at + 1), -1, `the ${name} must contain ${needle} once`);
      assert.ok(at > last, `in the ${name}, ${needle} must come after the line before it`);
      last = at;
    }
  }
});

test("PIN: the GST page is wired — picker, sample bill, rate buttons, decimal input, saved settings", () => {
  const fields = stripComments(readSrc(FIELDS));
  // Element names are anchored on their boundary: a bare prefix would also
  // match a renamed component.
  for (const element of ["GstModePicker", "GstSampleBill"]) {
    assert.match(fields, new RegExp(String.raw`<${element}[\s/>]`), `GstFields must render <${element}>`);
  }
  for (const needle of ["aria-pressed=", 'inputMode="decimal"']) {
    assert.ok(fields.includes(needle), `GstFields must render ${needle}`);
  }
  // The page also passes settings to its form, so anchor on the GstFields element.
  assert.match(
    stripComments(readSrc(PAGE)),
    /<GstFields\b[^>]*\bsettings=\{settings\}/,
    "the taxes page must pass settings={settings} to GstFields",
  );
});
