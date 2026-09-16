import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkItemVariations,
  VARIATION_REQUIRED_ERROR,
  VARIATION_UNKNOWN_ERROR,
  type VariationSource,
  type OrderedItem,
} from "./variations";

// checkItemVariations is PURE (no DB) — both order write paths query
// `Product.find(...).select("name variations").lean()` themselves and pass
// the rows straight in, so these fakes stand in for that lean() read.

const PLAIN: VariationSource = { _id: "p1", name: "Tea" };
const SIZED: VariationSource = {
  _id: "p2",
  name: "Coco",
  variations: [{ name: "Small", price: 99 }, { name: "Large", price: 149 }],
};

test("a plain item on a plain (no-variations) product is coherent — null", () => {
  const items: OrderedItem[] = [{ productId: "p1", name: "Tea" }];
  assert.equal(checkItemVariations([PLAIN], items), null);
});

test("a variation item on a matching product is coherent — null", () => {
  const items: OrderedItem[] = [
    { productId: "p2", name: "Coco", variation: "Small" },
  ];
  assert.equal(checkItemVariations([SIZED], items), null);
});

test("a product WITH variations ordered without one is rejected — REQUIRED, names the product", () => {
  const items: OrderedItem[] = [{ productId: "p2", name: "Coco" }];
  assert.equal(
    checkItemVariations([SIZED], items),
    VARIATION_REQUIRED_ERROR("Coco"),
  );
});

test("an unknown variation name is rejected — UNKNOWN, names both the item and the bad variation", () => {
  const items: OrderedItem[] = [
    { productId: "p2", name: "Coco", variation: "Medium" },
  ];
  assert.equal(
    checkItemVariations([SIZED], items),
    VARIATION_UNKNOWN_ERROR("Coco", "Medium"),
  );
});

test("a variation sent for a product that has none is rejected — UNKNOWN", () => {
  const items: OrderedItem[] = [
    { productId: "p1", name: "Tea", variation: "Large" },
  ];
  assert.equal(
    checkItemVariations([PLAIN], items),
    VARIATION_UNKNOWN_ERROR("Tea", "Large"),
  );
});

test("an unknown productId is skipped, not rejected — existence is not this function's job", () => {
  const items: OrderedItem[] = [
    { productId: "ghost", name: "Nothing", variation: "Whatever" },
  ];
  assert.equal(checkItemVariations([PLAIN, SIZED], items), null);
});

test("an empty items array is coherent — null", () => {
  assert.equal(checkItemVariations([PLAIN, SIZED], []), null);
});

test("when two lines are bad, the FIRST bad line is the one reported", () => {
  const items: OrderedItem[] = [
    { productId: "p2", name: "Coco" }, // bad: missing variation
    { productId: "p1", name: "Tea", variation: "Large" }, // also bad: unknown variation
  ];
  assert.equal(
    checkItemVariations([SIZED, PLAIN], items),
    VARIATION_REQUIRED_ERROR("Coco"),
    "the first bad line (Coco, missing variation) must win over the second (Tea, unknown variation)",
  );
});
