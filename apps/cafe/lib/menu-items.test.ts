import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENU_STATUS_FILTERS,
  isMenuStatusFilter,
  isOutOfStock,
  isHiddenFromQr,
  filterItems,
  statusCounts,
  priceDisplayOf,
  itemSubLine,
} from "./menu-items";
import type { Product } from "@/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    _id: "64f0000000000000000000a1",
    name: "Latte",
    categoryId: "64f0000000000000000000c1",
    price: 100,
    discount: 0,
    available: true,
    image: "",
    modifiers: [],
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("isMenuStatusFilter: accepts only the four declared filters", () => {
  for (const f of MENU_STATUS_FILTERS) assert.ok(isMenuStatusFilter(f));
  assert.equal(isMenuStatusFilter("bogus"), false);
  assert.equal(isMenuStatusFilter(undefined), false);
});

test("isOutOfStock: active + available===false only (mirrors lib/dashboard/live.ts's UNAVAILABLE_PRODUCT)", () => {
  assert.equal(isOutOfStock(product({ available: false })), true);
  assert.equal(isOutOfStock(product({ available: true })), false);
  // archived + unavailable must NOT count as "out of stock" — that's a
  // separate status (Archived), not a stock state.
  assert.equal(isOutOfStock(product({ isActive: false, available: false })), false);
});

test("isHiddenFromQr: only an explicit publicVisible===false counts (absent/true = shown)", () => {
  assert.equal(isHiddenFromQr(product({ publicVisible: false })), true);
  assert.equal(isHiddenFromQr(product({ publicVisible: true })), false);
  assert.equal(isHiddenFromQr(product({ publicVisible: undefined })), false);
});

test("filterItems: search matches name case-insensitively, category matches categoryId (never a bare .category)", () => {
  const rows = [
    product({ _id: "a", name: "Cold Coffee", categoryId: "cat-1" }),
    product({ _id: "b", name: "Hot Tea", categoryId: "cat-2" }),
  ];
  assert.deepEqual(
    filterItems(rows, { search: "coffee", categoryId: null, status: "all" }).map((p) => p._id),
    ["a"],
  );
  assert.deepEqual(
    filterItems(rows, { search: "", categoryId: "cat-2", status: "all" }).map((p) => p._id),
    ["b"],
  );
});

test("filterItems: status out-of-stock / hidden narrow on top of search+category", () => {
  const rows = [
    product({ _id: "a", available: false }),
    product({ _id: "b", available: true, publicVisible: false }),
    product({ _id: "c" }),
  ];
  assert.deepEqual(
    filterItems(rows, { search: "", categoryId: null, status: "out-of-stock" }).map((p) => p._id),
    ["a"],
  );
  assert.deepEqual(
    filterItems(rows, { search: "", categoryId: null, status: "hidden" }).map((p) => p._id),
    ["b"],
  );
});

test("statusCounts: counts follow search+category, not the status filter itself", () => {
  const rows = [
    product({ _id: "a", name: "Cold Coffee", categoryId: "cat-1", available: false }),
    product({ _id: "b", name: "Cold Tea", categoryId: "cat-1", publicVisible: false }),
    product({ _id: "c", name: "Hot Tea", categoryId: "cat-2" }),
  ];
  const counts = statusCounts(rows, "cold", null);
  assert.equal(counts.all, 2, "scoped to the search term, both cold-* rows");
  assert.equal(counts.outOfStock, 1);
  assert.equal(counts.hidden, 1);
});

test("priceDisplayOf: plain item shows one effective price, raw struck through only when discount > 0", () => {
  const plain = priceDisplayOf(product({ price: 200, discount: 0 }));
  assert.equal(plain.min, 200);
  assert.equal(plain.max, 200);
  assert.equal(plain.hasRange, false);

  const discounted = priceDisplayOf(product({ price: 200, discount: 25 }));
  assert.equal(discounted.min, 150, "effectiveUnitPrice(200, 25) = 150");
  assert.equal(discounted.raw.min, 200);
  assert.equal(discounted.discount, 25);
});

test("priceDisplayOf: R11 — a variations item shows the min/max of EACH size's effective price, not the raw range", () => {
  const withSizes = priceDisplayOf(
    product({
      price: 100,
      discount: 50,
      variations: [
        { name: "Small", price: 100 },
        { name: "Large", price: 200 },
      ],
    }),
  );
  assert.equal(withSizes.hasRange, true);
  // effectiveUnitPrice(100,50)=50, effectiveUnitPrice(200,50)=100
  assert.equal(withSizes.min, 50);
  assert.equal(withSizes.max, 100);
  assert.equal(withSizes.raw.min, 100);
  assert.equal(withSizes.raw.max, 200);
});

test("itemSubLine: lists size count and modifier count, omitting whichever doesn't apply", () => {
  assert.equal(itemSubLine(product()), "");
  assert.equal(
    itemSubLine(product({ variations: [{ name: "S", price: 1 }, { name: "L", price: 2 }] })),
    "2 sizes",
  );
  assert.equal(itemSubLine(product({ modifiers: ["Extra shot"] })), "1 modifier");
  assert.equal(
    itemSubLine(
      product({
        variations: [{ name: "S", price: 1 }],
        modifiers: ["Extra shot", "Oat milk"],
      }),
    ),
    "1 size · 2 modifiers",
  );
});
