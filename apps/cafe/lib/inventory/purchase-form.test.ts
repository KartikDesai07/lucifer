import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PURCHASE_MAX_LINES,
  STOCK_ENTRY_NOTE_MAX_LEN,
  STOCK_RATE_MAX_PAISE,
  purchaseLineAmountPaise,
  purchaseTotalPaise,
} from "@pos/shared/inventory";
import { createStockEntrySchema, DUE_NEEDS_SUPPLIER_ERROR, PAID_OVER_TOTAL_ERROR } from "@/schemas";
import {
  buildPurchaseInput,
  initialPurchaseValues,
  lineAmountPaise,
  newPurchaseLine,
  owedPaiseOf,
  paidPaiseOf,
  purchaseFormIsValid,
  purchaseValuesTotalPaise,
  validatePurchaseForm,
  type PurchaseLineValues,
  type PurchaseValues,
} from "./purchase-form";

const TODAY = "2026-11-13";
const REF = "3f1c2a54-7d1e-4b8e-9a53-0c1f5d6e7a88";
const MILK = "64b7f0c2a1d3e4f5a6b7c8d9";
const SUGAR = "64b7f0c2a1d3e4f5a6b7c8da";
const SUPPLIER = "64b7f0c2a1d3e4f5a6b7c8db";

const line = (key: string, itemId: string, qtyText: string, rateText: string): PurchaseLineValues => ({ key, itemId, qtyText, rateText });
const values = (over: Partial<PurchaseValues> = {}): PurchaseValues => ({
  supplierId: SUPPLIER,
  date: TODAY,
  lines: [line("a", MILK, "2.5", "40.10"), line("b", SUGAR, "1", "45")],
  paidMode: "full",
  paidText: "",
  note: "",
  ...over,
});

test("initialPurchaseValues: one blank line, dated today, paid in full, with or without a picked item", () => {
  const blank = initialPurchaseValues(TODAY);
  assert.deepEqual(blank, { supplierId: "", date: TODAY, lines: [newPurchaseLine("line-0")], paidMode: "full", paidText: "", note: "" });
  assert.equal(initialPurchaseValues(TODAY, MILK).lines[0].itemId, MILK);
});

test("preview: a line amount and the total are exactly the shared helpers over the parsed boxes", () => {
  // 2.5 x 40.10 = 100.25 -> 10025 paise, 1 x 45 = 4500: the total is the sum of the rounded lines.
  const v = values();
  assert.equal(lineAmountPaise(v.lines[0]), purchaseLineAmountPaise(2500, 4010));
  assert.equal(lineAmountPaise(v.lines[0]), 10025);
  assert.equal(purchaseValuesTotalPaise(v), purchaseTotalPaise([{ qtyMilli: 2500, ratePaise: 4010 }, { qtyMilli: 1000, ratePaise: 4500 }]));
  assert.equal(purchaseValuesTotalPaise(v), 14525);
});

test("preview: each line rounds once (half-up), never the sum", () => {
  // 0.333 x 1.00 = 33.3 -> 33; two such lines total 66, where rounding the summed 66.6 would give 67.
  const v = values({ lines: [line("a", MILK, "0.333", "1"), line("b", SUGAR, "0.333", "1")] });
  assert.equal(purchaseValuesTotalPaise(v), 66);
  // 0.5 x 0.01 = 0.005 paise-ish: 500 milli x 1 paise / 1000 = 0.5 -> half-up 1.
  assert.equal(lineAmountPaise(line("c", MILK, "0.5", "0.01")), 1);
});

test("preview: a line that does not read yet has no amount and adds nothing to the total", () => {
  assert.equal(lineAmountPaise(line("a", MILK, "", "40")), null);
  assert.equal(lineAmountPaise(line("a", MILK, "2", "")), null);
  assert.equal(lineAmountPaise(line("a", MILK, "0", "40")), null);
  assert.equal(lineAmountPaise(line("a", MILK, "2", "4x")), null);
  assert.equal(purchaseValuesTotalPaise(values({ lines: [line("a", MILK, "2", ""), line("b", SUGAR, "1", "45")] })), 4500);
});

