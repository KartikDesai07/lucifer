import { test } from "node:test";
import assert from "node:assert/strict";

import { ADD_ON_PRICES_TICKED_ERROR, ADD_ON_PRICE_UNKNOWN_ERROR } from "@pos/shared/modifier-prices";
import { productUpdateAddOnsError, type AddOnFields, type AddOnReader } from "./product-addons-check";

// Priced add-ons (owner, 2026-11-02): a PUT body is partial, so the rule is
// judged on the stored item merged with the body. The reader is injected so
// these run DB-free.

const STORED: AddOnFields = {
  modifiers: ["Cheese Burst", "Jalapeno"],
  modifierPrices: [{ name: "Cheese Burst", price: 100 }],
};
function reader(doc: AddOnFields | null): { read: AddOnReader; reads: string[] } {
  const reads: string[] = [];
  return { reads, read: async (id) => (reads.push(id), doc) };
}

test("a bare { modifiersPreselected: true } on an item with amounts is refused", async () => {
  const r = reader(STORED);
  assert.equal(await productUpdateAddOnsError("i1", { modifiersPreselected: true }, r.read), ADD_ON_PRICES_TICKED_ERROR);
  assert.deepEqual(r.reads, ["i1"]);
});

test("a body with none of the three keys reads nothing and passes", async () => {
  const r = reader(STORED);
  assert.equal(await productUpdateAddOnsError("i1", {}, r.read), null);
  assert.equal(await productUpdateAddOnsError("i1", { price: 5 } as AddOnFields, r.read), null);
  assert.deepEqual(r.reads, [], "no read for a price/name/available edit");
});

test("modifierPrices: null clears the amounts, so turning ticks on is then fine", async () => {
  const r = reader(STORED);
  assert.equal(await productUpdateAddOnsError("i1", { modifierPrices: null, modifiersPreselected: true }, r.read), null);
  assert.equal(await productUpdateAddOnsError("i1", { modifierPrices: null }, r.read), null);
});

test("a modifiers edit that orphans an amount is refused; keeping it passes", async () => {
  const r = reader(STORED);
  assert.equal(
    await productUpdateAddOnsError("i1", { modifiers: ["Jalapeno"] }, r.read),
    ADD_ON_PRICE_UNKNOWN_ERROR("Cheese Burst"),
  );
  assert.equal(await productUpdateAddOnsError("i1", { modifiers: ["Cheese Burst", "Corn"] }, r.read), null);
});

test("a body amounts list wins over the stored one; stored modifiers still apply", async () => {
  const r = reader(STORED);
  assert.equal(await productUpdateAddOnsError("i1", { modifierPrices: [{ name: "Jalapeno", price: 20 }] }, r.read), null);
  assert.equal(
    await productUpdateAddOnsError("i1", { modifierPrices: [{ name: "Corn", price: 20 }] }, r.read),
    ADD_ON_PRICE_UNKNOWN_ERROR("Corn"),
  );
});

test("a missing item is no objection (the route 404s it)", async () => {
  const r = reader(null);
  assert.equal(await productUpdateAddOnsError("nope", { modifiersPreselected: true }, r.read), null);
  assert.deepEqual(r.reads, ["nope"]);
});
