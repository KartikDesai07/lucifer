import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productVariationSchema,
  createProductSchema,
  importProductRowSchema,
} from "./product.schema";
import { coerceProductRow } from "../product-import";
import {
  MAX_VARIATIONS,
  VARIATION_NAME_MAX_LEN,
  VARIATION_PRICE_MAX,
} from "../constants";

// SLICE F — the variation additions to product.schema.ts (Slice A landed the
// schema itself; this pins its Zod-level contract). NOT duplicated here:
//   - apps/cafe/lib/variations.test.ts: checkItemVariations' server-side
//     integrity logic (this file is the WIRE shape only — it never touches DB
//     rows or another product's variation set).
//   - apps/cafe/lib/variation-paths.test.ts: the CSV-import ROUTE never
//     sending `variations` in its update — the schema-level half of that
//     guarantee (coerceProductRow itself never producing the key) is pinned
//     below; the DB round-trip half is the live leg
//     (scripts/verify-variations-live.ts).

const BASE = { name: "Cold Coffee", categoryId: "64b7f0c2a1d2e3f4a5b6c7d8", price: 120 };

// ── productVariationSchema: name + price bounds ─────────────────────────────

test("productVariationSchema accepts a plain name/price pair and trims the name", () => {
  const r = productVariationSchema.safeParse({ name: "  Large  ", price: 149 });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.name, "Large");
});

test("productVariationSchema rejects an empty/whitespace-only name", () => {
  assert.equal(productVariationSchema.safeParse({ name: "", price: 99 }).success, false);
  assert.equal(productVariationSchema.safeParse({ name: "   ", price: 99 }).success, false);
});

test(`productVariationSchema rejects a name over ${VARIATION_NAME_MAX_LEN} characters`, () => {
  const tooLong = "x".repeat(VARIATION_NAME_MAX_LEN + 1);
  assert.equal(productVariationSchema.safeParse({ name: tooLong, price: 99 }).success, false);
  const atLimit = "x".repeat(VARIATION_NAME_MAX_LEN);
  assert.equal(productVariationSchema.safeParse({ name: atLimit, price: 99 }).success, true);
});

test("productVariationSchema rejects a negative price and a price over the ceiling", () => {
  assert.equal(productVariationSchema.safeParse({ name: "Large", price: -1 }).success, false);
  assert.equal(
    productVariationSchema.safeParse({ name: "Large", price: VARIATION_PRICE_MAX + 1 }).success,
    false,
  );
  assert.equal(
    productVariationSchema.safeParse({ name: "Large", price: VARIATION_PRICE_MAX }).success,
    true,
  );
});

test("productVariationSchema is strict — an unknown extra key (e.g. a stray `stock`) is rejected, not silently dropped", () => {
  const r = productVariationSchema.safeParse({ name: "Large", price: 149, stock: 10 });
  assert.equal(r.success, false);
});

// ── createProductSchema.variations: omit-empty, bounds, dedupe ─────────────

test("createProductSchema: omitting `variations` entirely parses to undefined, not [] — an item sold one way stores no key at all", () => {
  const r = createProductSchema.safeParse(BASE);
  assert.equal(r.success, true);
  assert.ok(
    r.success && !("variations" in r.data),
    "variations must be ABSENT from the parsed output when omitted, not present-as-undefined",
  );
});

test("createProductSchema: an explicit empty array is rejected (min 1) — 'Has variations' with zero rows is not a valid state", () => {
  const r = createProductSchema.safeParse({ ...BASE, variations: [] });
  assert.equal(r.success, false);
});

test(`createProductSchema: more than MAX_VARIATIONS (${MAX_VARIATIONS}) rows is rejected`, () => {
  const atMax = Array.from({ length: MAX_VARIATIONS }, (_, i) => ({
    name: `V${i}`,
    price: 100 + i,
  }));
  assert.equal(createProductSchema.safeParse({ ...BASE, variations: atMax }).success, true);

  const overMax = [...atMax, { name: "One too many", price: 999 }];
  assert.equal(createProductSchema.safeParse({ ...BASE, variations: overMax }).success, false);
});