test("paidPaiseOf and owedPaiseOf: full is the total, nothing is 0, part is the typed amount", () => {
  assert.equal(paidPaiseOf(values()), 14525);
  assert.equal(owedPaiseOf(values()), 0);
  assert.equal(paidPaiseOf(values({ paidMode: "nothing" })), 0);
  assert.equal(owedPaiseOf(values({ paidMode: "nothing" })), 14525);
  assert.equal(paidPaiseOf(values({ paidMode: "part", paidText: "100.5" })), 10050);
  assert.equal(owedPaiseOf(values({ paidMode: "part", paidText: "100.5" })), 4475);
  assert.equal(paidPaiseOf(values({ paidMode: "part", paidText: "" })), null);
  assert.equal(paidPaiseOf(values({ paidMode: "part", paidText: "abc" })), null);
  assert.equal(owedPaiseOf(values({ paidMode: "part", paidText: "99999" })), 0, "never below zero");
});

test("validate: a good form has no errors", () => {
  const errors = validatePurchaseForm(values(), TODAY);
  assert.deepEqual(errors, { lineErrors: {} });
  assert.ok(purchaseFormIsValid(errors));
});

test("validate: every line needs an item, a quantity above 0 and a rate", () => {
  const errors = validatePurchaseForm(values({ lines: [line("a", "", "", ""), line("b", SUGAR, "0", "x"), line("c", MILK, "1", "")] }), TODAY);
  assert.ok(errors.lineErrors.a.item && errors.lineErrors.a.qty && errors.lineErrors.a.rate);
  assert.equal(errors.lineErrors.b.qty, "Enter an amount above 0");
  assert.ok(errors.lineErrors.b.rate && !errors.lineErrors.b.item);
  assert.ok(errors.lineErrors.c.rate && !errors.lineErrors.c.qty);
  assert.ok(!purchaseFormIsValid(errors));
});

test("validate: a rate of 0 is allowed (free goods); a rate above the cap is not", () => {
  assert.deepEqual(validatePurchaseForm(values({ lines: [line("a", MILK, "2", "0")], paidMode: "nothing", supplierId: "" }), TODAY), { lineErrors: {} });
  const over = validatePurchaseForm(values({ lines: [line("a", MILK, "1", String(STOCK_RATE_MAX_PAISE / 100 + 1))] }), TODAY);
  assert.match(over.lineErrors.a.rate ?? "", /at most/);
  const atCap = validatePurchaseForm(values({ lines: [line("a", MILK, "1", String(STOCK_RATE_MAX_PAISE / 100))] }), TODAY);
  assert.equal(atCap.lineErrors.a, undefined);
});

test("validate: an item listed twice is refused on the second line only", () => {
  const errors = validatePurchaseForm(values({ lines: [line("a", MILK, "1", "10"), line("b", MILK, "2", "10")] }), TODAY);
  assert.equal(errors.lineErrors.a, undefined);
  assert.equal(errors.lineErrors.b.item, "This item is already listed above");
});

test("validate: at least one line", () => {
  assert.equal(validatePurchaseForm(values({ lines: [] }), TODAY).lines, "Add at least one stock item");
});

test("validate: the total may not pass the cap", () => {
  const big = line("a", MILK, "100000", String(STOCK_RATE_MAX_PAISE / 100));
  const errors = validatePurchaseForm(values({ lines: [big, { ...big, key: "b", itemId: SUGAR }] }), TODAY);
  assert.match(errors.lines ?? "", /can total at most/);
});

test("validate: part paid must read and may not pass the total (the shared message)", () => {
  assert.equal(validatePurchaseForm(values({ paidMode: "part", paidText: "" }), TODAY).paid, "Enter how much you paid now");
  assert.ok(validatePurchaseForm(values({ paidMode: "part", paidText: "1.234" }), TODAY).paid);
  assert.equal(validatePurchaseForm(values({ paidMode: "part", paidText: "145.26" }), TODAY).paid, PAID_OVER_TOTAL_ERROR);
  assert.equal(validatePurchaseForm(values({ paidMode: "part", paidText: "145.25" }), TODAY).paid, undefined, "exactly the total is fine");
});

