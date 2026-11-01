// U5 Task 1 (design 6.1, 6.3; values 2 and 4.6): the Menu's header line and the title row's count, in the HTML's words.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MENU_FILTER_LABELS,
  categoryCounts,
  menuHeaderCounts,
  menuHeaderLine,
  menuItemBadges,
  menuPriceText,
  menuSizesText,
  menuStripShows,
  bulkToastText,
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

// ── U5 Task 2: the list's price, sizes, badges and bulk toasts (values 5.2, 6, 7.1, 8; design 6.4-6.7, 12) ──────────────
const item = (over: Partial<Product>): Product =>
  ({ _id: "p1", name: "Crispy Corn", categoryId: "c1", price: 229, discount: 0, available: true, image: "", modifiers: [], isActive: true, ...over }) as Product;
const sized = (...v: [string, number][]): Pick<Product, "variations"> => ({ variations: v.map(([name, price]) => ({ name, price })) });

test("menuPriceText: one price '₹229'; sizes '₹lo–hi' (an en dash, one ₹); equal sizes collapse; Indian grouping (values 5.2)", () => {
  assert.deepEqual(menuPriceText(item({})), { text: "₹229" }, "one price, no struck line");
  assert.equal(menuPriceText(item(sized(["Small", 249], ["Large", 449]))).text, "₹249–449", "a range");
  assert.equal(menuPriceText(item(sized(["Small", 100], ["Large", 100]))).text, "₹100", "equal sizes collapse to one price");
  assert.equal(menuPriceText(item(sized(["Small", 49], ["Large", 100000]))).text, "₹49–1,00,000", "Indian digit grouping");
});

test("menuPriceText: a discount gives the effective price and the struck undiscounted text (today's rule R11)", () => {
  const p = menuPriceText(item({ price: 200, discount: 10 }));
  assert.equal(p.text, "₹180", "the effective price");
  assert.equal(p.struck, "₹200", "the struck original");
  const r = menuPriceText(item({ ...sized(["Small", 100], ["Large", 200]), discount: 10 }));
  assert.equal(r.text, "₹90–180", "the effective range");
  assert.equal(r.struck, "₹100–200", "the struck range");
});

test("menuSizesText: 'Single price', the size names joined by ' · ', one non-Standard size's name, then ' · {m} modifiers' (values 5.2, design 12)", () => {
  assert.equal(menuSizesText(item({})), "Single price", "no variations");
  assert.equal(menuSizesText(item(sized(["Standard", 120]))), "Single price", "one size named Standard");
  assert.equal(menuSizesText(item(sized(["Large", 120]))), "Large", "one other size: its name");
  assert.equal(menuSizesText(item(sized(["Small", 1], ["Large", 2]))), "Small · Large", "two sizes");
  assert.equal(menuSizesText(item(sized(["Regular", 1], ["Medium", 2], ["Large", 3]))), "Regular · Medium · Large", "three sizes");
  assert.equal(menuSizesText(item({ ...sized(["Small", 1], ["Large", 2]), modifiers: ["a", "b", "c", "d"] })), "Small · Large · 4 modifiers", "modifiers");
  assert.equal(menuSizesText(item({ modifiers: ["a"] })), "Single price · 1 modifier", "one modifier, singular");
});

test("menuItemBadges: Sold out, Hidden on QR, Archived, No KOT, in that order, only the ones that apply (values 7.1, design 6.6)", () => {
  assert.deepEqual(menuItemBadges(item({}), { archived: false }), [], "a plain item has none");
  assert.deepEqual(menuItemBadges(item({ available: false }), { archived: false }), ["sold-out"], "sold out");
  assert.deepEqual(menuItemBadges(item({ publicVisible: false }), { archived: false }), ["hidden"], "hidden on QR");
  assert.deepEqual(menuItemBadges(item({}), { archived: true }), ["archived"], "archived view");
  assert.deepEqual(
    menuItemBadges(item({ available: false, publicVisible: false }), { archived: false, skipsKitchen: true }),
    ["sold-out", "hidden", "no-kot"],
    "the order",
  );
  assert.deepEqual(menuItemBadges(item({ publicVisible: false }), { archived: true, skipsKitchen: true }), ["hidden", "archived", "no-kot"], "archived sits before No KOT");
});

test("bulkToastText: the HTML's words with today's matched counts, singular right (design 6.7, 12)", () => {
  const r = (action: string, matched: number) => ({ action, requested: matched, matched, modified: matched });
  assert.equal(bulkToastText(r("out-of-stock", 1)), "1 item marked sold out", "one, singular (the HTML's '1 items' slip is not copied)");
  assert.equal(bulkToastText(r("out-of-stock", 2)), "2 items marked sold out", "two");
  assert.equal(bulkToastText(r("in-stock", 3)), "3 items back in stock", "back in stock");
  assert.equal(bulkToastText(r("in-stock", 1)), "1 item back in stock", "back in stock, singular");
  assert.equal(bulkToastText(r("move", 2)), "2 items moved", "moved");
  assert.equal(bulkToastText(r("archive", 1)), "1 item archived", "archived");
  assert.equal(bulkToastText(r("restore", 4)), "4 items restored", "restored");
  assert.equal(bulkToastText(r("other", 4)), "Updated 4 items", "an unknown action keeps today's fallback");
});
