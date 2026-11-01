// U5 Task 3 (2026-11-01; owner Q9; design 6.9): the item editor's price modes. In Sizes mode the base-price box is hidden:
// a new sized item sends price 0, an edit keeps its stored price, a hidden base-price problem can never block Save, and
// Sizes -> Single shows the stored price again. The null sentinels of the save (icon, publicVisible, stationId, noKot,
// variations) keep their meaning: pinned on the sheet's source (menu P14, P51, P53, P59).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createProductSchema } from "@pos/shared/schemas";
import { stripComments } from "./source-pin-utils";
import { addSizeRow, priceForSave, switchPriceMode, valuesForValidation } from "./product-form-values";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const sheet = stripComments(readFileSync(path.join(CAFE_ROOT, "components/products/ProductFormSheet.tsx"), "utf8").replace(/\r\n/g, "\n"));
const CAT = "64b7f0c2a1d2e3f4a5b6c7d8";
const SIZES = [
  { name: "Small", price: 99 },
  { name: "Large", price: 149 },
];

test("priceForSave: a new item in Sizes mode sends price 0", () => {
  assert.equal(priceForSave({ hasVariations: true, price: 120 }, true), 0, "a new sized item stores no base price (Q9)");
  assert.equal(priceForSave({ hasVariations: true, price: Number.NaN }, true), 0, "an empty hidden box is still 0");
});

test("priceForSave: an edit keeps the form's (stored) price, in either mode", () => {
  assert.equal(priceForSave({ hasVariations: true, price: 120 }, false), 120, "an edited sized item keeps its stored price");
  assert.equal(priceForSave({ hasVariations: false, price: 120 }, false), 120, "a single-price edit sends the typed price");
});

test("priceForSave: Single mode sends the typed price, new or not", () => {
  assert.equal(priceForSave({ hasVariations: false, price: 85.5 }, true), 85.5, "decimals stay as today");
});

test("valuesForValidation: a hidden (Sizes-mode) base-price error never blocks the submit", () => {
  const bad = { name: "Pizza", categoryId: CAT, price: Number.NaN, variations: SIZES };
  assert.equal(createProductSchema.safeParse(bad).success, false, "the raw NaN price would fail the schema");
  const checked = createProductSchema.safeParse(valuesForValidation(bad));
  assert.equal(checked.success, true, "in Sizes mode the hidden price is normalised before the schema sees it");
});

test("valuesForValidation: Single mode still reports the price (nothing hidden)", () => {
  const bad = { name: "Tea", categoryId: CAT, price: Number.NaN };
  assert.equal(createProductSchema.safeParse(valuesForValidation(bad)).success, false, "an empty single price is still an error");
});

test("switchPriceMode: Sizes -> Single shows the stored price and drops the sizes", () => {
  const out = switchPriceMode({ price: 120, variations: SIZES }, "single", 120);
  assert.equal(out.price, 120, "the stored price is shown again");
  assert.equal(out.variations, undefined, "off = absent (the sheet's save then sends null)");
});

test("switchPriceMode: Single -> Sizes seeds one empty row (today's seed) and repairs an empty base price", () => {
  const out = switchPriceMode({ price: Number.NaN, variations: undefined }, "sizes", 90);
  assert.deepEqual(out.variations, [{ name: "", price: 0 }], "today's seed row");
  assert.equal(out.price, 90, "a cleared price falls back to the stored one");
  assert.equal(switchPriceMode({ price: 50, variations: undefined }, "sizes", 90).price, 50, "a typed price is kept");
});

test("addSizeRow: stops at 20 rows (MAX_VARIATIONS), as today", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, price: 1 }));
  assert.equal(addSizeRow(twenty).length, 20, "no 21st row");
  assert.equal(addSizeRow(SIZES).length, 3, "one more row");
});

test("the save keeps its null sentinels and its create spread (menu P14, P51, P53, P59)", () => {
  assert.match(sheet, /variations: values\.variations \?\? null,/, "variations: null clears the stored sizes");
  assert.match(sheet, /publicVisible: values\.publicVisible \?\? null,/, "publicVisible: null");
  assert.match(sheet, /icon: values\.icon \?\? null,/, "icon: null");
  assert.match(sheet, /stationId: values\.stationId \?\? null,/, "stationId: null");
  assert.match(sheet, /noKot: values\.noKot \?\? null,/, "noKot: null");
  assert.match(sheet, /price: priceForSave\(\{ hasVariations: values\.variations !== undefined, price: values\.price \}, false\),/, "an edit sends priceForSave(..., false)");
  assert.match(sheet, /await createProduct\.mutateAsync\(\{\s*\.\.\.values,\s*price: priceForSave\(\{ hasVariations: values\.variations !== undefined, price: values\.price \}, true\),/, "a create spreads the values with priceForSave(..., true)");
});
