import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_PRODUCT_FILTER,
  toPublicMenuItem,
  toPublicCategory,
  toPublicTable,
  type PublicProductSource,
  type PublicCategorySource,
  type PublicTableSource,
} from "./public-menu";

// CR2.1 — the public QR-menu's shaping functions and the Mongo filter that
// decides what a diner may ever see. `toPublicMenuItem`/`toPublicTable` ARE
// the security boundary of this feature (see the THREAT MODEL comment in
// public-menu.ts): these tests assert the EXACT key set each one returns and
// that a source object carrying admin-only fields never leaks them through.
// DB-free by design — the live leg (verify-public-menu-live.ts) proves the
// filter against REAL Mongo docs; this file proves the shape of the filter
// object and the shaping functions in isolation.

// ── PUBLIC_PRODUCT_FILTER: the exact filter object ──────────────────────────

test("PUBLIC_PRODUCT_FILTER is exactly { isActive: true, publicVisible: { $ne: false } } — no extra keys, no different operator", () => {
  // Mutation this catches: swapping $ne:false for publicVisible:true (which
  // would ADMIT nothing for the overwhelming majority of pre-CR2 products
  // that carry no publicVisible key at all — this repo's most common shape),
  // or adding/dropping a key from the filter entirely.
  assert.deepEqual(PUBLIC_PRODUCT_FILTER, {
    isActive: true,
    publicVisible: { $ne: false },
  });
});

test("PUBLIC_PRODUCT_FILTER's publicVisible term, read as the $ne operator it declares, admits an ABSENT field and an explicit true, and excludes only an explicit false", () => {
  // This does not reimplement Mongo — it interprets ONLY the $ne operator
  // exactly as declared, against the filter object's OWN literal value. That
  // keeps the claim honest: it proves the FILTER'S SHAPE drives the three
  // outcomes below, not a separately-invented notion of what $ne means. Real
  // Mongo behavior on real documents is the live leg's job, not this one's.
  const term = PUBLIC_PRODUCT_FILTER.publicVisible as { $ne: boolean };
  const matchesNe = (actual: boolean | undefined) => actual !== term.$ne;

  // Mutation this catches: flipping the operand (publicVisible: { $ne: true })
  // — that would ADMIT an explicit false and EXCLUDE the absent/true cases,
  // inverting who gets hidden from the public menu.
  assert.equal(matchesNe(undefined), true, "an ABSENT publicVisible must be admitted");
  assert.equal(matchesNe(true), true, "an explicit true must be admitted");
  assert.equal(matchesNe(false), false, "an explicit false must be excluded");
});

// ── toPublicMenuItem: exact key set + the leak test ─────────────────────────

const BASE_PRODUCT: PublicProductSource = {
  _id: "64f000000000000000000001",
  name: "Filter Coffee",
  category: "Beverages",
  price: 40,
  discount: 10,
  available: true,
  image: "r2:products/coffee.jpg",
  modifiers: ["Extra sugar"],
};

const EXPECTED_ITEM_KEYS_NO_VARIATIONS = [
  "available",
  "category",
  "discount",
  "id",
  "image",
  "modifiers",
  "name",
  "price",
].sort();

const EXPECTED_ITEM_KEYS_WITH_VARIATIONS = [...EXPECTED_ITEM_KEYS_NO_VARIATIONS, "variations"].sort();

test("toPublicMenuItem: with variations present, the EXACT key set includes `variations` and nothing else", () => {
  const item = toPublicMenuItem({
    ...BASE_PRODUCT,
    variations: [{ name: "Small", price: 30 }, { name: "Large", price: 50 }],
  });
  // Mutation this catches: spreading the source product (or adding a field to
  // the built object literal) — either would ride an unreviewed field
  // straight onto a diner's phone. Object.keys().sort() catches an EXTRA key
  // that a plain "does it have these fields" check would miss.
  assert.deepEqual(Object.keys(item).sort(), EXPECTED_ITEM_KEYS_WITH_VARIATIONS);
  assert.deepEqual(item.variations, [{ name: "Small", price: 30 }, { name: "Large", price: 50 }]);
});

