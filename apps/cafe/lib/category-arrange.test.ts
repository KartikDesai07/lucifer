import { test } from "node:test";
import assert from "node:assert/strict";

import {
  moveId,
  nextCategoryOrder,
  itemCountsByCategory,
  pickedUpAnnouncement,
  movedAnnouncement,
  droppedAnnouncement,
  cancelledAnnouncement,
} from "./category-arrange";
import type { Category, Product } from "@/types";

// ── moveId ───────────────────────────────────────────────────────────────

test("moveId: swaps a middle id with its next neighbour", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
});

test("moveId: swaps a middle id with its previous neighbour", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
});

test("moveId: moving the first id up is a no-op (returns an equal, new array)", () => {
  const ids = ["a", "b", "c"];
  const next = moveId(ids, "a", -1);
  assert.deepEqual(next, ids);
  assert.notEqual(next, ids, "must return a new array, not the same reference");
});

test("moveId: moving the last id down is a no-op", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveId(ids, "c", 1), ids);
});

test("moveId: an id not in the list is a no-op", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveId(ids, "z", 1), ids);
});

// ── nextCategoryOrder ────────────────────────────────────────────────────

function category(order: number, id = `id-${order}`): Category {
  return { _id: id, name: `Cat ${order}`, order, createdAt: "", updatedAt: "" };
}

test("nextCategoryOrder: max + 1, not list.length -- stable after a delete leaves a gap", () => {
  // A 3-category list where the middle one (order 1) was deleted: length is 2
  // but the max order is 2, so the old `list.length` rule (2) would collide
  // with the existing order-2 category.
  const list = [category(0), category(2)];
  assert.equal(nextCategoryOrder(list), 3);
  assert.notEqual(nextCategoryOrder(list), list.length);
});

test("nextCategoryOrder: an empty list starts at 0", () => {
  assert.equal(nextCategoryOrder([]), 0);
});

test("nextCategoryOrder: a single category returns its order + 1", () => {
  assert.equal(nextCategoryOrder([category(5)]), 6);
});

// ── itemCountsByCategory ─────────────────────────────────────────────────

function product(categoryId: string, id: string): Product {
  return {
    _id: id,
    name: id,
    categoryId,
    price: 100,
    discount: 0,
    available: true,
    image: "",
    modifiers: [],
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
}

test("itemCountsByCategory: counts active and archived items separately per category", () => {
  const active = [product("c1", "p1"), product("c1", "p2"), product("c2", "p3")];
  const archived = [product("c1", "p4")];
  const counts = itemCountsByCategory(active, archived);
  assert.deepEqual(counts.get("c1"), { active: 2, archived: 1 });
  assert.deepEqual(counts.get("c2"), { active: 1, archived: 0 });
  assert.equal(counts.get("c3"), undefined, "a category with no products at all has no entry");
});

test("itemCountsByCategory: an archived-only category still counts toward the all-items rule (matches the server 409)", () => {
  const counts = itemCountsByCategory([], [product("c1", "p1")]);
  const c1 = counts.get("c1")!;
  assert.equal(c1.active + c1.archived, 1, "archived items must count, same as the server delete guard");
});

test("itemCountsByCategory: empty inputs give an empty map", () => {
  assert.equal(itemCountsByCategory([], []).size, 0);
});

// ── announcement strings ─────────────────────────────────────────────────

test("announcements: plain-English text naming the item and its 1-based position", () => {
  assert.equal(pickedUpAnnouncement("Waffles", 2, 6), "Picked up Waffles. Position 2 of 6.");
  assert.equal(movedAnnouncement("Waffles", 4, 6), "Waffles moved to position 4 of 6.");
  assert.equal(droppedAnnouncement("Waffles", 4, 6), "Waffles dropped at position 4 of 6.");
  assert.equal(cancelledAnnouncement("Waffles"), "Moving Waffles was cancelled.");
});
