import { test } from "node:test";
import assert from "node:assert/strict";

import { PUBLIC_ORDER_MAX_ITEMS, PUBLIC_ORDER_MAX_QTY } from "@pos/shared/public";
import { buildRepeatCart } from "@/components/public/public-cart-math";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";

// CB-4 — "Order this again". These pin the rule that makes a repeat SAFE: the
// past order is a suggestion, the LIVE menu is the authority. A repeat that
// trusted the old order's own prices/items would re-add a delisted product, or
// charge a price the cafe no longer sells at.

function product(over: Partial<PublicMenuProduct> & { id: string }): PublicMenuProduct {
  return {
    name: `Item ${over.id}`,
    category: "Food",
    price: 100,
    discount: 0,
    available: true,
    image: "",
    modifiers: [],
    ...over,
  };
}

function pastItem(productId: string, qty = 1, variation?: string) {
  return { productId, qty, modifiers: [] as string[], ...(variation ? { variation } : {}) };
}

test("buildRepeatCart adds every still-available line and reports nothing skipped", () => {
  const menu = [product({ id: "a" }), product({ id: "b" })];
  const { next, added, skipped } = buildRepeatCart([], [pastItem("a", 2), pastItem("b")], menu);
  assert.equal(added, 2);
  assert.equal(skipped, 0);
  assert.equal(next.length, 2);
  assert.equal(next[0].qty, 2);
});

test("buildRepeatCart SKIPS a product that is no longer on the menu at all — a delisted item must never come back", () => {
  const menu = [product({ id: "a" })];
  const { next, added, skipped } = buildRepeatCart([], [pastItem("a"), pastItem("gone")], menu);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.equal(next.length, 1);
  assert.equal(next[0].productId, "a");
});

test("buildRepeatCart SKIPS a product marked unavailable today (sold out) rather than adding it", () => {
  const menu = [product({ id: "a", available: false })];
  const { added, skipped, next } = buildRepeatCart([], [pastItem("a")], menu);
  assert.equal(added, 0);
  assert.equal(skipped, 1);
  assert.equal(next.length, 0);
});

test("buildRepeatCart SKIPS a line whose variation no longer exists — re-adding at the BASE price would be a silent price change", () => {
  // The product still sells, but not in the size the diner originally ordered.
  const menu = [product({ id: "a", variations: [{ name: "Large", price: 200 }] })];
  const { added, skipped } = buildRepeatCart([], [pastItem("a", 1, "Small")], menu);
  assert.equal(added, 0, "a vanished variation must not silently fall back to the base price");
  assert.equal(skipped, 1);
});

test("buildRepeatCart prices from the LIVE menu, never from the past order", () => {
  // The cafe has since raised the price. The rebuilt line must carry the NEW
  // price — the past order's number is not an input at all.
  const menu = [product({ id: "a", price: 250 })];
  const { next } = buildRepeatCart([], [pastItem("a")], menu);
  assert.equal(next[0].price, 250);
});

test("buildRepeatCart applies the live DISCOUNT when pricing the repeated line", () => {
  const menu = [product({ id: "a", price: 200, discount: 10 })];
  const { next } = buildRepeatCart([], [pastItem("a")], menu);
  assert.equal(next[0].price, 180, "the live discount must be applied, not the old quoted price");
});

test("buildRepeatCart MERGES into an existing identical cart line instead of duplicating it", () => {
  const menu = [product({ id: "a" })];
  const first = buildRepeatCart([], [pastItem("a", 2)], menu);
  const second = buildRepeatCart(first.next, [pastItem("a", 3)], menu);
  assert.equal(second.next.length, 1, "the same product+variation+modifiers is ONE cart line");
  assert.equal(second.next[0].qty, 5);
});

test("buildRepeatCart clamps a single line to PUBLIC_ORDER_MAX_QTY", () => {
  const menu = [product({ id: "a" })];
  const { next } = buildRepeatCart([], [pastItem("a", PUBLIC_ORDER_MAX_QTY + 50)], menu);
  assert.equal(next[0].qty, PUBLIC_ORDER_MAX_QTY);
});

test("buildRepeatCart respects the whole-cart item cap and REPORTS the overflow as skipped", () => {
  // A cart already at the cap cannot take another distinct line — and the
  // diner has to be told, or a short repeat reads as a faithful one.
  const menu = Array.from({ length: PUBLIC_ORDER_MAX_ITEMS + 2 }, (_, i) => product({ id: `p${i}` }));
  const items = menu.map((p) => pastItem(p.id));
  const { next, added, skipped } = buildRepeatCart([], items, menu);
  assert.equal(next.length, PUBLIC_ORDER_MAX_ITEMS);
  assert.equal(added, PUBLIC_ORDER_MAX_ITEMS);
  assert.equal(skipped, 2, "lines that did not fit must be counted as skipped, never dropped silently");
});

test("buildRepeatCart never mutates the cart it was handed", () => {
  const menu = [product({ id: "a" })];
  const prev = buildRepeatCart([], [pastItem("a")], menu).next;
  const snapshot = JSON.stringify(prev);
  buildRepeatCart(prev, [pastItem("a", 4)], menu);
  assert.equal(JSON.stringify(prev), snapshot, "the input cart must be treated as immutable");
});

test("buildRepeatCart on an empty past order is a no-op, not an error", () => {
  const { next, added, skipped } = buildRepeatCart([], [], [product({ id: "a" })]);
  assert.deepEqual(next, []);
  assert.equal(added, 0);
  assert.equal(skipped, 0);
});
