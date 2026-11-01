// U5 Task 1 (design 6.1, 6.3; values 2 and 4.6): the Menu's header line and the title row's count, in the HTML's words.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENU_FILTER_LABELS,
  categoryCounts,
  menuHeaderCounts,
  menuHeaderLine,
  menuStripShows,
  menuTitleCount,
} from "./menu-view";
import { MENU_STATUS_FILTERS } from "./menu-items";
import type { Category, Product } from "@/types";

test("menuHeaderLine: '{n} items · {m} categories[ · {k} sold out]' (values 2), singular right, the sold-out part only when k > 0", () => {
  assert.equal(menuHeaderLine({ items: 105, categories: 11, soldOut: 2 }), "105 items · 11 categories · 2 sold out", "the seed's line");
  assert.equal(menuHeaderLine({ items: 105, categories: 11, soldOut: 0 }), "105 items · 11 categories", "no sold out: the part is left out");
  assert.equal(menuHeaderLine({ items: 1, categories: 1, soldOut: 0 }), "1 item · 1 category", "singular");
  assert.equal(menuHeaderLine({ items: 0, categories: 0, soldOut: 0 }), "0 items · 0 categories", "zero is plural");
});

test("menuTitleCount: '{n} item(s)' and ' · {filter label lower-cased}' when the filter is not All (values 4.6)", () => {
  assert.equal(menuTitleCount(71, "all"), "71 items", "all: just the count");
  assert.equal(menuTitleCount(1, "out-of-stock"), "1 item · sold out", "sold out, singular");
  assert.equal(menuTitleCount(2, "hidden"), "2 items · hidden on qr menu", "hidden");
  assert.equal(menuTitleCount(3, "in-stock"), "3 items · in stock", "in stock");
  assert.equal(menuTitleCount(0, "archived"), "0 items · archived", "archived, zero");
});

test("MENU_FILTER_LABELS: one label per status filter, the HTML's words", () => {
  assert.deepEqual(Object.keys(MENU_FILTER_LABELS).sort(), [...MENU_STATUS_FILTERS].sort(), "every filter has a label, no more");
  assert.deepEqual(
    MENU_FILTER_LABELS,
    { all: "All items", "in-stock": "In stock", "out-of-stock": "Sold out", hidden: "Hidden on QR menu", archived: "Archived" },
    "the filter select's words (values 4.4)",
  );
});

function product(over: Partial<Product> & { _id: string }): Product {
  return { name: over._id, categoryId: "c1", price: 10, discount: 0, available: true, isActive: true, ...over } as Product;
}

test("menuHeaderCounts: the active list's items and sold-out items; undefined while the list is unknown", () => {
  assert.equal(menuHeaderCounts(undefined), null, "unknown: no counts (the page says 'Loading items…')");
  const list = [product({ _id: "a" }), product({ _id: "b", available: false }), product({ _id: "c", available: false })];
  assert.deepEqual(menuHeaderCounts(list), { items: 3, soldOut: 2 }, "counted from the list");
  assert.deepEqual(menuHeaderCounts([]), { items: 0, soldOut: 0 }, "an empty menu is known");
});

test("categoryCounts: per category items and sold out, plus the totals, from the list on screen", () => {
  const cats = [{ _id: "c1" }, { _id: "c2" }, { _id: "c3" }] as Category[];
  const list = [
    product({ _id: "a", categoryId: "c1" }),
    product({ _id: "b", categoryId: "c1", available: false }),
    product({ _id: "c", categoryId: "c2" }),
  ];
  const r = categoryCounts(list, cats);
  assert.deepEqual(r.byId.get("c1"), { items: 2, soldOut: 1 }, "c1");
  assert.deepEqual(r.byId.get("c2"), { items: 1, soldOut: 0 }, "c2");
  assert.deepEqual(r.byId.get("c3"), { items: 0, soldOut: 0 }, "an empty category is 0, not missing");
  assert.equal(r.all, 3, "all");
  assert.equal(r.allSoldOut, 1, "all sold out");
});

test("menuStripShows: only a failed or paused read WITH data (no strip on a first-load error, none while healthy)", () => {
  assert.equal(menuStripShows({ hasData: true, isError: true, isPaused: false }), true, "failed with data");
  assert.equal(menuStripShows({ hasData: true, isError: false, isPaused: true }), true, "paused with data");
  assert.equal(menuStripShows({ hasData: false, isError: true, isPaused: false }), false, "no data: the error state, not the strip");
  assert.equal(menuStripShows({ hasData: true, isError: false, isPaused: false }), false, "healthy");
});