test("toPublicMenuItem: with no variations (absent, or an explicit empty array), the `variations` key is ABSENT — not present-as-empty", () => {
  const withoutKey = toPublicMenuItem(BASE_PRODUCT);
  assert.deepEqual(Object.keys(withoutKey).sort(), EXPECTED_ITEM_KEYS_NO_VARIATIONS);
  assert.equal(Object.hasOwn(withoutKey, "variations"), false, "an item with no variations field must carry no variations key");

  const withEmptyArray = toPublicMenuItem({ ...BASE_PRODUCT, variations: [] });
  // Mutation this catches: `if (product.variations)` alone (without the
  // `.length > 0` guard) — an explicit [] from a lean() read would then ride
  // onto the wire as a present-but-empty key, which the diner page would have
  // to special-case for no reason.
  assert.equal(Object.hasOwn(withEmptyArray, "variations"), false, "an EMPTY variations array must also produce no variations key");
});

test("toPublicMenuItem: a source object carrying admin-only fields (isActive, publicVisible, createdAt, __v, a hypothetical cost) leaks NONE of them — the security test of this slice", () => {
  const withExtras = {
    ...BASE_PRODUCT,
    isActive: true,
    publicVisible: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    __v: 3,
    cost: 15,
  } as PublicProductSource & Record<string, unknown>;

  const item = toPublicMenuItem(withExtras);
  const keys = Object.keys(item);
  // Mutation this catches: this is the whole THREAT MODEL comment in
  // public-menu.ts made executable — any widening of toPublicMenuItem to
  // spread its input (or to copy a "just this one extra field" shortcut)
  // publishes cost price / soft-delete state / hidden-status to the internet.
  for (const forbidden of ["isActive", "publicVisible", "createdAt", "updatedAt", "__v", "cost", "_id"]) {
    assert.ok(!keys.includes(forbidden), `toPublicMenuItem's output must never carry "${forbidden}"`);
  }
  assert.deepEqual(keys.sort(), EXPECTED_ITEM_KEYS_NO_VARIATIONS);
  assert.equal(item.id, String(BASE_PRODUCT._id), "the _id is still surfaced, but only as the stringified `id` field");
});

// ── toPublicCategory: exact key set ─────────────────────────────────────────

test("toPublicCategory: exact key set { name, order } — extras on the source are dropped", () => {
  const source = { name: "Beverages", order: 2, _id: "cat1", createdAt: new Date() } as PublicCategorySource &
    Record<string, unknown>;
  const category = toPublicCategory(source);
  // Mutation this catches: returning the source object as-is (a pass-through)
  // instead of an explicit projection — a field added to Category later would
  // then ride along with no review point.
  assert.deepEqual(Object.keys(category).sort(), ["name", "order"]);
  assert.deepEqual(category, { name: "Beverages", order: 2 });
});

// ── toPublicTable: exact key set + the leak test ────────────────────────────

test("toPublicTable: exact key set { tableNo } — a source carrying publicToken, status, currentOrderId, chargeAmount and _id leaks NONE of them", () => {
  const source = {
    tableNo: "T-4",
    publicToken: "0123456789ABCD",
    status: "Occupied",
    currentOrderId: "ORD-A-1",
    chargeAmount: 50,
    _id: "table-doc-id",
  } as PublicTableSource & Record<string, unknown>;

  const table = toPublicTable(source);
  // Mutation this catches: widening toPublicTable to spread its input — the
  // QR secret (publicToken) and occupancy state are exactly what
  // /api/public/tables must never hand every diner in the room at once.
  assert.deepEqual(Object.keys(table).sort(), ["tableNo"]);
  assert.deepEqual(table, { tableNo: "T-4" });
});
