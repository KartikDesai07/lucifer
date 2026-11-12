import assert from "node:assert/strict";
import { test } from "node:test";

import { STOCK_ENTRY_BACKDATE_MAX_DAYS, STOCK_ENTRY_NOTE_MAX_LEN, STOCK_QTY_MAX } from "@pos/shared/inventory";
import type { StockEntryLineDto } from "@/types/inventory";
import {
  buildStockEntryInput,
  countChangeText,
  entryChangeText,
  initialAdjustValues,
  stockEntryDateBounds,
  validateAdjustForm,
  type StockAdjustValues,
} from "./stock-adjust-form";

const TODAY = "2026-11-13";
const REF = "3f1c2a54-7d1e-4b8e-9a53-0c1f5d6e7a88";
const ITEM = "64b7f0c2a1d3e4f5a6b7c8d9";
const values = (over: Partial<StockAdjustValues> = {}): StockAdjustValues => ({ itemId: ITEM, qtyText: "0.5", reason: "Spoiled", date: TODAY, note: "", ...over });

test("initialAdjustValues: blank form dated today, with or without a picked item", () => {
  assert.deepEqual(initialAdjustValues(null, TODAY), { itemId: "", qtyText: "", reason: "", date: TODAY, note: "" });
  assert.equal(initialAdjustValues(ITEM, TODAY).itemId, ITEM);
});

test("stockEntryDateBounds: a month back (inclusive), never the future", () => {
  assert.deepEqual(stockEntryDateBounds(TODAY), { min: "2026-10-13", max: TODAY });
  assert.equal(STOCK_ENTRY_BACKDATE_MAX_DAYS, 31, "landmark: the window is 31 days");
});

test("validateAdjustForm: a valid wastage and a valid count have no errors", () => {
  assert.deepEqual(validateAdjustForm("waste", values(), TODAY), {});
  assert.deepEqual(validateAdjustForm("count", values({ qtyText: "0", reason: "" }), TODAY), {});
});

test("validateAdjustForm: no item picked", () => {
  assert.equal(validateAdjustForm("waste", values({ itemId: "" }), TODAY).item, "Pick a stock item");
  assert.equal(validateAdjustForm("count", values({ itemId: "" }), TODAY).item, "Pick a stock item");
});

test("validateAdjustForm: an empty quantity reads per kind", () => {
  assert.equal(validateAdjustForm("waste", values({ qtyText: " " }), TODAY).qty, "Enter how much was thrown away");
  assert.equal(validateAdjustForm("count", values({ qtyText: "" }), TODAY).qty, "Enter how much you have now");
});

test("validateAdjustForm: a bad quantity shows the parser's message", () => {
  assert.equal(validateAdjustForm("waste", values({ qtyText: "abc" }), TODAY).qty, "Enter a number, like 2 or 1.5");
  assert.equal(validateAdjustForm("count", values({ qtyText: "1.2345" }), TODAY).qty, "Use at most 3 decimal places");
  assert.ok(validateAdjustForm("waste", values({ qtyText: String(STOCK_QTY_MAX + 1) }), TODAY).qty?.startsWith("Enter at most"));
});

test("validateAdjustForm: a wastage must be above 0; a count may be 0", () => {
  assert.equal(validateAdjustForm("waste", values({ qtyText: "0" }), TODAY).qty, "Enter an amount above 0");
  assert.equal(validateAdjustForm("waste", values({ qtyText: "0.001" }), TODAY).qty, undefined, "1 milli is the smallest wastage");
  assert.equal(validateAdjustForm("count", values({ qtyText: "0" }), TODAY).qty, undefined);
});

test("validateAdjustForm: a wastage needs a reason; a count does not", () => {
  assert.equal(validateAdjustForm("waste", values({ reason: "" }), TODAY).reason, "Pick a reason");
  assert.equal(validateAdjustForm("count", values({ reason: "" }), TODAY).reason, undefined);
});