test("validate: anything left to pay needs a supplier (the shared message, on the supplier field)", () => {
  assert.equal(validatePurchaseForm(values({ supplierId: "", paidMode: "nothing" }), TODAY).supplier, DUE_NEEDS_SUPPLIER_ERROR);
  assert.equal(validatePurchaseForm(values({ supplierId: "", paidMode: "part", paidText: "10" }), TODAY).supplier, DUE_NEEDS_SUPPLIER_ERROR);
  assert.equal(validatePurchaseForm(values({ supplierId: "", paidMode: "full" }), TODAY).supplier, undefined, "paid in full needs no supplier");
  assert.equal(validatePurchaseForm(values({ supplierId: SUPPLIER, paidMode: "nothing" }), TODAY).supplier, undefined);
});

test("validate: the date stays inside the wastage window; the note stays short", () => {
  assert.ok(validatePurchaseForm(values({ date: "2026-11-14" }), TODAY).date, "no future");
  assert.ok(validatePurchaseForm(values({ date: "2026-10-12" }), TODAY).date, "a day too far back");
  assert.equal(validatePurchaseForm(values({ date: "2026-10-13" }), TODAY).date, undefined, "31 days back is the last day");
  assert.ok(validatePurchaseForm(values({ date: "" }), TODAY).date);
  assert.ok(validatePurchaseForm(values({ note: "x".repeat(STOCK_ENTRY_NOTE_MAX_LEN + 1) }), TODAY).note);
  assert.equal(validatePurchaseForm(values({ note: "x".repeat(STOCK_ENTRY_NOTE_MAX_LEN) }), TODAY).note, undefined);
});

test("buildPurchaseInput: the body passes createStockEntrySchema; supplier key only when picked, note trimmed", () => {
  const body = buildPurchaseInput(values({ note: "  Morning delivery  " }), REF);
  assert.deepEqual(body, {
    kind: "purchase",
    supplierId: SUPPLIER,
    date: TODAY,
    lines: [
      { itemId: MILK, qtyMilli: 2500, ratePaise: 4010 },
      { itemId: SUGAR, qtyMilli: 1000, ratePaise: 4500 },
    ],
    paidPaise: 14525,
    note: "Morning delivery",
    clientRef: REF,
  });
  assert.ok(createStockEntrySchema.safeParse(body).success);

  const noSupplier = buildPurchaseInput(values({ supplierId: "", note: "   " }), REF);
  assert.ok(!("supplierId" in noSupplier) && !("note" in noSupplier), "no empty keys");
  assert.ok(createStockEntrySchema.safeParse(noSupplier).success);

  const part = buildPurchaseInput(values({ paidMode: "part", paidText: "100" }), REF);
  assert.equal(part.paidPaise, 10000);
  assert.ok(createStockEntrySchema.safeParse(part).success);
  assert.ok(createStockEntrySchema.safeParse(buildPurchaseInput(values({ paidMode: "nothing" }), REF)).success);
});

test("buildPurchaseInput: refuses a form that does not read", () => {
  assert.throws(() => buildPurchaseInput(values({ lines: [line("a", MILK, "", "1")] }), REF), /valid/);
  assert.throws(() => buildPurchaseInput(values({ paidMode: "part", paidText: "" }), REF), /paid/);
});

test("validate and schema agree: a form with no errors always builds a body the schema accepts", () => {
  const cases: Partial<PurchaseValues>[] = [
    {},
    { paidMode: "nothing" },
    { paidMode: "part", paidText: "5" },
    { supplierId: "", paidMode: "full" },
    { lines: [line("a", MILK, "0.001", "0")], paidMode: "nothing", supplierId: "" },
  ];
  for (const over of cases) {
    const v = values(over);
    assert.ok(purchaseFormIsValid(validatePurchaseForm(v, TODAY)), JSON.stringify(over));
    assert.ok(createStockEntrySchema.safeParse(buildPurchaseInput(v, REF)).success, JSON.stringify(over));
  }
  assert.equal(PURCHASE_MAX_LINES, 20, "landmark: the line cap the sheet enforces");
});
