import assert from "node:assert/strict";
import { test } from "node:test";

import { STOCK_ENTRY_BACKDATE_MAX_DAYS, STOCK_ENTRY_MAX_TOTAL_PAISE, STOCK_ENTRY_NOTE_MAX_LEN } from "@pos/shared/inventory";
import { inrPaise } from "@/lib/utils";
import { createStockEntrySchema } from "@/schemas";
import { stockEntryDateBounds } from "./stock-adjust-form";
import { buildPaymentInput, initialPaymentValues, paymentAfterText, paymentAmountPaise, validatePaymentForm, type PaymentValues } from "./payment-form";

const TODAY = "2026-11-13";
const REF = "3f1c2a54-7d1e-4b8e-9a53-0c1f5d6e7a88";
const SUPPLIER = "64b7f0c2a1d3e4f5a6b7c8db";

const values = (over: Partial<PaymentValues> = {}): PaymentValues => ({ amountText: "450", date: TODAY, note: "", ...over });

test("initialPaymentValues: starts at what is owed, or empty when nothing is", () => {
  assert.deepEqual(initialPaymentValues(TODAY, 45050), { amountText: "450.50", date: TODAY, note: "" });
  assert.equal(initialPaymentValues(TODAY, 45000).amountText, "450");
  assert.equal(initialPaymentValues(TODAY, 0).amountText, "");
  assert.equal(initialPaymentValues(TODAY, -500).amountText, "", "paid ahead: nothing to prefill");
});

test("validate: a good form has no errors", () => {
  assert.deepEqual(validatePaymentForm(values(), TODAY), {});
  assert.deepEqual(validatePaymentForm(values({ amountText: "1,200.25", note: "  cash  " }), TODAY), {});
});

test("validate: the amount messages", () => {
  assert.equal(validatePaymentForm(values({ amountText: "  " }), TODAY).amount, "Enter how much you paid");
  assert.equal(validatePaymentForm(values({ amountText: "4x" }), TODAY).amount, "Enter an amount like 450 or 450.50");
  assert.equal(validatePaymentForm(values({ amountText: "-5" }), TODAY).amount, "Enter an amount like 450 or 450.50");
  assert.equal(validatePaymentForm(values({ amountText: "0" }), TODAY).amount, "Enter an amount above 0");
  assert.equal(validatePaymentForm(values({ amountText: "0.00" }), TODAY).amount, "Enter an amount above 0");
  const max = STOCK_ENTRY_MAX_TOTAL_PAISE / 100;
  assert.equal(validatePaymentForm(values({ amountText: String(max) }), TODAY).amount, undefined, "the cap itself is allowed");
  assert.equal(validatePaymentForm(values({ amountText: String(max + 1) }), TODAY).amount, "A payment can be at most ₹1,00,00,000");
});

test("validate: the date window and the note length", () => {
  const bounds = stockEntryDateBounds(TODAY);
  assert.equal(validatePaymentForm(values({ date: bounds.min }), TODAY).date, undefined);
  assert.equal(validatePaymentForm(values({ date: bounds.max }), TODAY).date, undefined);
  const wording = `Pick a date from the last ${STOCK_ENTRY_BACKDATE_MAX_DAYS} days, up to today`;
  assert.equal(validatePaymentForm(values({ date: "2026-11-14" }), TODAY).date, wording);
  assert.equal(validatePaymentForm(values({ date: "2020-01-01" }), TODAY).date, wording);
  assert.equal(validatePaymentForm(values({ note: "x".repeat(STOCK_ENTRY_NOTE_MAX_LEN) }), TODAY).note, undefined);
  assert.ok(validatePaymentForm(values({ note: "x".repeat(STOCK_ENTRY_NOTE_MAX_LEN + 1) }), TODAY).note);
});

test("buildPaymentInput: always sends the typed amount, and passes the shared schema", () => {
  const input = buildPaymentInput(values({ amountText: "450.5" }), SUPPLIER, REF);
  assert.deepEqual(input, { kind: "payment", supplierId: SUPPLIER, amountPaise: 45050, date: TODAY, clientRef: REF });
  assert.ok(createStockEntrySchema.safeParse(input).success);
  assert.ok("amountPaise" in buildPaymentInput(values({ amountText: "1" }), SUPPLIER, REF), "never omitted");
  assert.equal(buildPaymentInput(values({ amountText: "1,200" }), SUPPLIER, REF).amountPaise, 120000);
});

test("buildPaymentInput: the note is trimmed and left out when empty; an unreadable amount throws", () => {
  assert.equal(buildPaymentInput(values({ note: "  cash  " }), SUPPLIER, REF).note, "cash");
  assert.ok(!("note" in buildPaymentInput(values({ note: "   " }), SUPPLIER, REF)));
  assert.throws(() => buildPaymentInput(values({ amountText: "" }), SUPPLIER, REF));
  assert.throws(() => buildPaymentInput(values({ amountText: "abc" }), SUPPLIER, REF));
});

test("paymentAmountPaise: null while empty or unreadable", () => {
  assert.equal(paymentAmountPaise(values({ amountText: "" })), null);
  assert.equal(paymentAmountPaise(values({ amountText: "x" })), null);
  assert.equal(paymentAmountPaise(values({ amountText: "12.5" })), 1250);
});

test("paymentAfterText: still to pay, settles, or paid ahead", () => {
  assert.equal(paymentAfterText(10000, null), null);
  assert.equal(paymentAfterText(10000, 0), null);
  assert.equal(paymentAfterText(10000, 4000), `Still to pay after this: ${inrPaise(6000)}`);
  assert.equal(paymentAfterText(10000, 10000), "This settles what you owe.");
  assert.equal(paymentAfterText(10000, 12500), `${inrPaise(2500)} more than you owe. It shows as paid ahead.`);
  assert.equal(paymentAfterText(0, 500), `${inrPaise(500)} more than you owe. It shows as paid ahead.`);
  assert.equal(paymentAfterText(-300, 500), `${inrPaise(500)} more than you owe. It shows as paid ahead.`, "already ahead: all of it is extra");
});

// Review s118 (LOW): dues add up across purchases, so a due can be bigger than one payment may be. The box then starts
// at the most one payment can be (a Save that works), not at a number Save would refuse.
test("initialPaymentValues: a due over the one-payment cap starts at the cap, which validates", () => {
  const start = initialPaymentValues(TODAY, STOCK_ENTRY_MAX_TOTAL_PAISE + 5000);
  assert.equal(paymentAmountPaise(start), STOCK_ENTRY_MAX_TOTAL_PAISE);
  assert.deepEqual(validatePaymentForm(start, TODAY), {});
  assert.equal(paymentAmountPaise(initialPaymentValues(TODAY, STOCK_ENTRY_MAX_TOTAL_PAISE)), STOCK_ENTRY_MAX_TOTAL_PAISE, "exactly the cap is kept");
});
