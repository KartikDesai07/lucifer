// U1 Task 3 (2026-10-21): the /pos item card's buying rules (owner Q5, design 6.4; values 4.1-4.2 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md). A price button adds at once: one button per variation up to
// three (the HTML's short size words), one "Choose" button with the price range beyond that (it opens the options
// modal), "Add" for an item sold one way; the add is exactly what the options modal adds when nothing in it is changed;
// the tag line under the name follows design 6.4's order.
import { test } from "node:test";
import assert from "node:assert/strict";

import { effectiveUnitPrice } from "@pos/shared/public";
import { initialSelected, pickModifierResult } from "./modifier-picker";
import { NO_TAG, cardTag, defaultAddOptions, priceButtonsFor, priceText, shortSize } from "./pos-price-buttons";

const plain = { price: 229, discount: 0, modifiers: [] as string[], available: true };

test("an item sold one way: one \"Add\" button at its price, adding the item itself", () => {
  assert.deepStrictEqual(
    priceButtonsFor(plain),
    [{ label: "Add", price: 229, opensOptions: false }],
    "values 4.2: label short(Standard) || 'Add', the item's price, no variation",
  );
  assert.equal(priceText(priceButtonsFor(plain)[0]), "₹229", "the HTML's RS(price): rupees, no decimals");
});

test("a discounted item: the button shows the price after the item's % discount (what the line bills)", () => {
  const discounted = { ...plain, price: 160, discount: 10 };
  const [button] = priceButtonsFor(discounted);
  assert.equal(button.price, 144, "160 at 10% off bills 144");
  assert.equal(button.price, effectiveUnitPrice(160, 10), "the same rule the cart bills with (effectiveUnitPrice)");
  const odd = { ...plain, price: 149, discount: 15 };
  assert.equal(priceButtonsFor(odd)[0].price, effectiveUnitPrice(149, 15), "whole rupees, as the cart rounds them");
});

test("two variations: one button each, the HTML's short words, each at its own price after the discount", () => {
  const shake = { ...plain, price: 140, discount: 10, variations: [{ name: "Regular", price: 140 }, { name: "Large", price: 170 }] };
  assert.deepStrictEqual(
    priceButtonsFor(shake),
    [
      { label: "Reg", price: effectiveUnitPrice(140, 10), variation: "Regular", opensOptions: false },
      { label: "Lrg", price: effectiveUnitPrice(170, 10), variation: "Large", opensOptions: false },
    ],
    "Regular -> Reg, Large -> Lrg; each button adds its own variation",
  );
});

test("three variations: three buttons; Medium -> Med, Standard -> Add, any other name stays as it is", () => {
  const pizza = {
    ...plain,
    price: 249,
    variations: [{ name: "Half", price: 249 }, { name: "Medium", price: 349 }, { name: "Standard", price: 449 }],
  };
  const buttons = priceButtonsFor(pizza);
  assert.deepStrictEqual(buttons.map((b) => b.label), ["Half", "Med", "Add"], "values 4.2 short(): Half stays, Medium -> Med, Standard -> Add");
  assert.deepStrictEqual(buttons.map((b) => b.variation), ["Half", "Medium", "Standard"], "each button carries the variation's full name");
  assert.deepStrictEqual(buttons.map((b) => b.price), [249, 349, 449], "each at its own price");
  assert.ok(buttons.every((b) => !b.opensOptions), "up to three, a tap adds at once");
  assert.equal(shortSize("6 pcs"), "6 pcs", "a name the HTML does not shorten stays whole");
  assert.equal(shortSize("Regular"), "Reg", "Regular -> Reg");
});

test("four variations: one \"Choose\" button with the cheapest and dearest price; it opens the options modal", () => {
  const coffee = {
    ...plain,
    price: 100,
    discount: 10,
    variations: [
      { name: "Small", price: 100 },
      { name: "Regular", price: 130 },
      { name: "Large", price: 160 },
      { name: "Jumbo", price: 190 },
    ],
  };
  const buttons = priceButtonsFor(coffee);
  assert.deepStrictEqual(
    buttons,
    [{ label: "Choose", price: effectiveUnitPrice(100, 10), priceMax: effectiveUnitPrice(190, 10), opensOptions: true }],
    "ruling P2: priceMax only on the Choose button; no variation on it (the modal asks)",
  );
  assert.equal(priceText(buttons[0]), "₹90–₹171", "shown ₹a–₹b (an en dash, no spaces)");
});

