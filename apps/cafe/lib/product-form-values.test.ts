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
import {
  addOnsFormError,
  addSizeRow,
  modifierPricesForCreate,
  modifierPricesForEdit,
  modifierPricesForSave,
  priceForSave,
  setAddOnAmount,
  switchPriceMode,
  valuesForValidation,
} from "./product-form-values";

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

// ── priced add-ons (owner 2026-11-02; D3 no amounts on a "comes ticked" item, D4 whole rupees) ───────────────────────

const BURST = { name: "Cheese Burst", price: 100 };
const PRICED = { modifiers: ["Cheese Burst", "Jalapeno"], modifierPrices: [BURST] };

test("modifierPrices round trip: an item's amounts come in as the form's list and go out as the save's list", () => {
  const form = { ...PRICED };
  assert.deepEqual(modifierPricesForSave(form), [BURST]);
  assert.deepEqual(modifierPricesForCreate(form), [BURST]);
  assert.deepEqual(modifierPricesForEdit(form, [BURST]), [BURST]);
  assert.deepEqual(modifierPricesForEdit(form, undefined), [BURST], "a first amount on an item that had none");
});

test("modifierPrices: a create with none sends no key; an edit sends null only when the item HAD amounts and now has none", () => {
  assert.equal(modifierPricesForCreate({ modifiers: ["A"] }), undefined, "absent stays absent");
  assert.equal(modifierPricesForCreate({ modifiers: ["A"], modifierPrices: [] }), undefined, "an emptied list is absent too");
  assert.equal(modifierPricesForEdit({ modifiers: ["A"], modifierPrices: [] }, [BURST]), null, "cleared on edit: the PUT's null sentinel");
  assert.equal(modifierPricesForEdit({ modifiers: ["A"] }, [BURST]), null);
  assert.equal(modifierPricesForEdit({ modifiers: ["A"], modifierPrices: [] }, undefined), undefined, "none before, none now: no key");
  assert.equal(modifierPricesForEdit({ modifiers: ["A"], modifierPrices: [] }, []), undefined);
});

test("modifierPrices: a removed or renamed add-on drops its amount; names go out exactly as in modifiers; one entry per name", () => {
  assert.deepEqual(modifierPricesForSave({ modifiers: ["Jalapeno"], modifierPrices: [BURST] }), [], "Cheese Burst left the list");
  assert.deepEqual(modifierPricesForSave({ modifiers: ["Cheese burst"], modifierPrices: [BURST] }), [], "a rename (even by case) is a different name");
  assert.deepEqual(modifierPricesForSave({ modifiers: ["Cheese Burst"], modifierPrices: [BURST, { name: "Cheese Burst", price: 5 }] }), [BURST]);
  assert.equal(modifierPricesForEdit({ modifiers: ["Jalapeno"], modifierPrices: [BURST] }, [BURST]), null, "removing the only priced add-on clears the stored amounts");
});

test("setAddOnAmount: whole rupees only - digits kept, an empty box means free, a re-type replaces", () => {
  assert.deepEqual(setAddOnAmount([], "Cheese Burst", "100"), [BURST]);
  assert.deepEqual(setAddOnAmount([BURST], "Cheese Burst", ""), [], "an emptied box clears the amount");
  assert.deepEqual(setAddOnAmount([BURST], "Cheese Burst", "12.5"), [{ name: "Cheese Burst", price: 125 }], "the dot is never typed (D4)");
  assert.deepEqual(setAddOnAmount([BURST], "Cheese Burst", "abc"), [], "no digits = empty = free");
  assert.deepEqual(setAddOnAmount([BURST], "Jalapeno", "20"), [BURST, { name: "Jalapeno", price: 20 }], "another add-on's amount is untouched");
  assert.deepEqual(setAddOnAmount([], "Cheese Burst", "99999999"), [{ name: "Cheese Burst", price: 999999 }], "capped at the digits the server's maximum has");
});

test("addOnsFormError: the server's own message, before the request (D3 ticked, D4 whole rupees 1..max, names in modifiers)", () => {
  assert.equal(addOnsFormError(PRICED), null);
  assert.equal(addOnsFormError({ modifiers: ["A"] }), null, "no amounts, nothing to judge");
  assert.match(addOnsFormError({ ...PRICED, modifiersPreselected: true }) ?? "", /cannot be set while the item's add-ons come ticked/);
  assert.match(addOnsFormError({ modifiers: ["Cheese Burst"], modifierPrices: [{ name: "Cheese Burst", price: 0 }] }) ?? "", /must be whole rupees, from 1 to 100000/);
  assert.match(addOnsFormError({ modifiers: ["Cheese Burst"], modifierPrices: [{ name: "Cheese Burst", price: 12.5 }] }) ?? "", /whole rupees/);
  // "comes ticked" counts only with an add-on: the save sends false then (modifiersPreselectedToSave), so no refusal.
  assert.equal(addOnsFormError({ modifiers: [], modifiersPreselected: true, modifierPrices: [BURST] }), null, "orphan amount is dropped by the save, not an error");
  assert.equal(addOnsFormError({ modifiers: ["Jalapeno"], modifierPrices: [BURST] }), null, "an amount whose add-on was removed is dropped by the save");
});

test("PIN: the sheet sends modifierPrices through the helpers (create: no key when none; edit: null sentinel) and judges the rule in its resolver", () => {
  assert.ok(sheet.includes("modifierPrices: modifierPricesForCreate(values),"), "a create sends the list or no key");
  assert.ok(sheet.includes("modifierPrices: modifierPricesForEdit(values, product.modifierPrices),"), "an edit sends the list, or null when cleared");
  assert.ok(sheet.includes("addOnsFormError(values)"), "the form shows the server's refusal before any request");
  assert.ok(sheet.includes("modifierPrices: product.modifierPrices,"), "the editor opens with the stored amounts");
  assert.match(sheet, /<ModifierInput id="product-modifiers"[\s\S]*?prices=\{modifierPrices\}[\s\S]*?ticked=\{ticked\}/, "the input gets the amounts and the ticked switch");
});