test("validateAdjustForm: wastage dates, edge by edge", () => {
  const msg = "Pick a date from the last 31 days, up to today";
  assert.equal(validateAdjustForm("waste", values({ date: "2026-10-13" }), TODAY).date, undefined, "31 days back is the oldest");
  assert.equal(validateAdjustForm("waste", values({ date: "2026-10-12" }), TODAY).date, msg);
  assert.equal(validateAdjustForm("waste", values({ date: "2026-11-14" }), TODAY).date, msg, "tomorrow");
  assert.equal(validateAdjustForm("waste", values({ date: "" }), TODAY).date, msg, "no date");
  assert.equal(validateAdjustForm("count", values({ date: "2020-01-01" }), TODAY).date, undefined, "a count is always today; its date is not asked");
});

test("validateAdjustForm: the note is capped after trimming", () => {
  const max = "a".repeat(STOCK_ENTRY_NOTE_MAX_LEN);
  assert.equal(validateAdjustForm("waste", values({ note: max }), TODAY).note, undefined);
  assert.equal(validateAdjustForm("waste", values({ note: ` ${max} ` }), TODAY).note, undefined, "spaces around do not count");
  assert.equal(validateAdjustForm("waste", values({ note: `${max}a` }), TODAY).note, `Keep the note to ${STOCK_ENTRY_NOTE_MAX_LEN} characters or fewer`);
});

test("buildStockEntryInput: a wastage carries milli-units, the reason and its own date", () => {
  assert.deepEqual(buildStockEntryInput("waste", values({ qtyText: "0.1", date: "2026-11-10" }), REF, TODAY), {
    kind: "waste",
    itemId: ITEM,
    qtyMilli: 100,
    reason: "Spoiled",
    date: "2026-11-10",
    clientRef: REF,
  });
  assert.equal((buildStockEntryInput("waste", values({ qtyText: "1.005" }), REF, TODAY) as { qtyMilli: number }).qtyMilli, 1005, "no float drift");
});

test("buildStockEntryInput: a count is dated today whatever the form holds, and zero is a real count", () => {
  assert.deepEqual(buildStockEntryInput("count", values({ qtyText: "0", date: "2026-10-20", reason: "" }), REF, TODAY), {
    kind: "count",
    itemId: ITEM,
    countedMilli: 0,
    date: TODAY,
    clientRef: REF,
  });
  assert.equal((buildStockEntryInput("count", values({ qtyText: "4.25" }), REF, TODAY) as { countedMilli: number }).countedMilli, 4250);
});

test("buildStockEntryInput: the note is trimmed, and an empty one sends no key", () => {
  assert.equal(buildStockEntryInput("waste", values({ note: "  dropped tray " }), REF, TODAY).note, "dropped tray");
  assert.ok(!("note" in buildStockEntryInput("waste", values({ note: "   " }), REF, TODAY)));
  assert.ok(!("note" in buildStockEntryInput("count", values({ note: "" }), REF, TODAY)));
  assert.equal(buildStockEntryInput("count", values({ note: " x " }), REF, TODAY).note, "x");
});

test("buildStockEntryInput: refuses an unparsable quantity or a missing reason", () => {
  assert.throws(() => buildStockEntryInput("waste", values({ qtyText: "" }), REF, TODAY));
  assert.throws(() => buildStockEntryInput("count", values({ qtyText: "x" }), REF, TODAY));
  assert.throws(() => buildStockEntryInput("waste", values({ reason: "" }), REF, TODAY));
});

test("countChangeText: the signed change the count would make", () => {
  assert.equal(countChangeText(3000, 4250, "kg"), "+1.25 kg");
  assert.equal(countChangeText(1000, 500, "kg"), "-500 g");
  assert.equal(countChangeText(2000, 2000, "L"), "No change");
  assert.equal(countChangeText(-1000, 2000, "pcs"), "+3 pcs", "from a negative stock");
});

test("entryChangeText: a history line shows its signed change", () => {
  const line = (qtyMilli: number, unit: StockEntryLineDto["unit"]): StockEntryLineDto => ({ itemId: ITEM, name: "Milk", unit, qtyMilli });
  assert.equal(entryChangeText(line(-500, "L")), "-500 ml");
  assert.equal(entryChangeText(line(-2000, "pcs")), "-2 pcs");
  assert.equal(entryChangeText(line(1250, "kg")), "+1.25 kg");
  assert.equal(entryChangeText({ ...line(0, "kg"), countedMilli: 4000 }), "No change");
});
