import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStockUseInput, displayUnitFor, emptyRow, rowsFromDto, sameRows, type StockUseItemInfo, type StockUseRow } from "@/lib/inventory/stock-use-form";
import type { StockUseDto } from "@/types/inventory";

const MILK = "64b000000000000000000001";
const CUPS = "64b000000000000000000002";
const BEANS = "64b000000000000000000003";

const items = new Map<string, StockUseItemInfo>([
  [MILK, { name: "Milk", unit: "L" }],
  [CUPS, { name: "Cups", unit: "pcs" }],
  [BEANS, { name: "Beans", unit: "kg", archived: true }],
]);

const row = (patch: Partial<StockUseRow>): StockUseRow => ({ ...emptyRow("k"), itemId: MILK, unit: "ml", amount: "150", ...patch });

test("displayUnitFor: sub-unit amounts read in g / ml, anything else in the item's unit", () => {
  assert.equal(displayUnitFor("L", [150]), "ml");
  assert.equal(displayUnitFor("kg", [1500]), "kg");
  assert.equal(displayUnitFor("kg", [250, 0]), "g");
  assert.equal(displayUnitFor("L", [250, 1000]), "L");
  assert.equal(displayUnitFor("L", [0, 0]), "L", "all zero keeps the unit");
  assert.equal(displayUnitFor("pcs", [1]), "pcs");
});

test("round trip: 150 milli-L shows as 150 ml and goes back as 150000 milli-ml", () => {
  const dto: StockUseDto = { lines: [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: 150 }] };
  const rows = rowsFromDto(dto, []);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], key: "" }, { key: "", itemId: MILK, unit: "ml", amount: "150", perSize: false, sizeAmounts: {} });
  const built = buildStockUseInput(rows, [], items);
  assert.deepEqual(built, { ok: true, input: { lines: [{ itemId: MILK, unit: "ml", qtyMilli: 150000 }] } });
});

test("a kg item at 1500 milli stays 1.5 kg; 250 milli-kg shows 250 g", () => {
  const dto: StockUseDto = { lines: [{ itemId: BEANS, name: "Beans", unit: "kg", qtyMilli: 1500, archived: true }] };
  const [r] = rowsFromDto(dto, []);
  assert.equal(r.unit, "kg");
  assert.equal(r.amount, "1.5");
  const small = rowsFromDto({ lines: [{ itemId: BEANS, name: "Beans", unit: "kg", qtyMilli: 250 }] }, [])[0];
  assert.equal(small.unit, "g");
  assert.equal(small.amount, "250");
  const wide = rowsFromDto({ lines: [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: 1250 }] }, [])[0];
  assert.equal(wide.amount, "1.25");
});

test("sizes: kept for the current size names, a vanished size dropped, a missing size filled with the base amount", () => {
  const dto: StockUseDto = {
    lines: [{ itemId: MILK, name: "Milk", unit: "L", qtyMilli: 150, sizes: [{ name: "Small", qtyMilli: 100 }, { name: "Gone", qtyMilli: 999 }] }],
  };
  const [r] = rowsFromDto(dto, ["Small", "Large"]);
  assert.equal(r.perSize, true);
  assert.deepEqual(r.sizeAmounts, { Small: "100", Large: "150" });
  const noSizes = rowsFromDto(dto, [])[0];
  assert.equal(noSizes.perSize, false, "a product without sizes shows no per-size state");
  assert.deepEqual(noSizes.sizeAmounts, {});
  const built = buildStockUseInput([r], ["Small", "Large"], items);
  assert.deepEqual(built, {
    ok: true,
    input: { lines: [{ itemId: MILK, unit: "ml", qtyMilli: 150000, sizes: [{ name: "Small", qtyMilli: 100000 }, { name: "Large", qtyMilli: 150000 }] }] },
  });
});

