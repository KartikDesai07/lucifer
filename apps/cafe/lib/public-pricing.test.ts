import { test } from "node:test";
import assert from "node:assert/strict";

import { effectiveUnitPrice } from "@pos/shared/public";
import {
  derivedLinePrice,
  priceRequestItems,
  UNKNOWN_ITEM_ERROR,
  SOLD_OUT_ERROR,
  UNKNOWN_MODIFIER_ERROR,
  type PricedProductSource,
} from "./public-pricing";

// CR2.2 SLICE 3 — server-side pricing for a diner-submitted public order.
// DB-free: every product row here is a plain fixture, exactly the shape the
// order route would pass in after its own `Product.find`.

const SIZED_PRODUCT: PricedProductSource = {
  _id: "64f000000000000000000001",
  name: "Pizza",
  price: 200, // base/reference price — overridden by variations for ordering
  discount: 10,
  available: true,
  modifiers: ["Extra cheese", "No onion"],
  variations: [
    { name: "Small", price: 150 },
    { name: "Large", price: 300 },
  ],
};

const PLAIN_PRODUCT: PricedProductSource = {
  _id: "64f000000000000000000002",
  name: "Filter Coffee",
  price: 40,
  discount: 0,
  available: true,
  modifiers: [],
};

// ── derivedLinePrice: matches hooks/use-cart.ts's addToCart math exactly ────

test("derivedLinePrice: a named variation's OWN price runs through the PRODUCT's discount", () => {
  // use-cart.ts: effectivePrice({ price: chosenVariation.price, discount: product.discount })
  const expected = effectiveUnitPrice(150, SIZED_PRODUCT.discount);
  assert.equal(derivedLinePrice(SIZED_PRODUCT, "Small"), expected);
  assert.equal(expected, 135); // 150 - 10% = 135, sanity-pins the formula itself
});

test("derivedLinePrice: no variation given falls back to the product's own price × discount", () => {
  const expected = effectiveUnitPrice(SIZED_PRODUCT.price, SIZED_PRODUCT.discount);
  assert.equal(derivedLinePrice(SIZED_PRODUCT), expected);
});

test("derivedLinePrice: discount 0 leaves the price untouched", () => {
  assert.equal(derivedLinePrice(PLAIN_PRODUCT), 40);
});

test("derivedLinePrice: a variation name absent from the product returns null (never the base price)", () => {
  assert.equal(derivedLinePrice(SIZED_PRODUCT, "Medium"), null);
});

// ── priceRequestItems: rejections ───────────────────────────────────────────

test("priceRequestItems: unknown productId is rejected with UNKNOWN_ITEM_ERROR", () => {
  const result = priceRequestItems([PLAIN_PRODUCT], [
    { productId: "no-such-id", modifiers: [], qty: 1 },
  ]);
  assert.deepEqual(result, { error: UNKNOWN_ITEM_ERROR });
});

test("priceRequestItems: available:false is rejected with SOLD_OUT_ERROR naming the product", () => {
  const soldOut: PricedProductSource = { ...PLAIN_PRODUCT, available: false };
  const result = priceRequestItems([soldOut], [
    { productId: String(soldOut._id), modifiers: [], qty: 1 },
  ]);
  assert.deepEqual(result, { error: SOLD_OUT_ERROR(soldOut.name) });
});

test("priceRequestItems: a variation name the product doesn't have is rejected (checkItemVariations' own message)", () => {
  const result = priceRequestItems([SIZED_PRODUCT], [
    { productId: String(SIZED_PRODUCT._id), variation: "Medium", modifiers: [], qty: 1 },
  ]);
  assert.equal("error" in result, true);
  if ("error" in result) {
    assert.match(result.error, /Medium/);
    assert.match(result.error, /Pizza/);
  }
});

test("priceRequestItems: a sized product ordered with no variation is rejected (variation required)", () => {
  const result = priceRequestItems([SIZED_PRODUCT], [
    { productId: String(SIZED_PRODUCT._id), modifiers: [], qty: 1 },
  ]);
  assert.equal("error" in result, true);
});

test('priceRequestItems: unknown modifier is rejected, INCLUDING one literally named "constructor" (must not resolve via the prototype chain)', () => {
  const withPrototypeModifier = priceRequestItems([PLAIN_PRODUCT], [
    { productId: String(PLAIN_PRODUCT._id), modifiers: ["constructor"], qty: 1 },
  ]);
  assert.deepEqual(withPrototypeModifier, {
    error: UNKNOWN_MODIFIER_ERROR(PLAIN_PRODUCT.name, "constructor"),
  });

  const withOrdinaryUnknown = priceRequestItems([SIZED_PRODUCT], [
    {
      productId: String(SIZED_PRODUCT._id),
      variation: "Small",
      modifiers: ["Extra spicy"],
      qty: 1,
    },
  ]);
  assert.deepEqual(withOrdinaryUnknown, {
    error: UNKNOWN_MODIFIER_ERROR(SIZED_PRODUCT.name, "Extra spicy"),
  });
});

// ── priceRequestItems: the happy path — server name/price/qty ──────────────

test("priceRequestItems: the built line's name and price are the SERVER's, ignoring anything a client-shaped object claims for those fields", () => {
  // The public route's Zod input shape carries no name/price fields at all —
  // this simulates a hand-crafted request body that tries to smuggle them in
  // anyway, proving priceRequestItems never reads them off the item.
  const spoofedItem = {
    productId: String(PLAIN_PRODUCT._id),
    modifiers: [],
    qty: 1,
    name: "Free Yacht",
    price: 0,
  };
  const result = priceRequestItems([PLAIN_PRODUCT], [spoofedItem]);
  assert.deepEqual(result, {
    lines: [
      {
        productId: String(PLAIN_PRODUCT._id),
        name: PLAIN_PRODUCT.name,
        price: 40,
        qty: 1,
        modifiers: [],
      },
    ],
  });
});

test("priceRequestItems: qty passes through unchanged, and a valid variation + modifier line prices correctly end to end", () => {
  const result = priceRequestItems([SIZED_PRODUCT], [
    {
      productId: String(SIZED_PRODUCT._id),
      variation: "Large",
      modifiers: ["Extra cheese"],
      instructions: "no onion please",
      qty: 3,
    },
  ]);
  assert.deepEqual(result, {
    lines: [
      {
        productId: String(SIZED_PRODUCT._id),
        name: "Pizza",
        price: effectiveUnitPrice(300, 10), // Large's own price × the product's discount
        qty: 3,
        variation: "Large",
        modifiers: ["Extra cheese"],
        instructions: "no onion please",
      },
    ],
  });
});

test("priceRequestItems: omit-empty — no variation/instructions on the item means neither key appears on the line", () => {
  const result = priceRequestItems([PLAIN_PRODUCT], [
    { productId: String(PLAIN_PRODUCT._id), modifiers: [], qty: 1 },
  ]);
  assert.equal("lines" in result, true);
  if ("lines" in result) {
    assert.equal("variation" in result.lines[0], false);
    assert.equal("instructions" in result.lines[0], false);
  }
});

test("priceRequestItems: fails fast on the FIRST rejected item, never pricing the rest", () => {
  const result = priceRequestItems([PLAIN_PRODUCT], [
    { productId: "unknown-1", modifiers: [], qty: 1 },
    { productId: String(PLAIN_PRODUCT._id), modifiers: [], qty: 1 },
  ]);
  assert.deepEqual(result, { error: UNKNOWN_ITEM_ERROR });
});