test("createProductSchema: two variations with the same (trimmed) name are rejected — an unpickable duplicate would bill whichever the code found first", () => {
  const r = createProductSchema.safeParse({
    ...BASE,
    variations: [
      { name: "Large", price: 149 },
      { name: "Large", price: 199 },
    ],
  });
  assert.equal(r.success, false);
});

test("createProductSchema: variations with distinct names, one of them valid at the price ceiling, parses through with the base `price` untouched (the base price stays required and independent)", () => {
  const r = createProductSchema.safeParse({
    ...BASE,
    variations: [
      { name: "Small", price: 99 },
      { name: "Large", price: 149 },
    ],
  });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.price, 120, "the base price is untouched by variations being present");
  assert.equal(r.success && r.data.variations?.length, 2);
});

// ── CSV import never touches variations (schema-level half; the live leg
// pins the DB-write half — the update document never carries the key at all) ──

test("coerceProductRow never produces a `variations` key, even when the raw CSV row has a column that normalises to one — the import pipeline has no way to express variations, so it must not silently introduce or clear them", () => {
  const coerced = coerceProductRow({
    name: "Cold Coffee",
    category: "Beverages",
    price: "120",
    variations: "Small:99|Large:149", // a hypothetical stray column
  });
  assert.ok(
    !("variations" in coerced),
    "coerceProductRow's output must not carry a variations key under any input — IMPORT_COLUMNS in product-import.ts has no such column, so nothing maps to it",
  );
});

test("importProductRowSchema parses a raw CSV row with `variations` absent, matching a hand-authored product with no variations", () => {
  const r = importProductRowSchema.safeParse({ name: "Tea", category: "Beverages", price: "40" });
  assert.equal(r.success, true);
  assert.ok(
    r.success && !("variations" in r.data),
    "a CSV-derived product must parse with variations ABSENT, exactly like the omit-empty contract for a hand-authored one",
  );
});

// ── categoryId (createProductSchema): "Category is required" on BOTH a
// missing key and a non-hex value; importProductRowSchema keeps the NAME
// column instead (server resolves the name to an id) ────────────────────────

test("createProductSchema: a missing categoryId fails with path ['categoryId'] and message 'Category is required'", () => {
  const { categoryId: _drop, ...withoutCategoryId } = BASE;
  const r = createProductSchema.safeParse(withoutCategoryId);
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path[0] === "categoryId");
    assert.ok(issue, "expected an issue on categoryId");
    assert.equal(issue?.message, "Category is required");
  }
});

test("createProductSchema: an upper-case hex categoryId is rejected with message 'Category is required'", () => {
  const r = createProductSchema.safeParse({ ...BASE, categoryId: BASE.categoryId.toUpperCase() });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path[0] === "categoryId");
    assert.equal(issue?.message, "Category is required");
  }
});

test("createProductSchema: a 23-char categoryId is rejected with message 'Category is required'", () => {
  const r = createProductSchema.safeParse({ ...BASE, categoryId: BASE.categoryId.slice(0, 23) });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path[0] === "categoryId");
    assert.equal(issue?.message, "Category is required");
  }
});

test("createProductSchema: a valid 24-char lower-case hex categoryId parses through", () => {
  assert.equal(createProductSchema.safeParse(BASE).success, true);
});

test("importProductRowSchema still accepts a raw CSV row with a NAME category column, and the parsed output carries `category` (the name) and no `categoryId`", () => {
  const r = importProductRowSchema.safeParse({ name: "Tea", category: "Beverages", price: "40" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.category, "Beverages");
    assert.ok(!("categoryId" in r.data), "the CSV row schema must never produce a categoryId key — the route resolves the name server-side");
  }
});

test("importProductRowSchema rejects a row with no category with path ['category']", () => {
  const r = importProductRowSchema.safeParse({ name: "Tea", price: "40" });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues.some((i) => i.path[0] === "category"), true);
  }
});