test("sizes: a zero is allowed; sizes are sent in the product's order, only when perSize", () => {
  const r = row({ perSize: true, sizeAmounts: { Large: "200", Small: "0" } });
  const built = buildStockUseInput([r], ["Small", "Large"], items);
  assert.ok(built.ok);
  if (built.ok) assert.deepEqual(built.input.lines[0].sizes, [{ name: "Small", qtyMilli: 0 }, { name: "Large", qtyMilli: 200000 }]);
  const off = buildStockUseInput([row({ perSize: false, sizeAmounts: { Small: "1" } })], ["Small"], items);
  assert.ok(off.ok);
  if (off.ok) assert.ok(!("sizes" in off.input.lines[0]), "no sizes key while the toggle is off");
  const noSizeProduct = buildStockUseInput([row({ perSize: true, sizeAmounts: {} })], [], items);
  assert.ok(noSizeProduct.ok);
  if (noSizeProduct.ok) assert.ok(!("sizes" in noSizeProduct.input.lines[0]), "no sizes key for a product without sizes");
});

test("errors: each in plain English, nothing built", () => {
  const err = (rows: StockUseRow[], sizes: string[] = []): string => {
    const r = buildStockUseInput(rows, sizes, items);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  assert.equal(err([row({ itemId: "" })]), "Pick a stock item in every row");
  assert.equal(err([row({ amount: "" })]), "Enter an amount above 0 for Milk");
  assert.equal(err([row({ amount: "0" })]), "Enter an amount above 0 for Milk");
  assert.equal(err([row({ amount: "abc" })]), "Enter a number, like 2 or 1.5 (Milk)");
  assert.equal(err([row({ amount: "1.2345" })]), "Use at most 3 decimal places (Milk)");
  assert.equal(err([row({ itemId: BEANS, unit: "kg" })]), "Beans is archived. Remove it from this item's stock use.");
  assert.equal(err([row({}), row({ key: "k2" })]), "A stock item is listed twice");
  assert.equal(err([row({ perSize: true, sizeAmounts: { Small: "5" } })], ["Small", "Large"]), "Enter an amount for each size of Milk");
  assert.match(err([row({ perSize: true, sizeAmounts: { Small: "x", Large: "1" } })], ["Small", "Large"]), /^Enter a number, like 2 or 1\.5 \(Milk/);
});

test("no rows builds lines: [] (clears)", () => {
  assert.deepEqual(buildStockUseInput([], [], items), { ok: true, input: { lines: [] } });
});

test("an archived line round-trips with its name; unchanged detection ignores the key", () => {
  const dto: StockUseDto = { lines: [{ itemId: BEANS, name: "Beans", unit: "kg", qtyMilli: 1500, archived: true }] };
  const rows = rowsFromDto(dto, []);
  const byId = new Map<string, StockUseItemInfo>(dto.lines.map((l) => [l.itemId, { name: l.name, unit: l.unit, archived: l.archived }]));
  assert.deepEqual(buildStockUseInput(rows, [], byId), { ok: false, error: "Beans is archived. Remove it from this item's stock use." });
  assert.ok(sameRows(rows, rowsFromDto(dto, [])));
  assert.ok(sameRows(rows, [{ ...rows[0], key: "other" }]), "the key is ignored");
});

test("sameRows: any real edit, an added or removed row shows as changed; per-size text counts only while on", () => {
  const base = [row({})];
  assert.ok(sameRows(base, [row({ key: "z" })]));
  assert.ok(!sameRows(base, [row({ amount: "151" })]));
  assert.ok(!sameRows(base, [row({ unit: "L" })]));
  assert.ok(!sameRows(base, [row({ itemId: CUPS })]));
  assert.ok(!sameRows(base, [row({ perSize: true })]));
  assert.ok(!sameRows(base, []));
  assert.ok(!sameRows(base, [row({}), row({})]));
  assert.ok(sameRows([row({ sizeAmounts: { S: "1" } })], [row({ sizeAmounts: { S: "2" } })]), "off: size texts ignored");
  assert.ok(!sameRows([row({ perSize: true, sizeAmounts: { S: "1" } })], [row({ perSize: true, sizeAmounts: { S: "2" } })]));
});