test("a variation item never adds without its size: every button names one of its variations, or opens the options", () => {
  for (let n = 1; n <= 6; n += 1) {
    const names = ["Regular", "Medium", "Large", "Half", "Full", "Jumbo"].slice(0, n);
    const item = { ...plain, variations: names.map((name, i) => ({ name, price: 100 + i * 10 })) };
    for (const b of priceButtonsFor(item)) {
      assert.ok(
        b.opensOptions ? b.variation === undefined : b.variation !== undefined && names.includes(b.variation),
        `${n} variation(s): "${b.label}" must add a named variation or open the options, never bill the base price`,
      );
    }
    assert.equal(priceButtonsFor(item).length, n <= 3 ? n : 1, `${n} variation(s): ${n <= 3 ? "one button each" : "one Choose button"}`);
  }
});

test("an out-of-stock item still gets its buttons (the card disables them, values 4.2)", () => {
  const oos = { ...plain, available: false, variations: [{ name: "Regular", price: 449 }, { name: "Medium", price: 569 }, { name: "Large", price: 689 }] };
  assert.deepStrictEqual(priceButtonsFor(oos).map((b) => `${b.label} ${priceText(b)}`), ["Reg ₹449", "Med ₹569", "Lrg ₹689"], "the HTML's Pepperoni");
});

// The options modal's add with nothing changed (components/pos/ModifierModal.tsx): it opens with initialSelected(product)
// ticked, no note, qty 1, then confirms {...pickModifierResult(product, selected), instructions: instructions.trim(),
// qty, variation}. lib/pos-tile-paths.test.ts pins that the modal still builds its add this way.
const modalUntouched = (product: { modifiers: string[]; modifiersPreselected?: boolean }, variation?: string) => ({
  ...pickModifierResult(product, initialSelected(product)),
  instructions: "",
  qty: 1,
  variation,
});

test("defaultAddOptions, normal item: no modifier, no note, qty 1 (none ticked, as the modal opens)", () => {
  const item = { modifiers: ["Extra cheese", "Olives"] };
  assert.deepStrictEqual(defaultAddOptions(item), { modifiers: [], instructions: "", qty: 1, variation: undefined }, "nothing ticked");
  assert.deepStrictEqual(defaultAddOptions(item), modalUntouched(item), "exactly the modal's untouched add");
  assert.deepStrictEqual(defaultAddOptions(item, "Large"), modalUntouched(item, "Large"), "with the button's variation");
  assert.equal(defaultAddOptions(item, "Large").variation, "Large", "the variation rides along");
});

test("defaultAddOptions, \"modifiers come ticked\": every modifier kept, so the line carries no removal (the kitchen prints nothing extra)", () => {
  const reverse = { modifiers: ["Onion", "Garlic"], modifiersPreselected: true };
  const opts = defaultAddOptions(reverse);
  assert.deepStrictEqual(opts, modalUntouched(reverse), "exactly the modal's untouched add (all ticked, none removed)");
  assert.ok(!("removedModifiers" in opts), "no removedModifiers key: nothing was unticked");
  assert.deepStrictEqual(opts.modifiers, [], "kept defaults print nothing: the line's modifiers stay empty, as the modal sends them");
  assert.deepStrictEqual(initialSelected(reverse), ["Onion", "Garlic"], "vision guard: the modal opens with every modifier ticked");
});

test("cardTag: Unavailable (bad) first, then the discount, then Customisable, then the category name, else a blank line", () => {
  const base = { available: true, discount: 0, modifiers: [] as string[] };
  const cat = { showCategory: true, categoryLabel: "Thick Shakes" };
  const none = { showCategory: false, categoryLabel: "Thick Shakes" };
  assert.deepStrictEqual(
    cardTag({ available: false, discount: 10, modifiers: ["A"] }, cat),
    { text: "Unavailable", tone: "bad" },
    "out of stock wins over everything, in --bad-i",
  );
  assert.deepStrictEqual(cardTag({ ...base, discount: 10, modifiers: ["A"] }, cat), { text: "10% off", tone: "plain" }, "then the discount");
  assert.deepStrictEqual(cardTag({ ...base, modifiers: ["A"] }, cat), { text: "Customisable", tone: "plain" }, "then add-ons");
  assert.deepStrictEqual(cardTag(base, cat), { text: "Thick Shakes", tone: "plain" }, "then the category (Normal layout, All)");
  assert.deepStrictEqual(cardTag(base, none), { text: NO_TAG, tone: "plain" }, "else blank");
  assert.equal(NO_TAG, " ", "a no-break space keeps the 16px tag line on every card (values 4.2)");
  assert.deepStrictEqual(cardTag(base, { showCategory: true, categoryLabel: "" }), { text: NO_TAG, tone: "plain" }, "an empty name never collapses the line");
});
