import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_SCALE,
  STOCK_UNITS,
  STOCK_UNIT_FACTOR,
  STOCK_UNIT_GROUP,
  STOCK_UNIT_LABEL,
  STOCK_USE_MAX_LINES,
  compatibleUnits,
  convertMilli,
  convertToMilli,
  formatQty,
  isStockUnit,
  milliToQty,
  qtyToMilli,
  stockLevel,
} from "./inventory";

test("units: every member has a group, a factor and a label", () => {
  assert.ok(STOCK_UNITS.length > 0);
  for (const unit of STOCK_UNITS) {
    assert.ok(STOCK_UNIT_GROUP[unit].length > 0, unit);
    assert.ok(STOCK_UNIT_FACTOR[unit] >= 1, unit);
    assert.ok(STOCK_UNIT_LABEL[unit].length > 0, unit);
  }
});

test("units: groups, factors and labels as specified", () => {
  assert.deepEqual([...STOCK_UNITS], ["kg", "g", "L", "ml", "pcs", "packet", "box", "bottle"]);
  assert.equal(STOCK_UNIT_GROUP.kg, "mass");
  assert.equal(STOCK_UNIT_GROUP.g, "mass");
  assert.equal(STOCK_UNIT_GROUP.L, "volume");
  assert.equal(STOCK_UNIT_GROUP.ml, "volume");
  for (const alone of ["pcs", "packet", "box", "bottle"] as const) {
    assert.equal(STOCK_UNIT_GROUP[alone], alone);
    assert.equal(STOCK_UNIT_FACTOR[alone], 1);
  }
  assert.equal(STOCK_UNIT_FACTOR.kg, 1000);
  assert.equal(STOCK_UNIT_FACTOR.g, 1);
  assert.equal(STOCK_UNIT_FACTOR.L, 1000);
  assert.equal(STOCK_UNIT_FACTOR.ml, 1);
  assert.equal(STOCK_UNIT_LABEL.kg, "Kilogram (kg)");
  assert.equal(STOCK_UNIT_LABEL.g, "Gram (g)");
  assert.equal(STOCK_UNIT_LABEL.L, "Litre (L)");
  assert.equal(STOCK_UNIT_LABEL.ml, "Millilitre (ml)");
  assert.equal(STOCK_UNIT_LABEL.pcs, "Pieces (pcs)");
  assert.equal(STOCK_UNIT_LABEL.packet, "Packet");
  assert.equal(STOCK_UNIT_LABEL.box, "Box");
  assert.equal(STOCK_UNIT_LABEL.bottle, "Bottle");
});

test("isStockUnit accepts members and rejects everything else", () => {
  for (const unit of STOCK_UNITS) assert.equal(isStockUnit(unit), true);
  for (const bad of ["kgs", "", "KG", "l", null, undefined, 1, {}]) {
    assert.equal(isStockUnit(bad), false);
  }
});

test("constants", () => {
  assert.equal(STOCK_QTY_SCALE, 1000);
  assert.equal(STOCK_USE_MAX_LINES, 10);
  assert.equal(STOCK_ITEM_NAME_MAX_LEN, 60);
});

test("qtyToMilli rounds once; 0.1 + 0.2 sums to exactly 300", () => {
  assert.equal(qtyToMilli(1.25), 1250);
  assert.equal(qtyToMilli(3), 3000);
  assert.equal(qtyToMilli(0), 0);
  assert.equal(qtyToMilli(0.1) + qtyToMilli(0.2), 100 + 200);
  assert.equal(qtyToMilli(0.1) + qtyToMilli(0.2), 300);
  assert.equal(qtyToMilli(1.0005), 1001);
  assert.ok(Number.isNaN(qtyToMilli(Number.NaN)));
});

test("milliToQty", () => {
  assert.equal(milliToQty(1250), 1.25);
  assert.equal(milliToQty(3000), 3);
  assert.equal(milliToQty(0), 0);
});

test("convertToMilli converts inside a group, rounding once", () => {
  assert.equal(convertToMilli(150, "ml", "L"), 150);
  assert.equal(convertToMilli(0.15, "L", "ml"), 150000);
  assert.equal(convertToMilli(10, "g", "kg"), 10);
  assert.equal(convertToMilli(1.5, "kg", "g"), 1500000);
  assert.equal(convertToMilli(2, "kg", "kg"), 2000);
  assert.equal(convertToMilli(3, "pcs", "pcs"), 3000);
});

test("convertToMilli across groups is null", () => {
  assert.equal(convertToMilli(1, "kg", "L"), null);
  assert.equal(convertToMilli(1, "ml", "g"), null);
  assert.equal(convertToMilli(1, "pcs", "packet"), null);
  assert.equal(convertToMilli(1, "box", "bottle"), null);
});

test("convertMilli: milli-units of one unit to milli-units of another in the same group, rounded once", () => {
  assert.equal(convertMilli(150000, "ml", "L"), 150); // 150 ml of a litre item
  assert.equal(convertMilli(150, "L", "ml"), 150000); // and back, for the editor
  assert.equal(convertMilli(10000, "g", "kg"), 10);
  assert.equal(convertMilli(1500, "kg", "g"), 1500000);
  assert.equal(convertMilli(2500, "pcs", "pcs"), 2500);
  assert.equal(convertMilli(500, "ml", "L"), 1); // half a milli-litre rounds up to 1
  assert.equal(convertMilli(400, "ml", "L"), 0); // under half rounds to 0: the caller refuses it
  assert.equal(convertMilli(1, "kg", "L"), null);
  assert.equal(convertMilli(1, "pcs", "packet"), null);
});

test("compatibleUnits: same group in list order", () => {
  assert.deepEqual(compatibleUnits("kg"), ["kg", "g"]);
  assert.deepEqual(compatibleUnits("g"), ["kg", "g"]);
  assert.deepEqual(compatibleUnits("L"), ["L", "ml"]);
  assert.deepEqual(compatibleUnits("pcs"), ["pcs"]);
  assert.deepEqual(compatibleUnits("bottle"), ["bottle"]);
});

test("formatQty", () => {
  assert.equal(formatQty(1250, "kg"), "1.25 kg");
  assert.equal(formatQty(3000, "pcs"), "3 pcs");
  assert.equal(formatQty(250, "kg"), "250 g");
  assert.equal(formatQty(150, "L"), "150 ml");
  assert.equal(formatQty(0, "kg"), "0 kg");
  assert.equal(formatQty(0, "L"), "0 L");
  assert.equal(formatQty(-2000, "pcs"), "-2 pcs");
  assert.equal(formatQty(1000, "kg"), "1 kg");
  assert.equal(formatQty(1500, "L"), "1.5 L");
  assert.equal(formatQty(1, "kg"), "1 g");
  assert.equal(formatQty(-250, "kg"), "-250 g");
  assert.equal(formatQty(-1500, "kg"), "-1.5 kg");
  assert.equal(formatQty(250, "g"), "0.25 g");
  assert.equal(formatQty(500, "pcs"), "0.5 pcs");
});

test("stockLevel edges", () => {
  assert.equal(stockLevel(0), "out");
  assert.equal(stockLevel(-1), "out");
  assert.equal(stockLevel(-5000, 1000), "out");
  assert.equal(stockLevel(0, 1000), "out");
  assert.equal(stockLevel(1000, 1000), "low");
  assert.equal(stockLevel(999, 1000), "low");
  assert.equal(stockLevel(1001, 1000), "ok");
  assert.equal(stockLevel(1), "ok");
  assert.equal(stockLevel(5000, undefined), "ok");
});
