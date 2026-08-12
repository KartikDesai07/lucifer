import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_COLUMNS,
  MODIFIER_SEPARATOR,
  MAX_IMPORT_ROWS,
  normalizeHeader,
  normalizeRow,
  coerceProductRow,
  displayName,
  buildTemplateCsv,
} from "./product-import";
import {
  createProductSchema,
  importProductRowSchema,
  importProductsSchema,
} from "./schemas/product.schema";

// CR1.6 — the bulk CSV menu importer had ZERO coverage before this file, and a
// brand-new client loads their entire day-1 menu through it. These pin the
// template contract, header-alias tolerance, row coercion (the money-critical
// half), and the bridge into `createProductSchema` — the module's own stated
// single source of truth for validity.

// ── Template / contract ──────────────────────────────────────────────────────

test("the template's header row is exactly what the operator must fill in", () => {
  const csv = buildTemplateCsv();
  const firstLine = csv.split("\r\n")[0];
  assert.equal(firstLine, IMPORT_COLUMNS.join(","));
});

test("the template uses CRLF line endings, two example rows, and an unquoted pipe-separated modifiers example", () => {
  const csv = buildTemplateCsv();
  // No lone LF outside a CRLF pair.
  assert.equal(/(?<!\r)\n/.test(csv), false, "every newline must be part of \\r\\n");
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3, "header + exactly two example rows");
  const modifiersCell = "Extra Cheese|Thin Crust";
  assert.equal(modifiersCell.split(MODIFIER_SEPARATOR).length, 2, "demonstrates two modifiers");
  assert.equal(csv.includes(modifiersCell), true, "unquoted — a pipe is not a CSV special char");
  assert.equal(csv.includes(`"${modifiersCell}"`), false, "must NOT be quoted");
});

test("a price/modifiers re-import can never put a sold-out dish back on the menu — there is no available column", () => {
  assert.equal((IMPORT_COLUMNS as readonly string[]).includes("available"), false);
});

test("importProductsSchema enforces the row cap and the min(1) floor BEHAVIOURALLY — MAX_IMPORT_ROWS rows parse, one more fails, and an empty rows array fails too", () => {
  const makeRows = (n: number) => Array.from({ length: n }, () => ({}));

  assert.equal(
    importProductsSchema.safeParse({ rows: makeRows(MAX_IMPORT_ROWS) }).success,
    true,
    `exactly ${MAX_IMPORT_ROWS} rows must be accepted`,
  );
  assert.equal(
    importProductsSchema.safeParse({ rows: makeRows(MAX_IMPORT_ROWS + 1) }).success,
    false,
    `${MAX_IMPORT_ROWS + 1} rows must be rejected — the cap must actually be ENFORCED by the schema the route calls, not just documented as a constant`,
  );
  assert.equal(
    importProductsSchema.safeParse({ rows: [] }).success,
    false,
    "an empty rows array must be rejected by min(1) — a request with nothing to import is not a valid import (this branch of the schema had no coverage before)",
  );
});

// ── Header tolerance (normalizeHeader) ───────────────────────────────────────

test("common header spellings all map to their canonical column", () => {
  const cases: [string, string][] = [
    ["product", "name"],
    ["item", "name"],
    ["item name", "name"],
    ["cat", "category"],
    ["group", "category"],
    ["rate", "price"],
    ["mrp", "price"],
    ["amount", "price"],
    ["disc", "discount"],
    ["img", "image"],
    ["photo", "image"],
    ["public id", "image"],
    ["image ref", "image"],
    ["image key", "image"],
    ["modifier", "modifiers"],
    ["addons", "modifiers"],
    ["add ons", "modifiers"],
    ["options", "modifiers"],
    ["active", "isActive"],
    ["enabled", "isActive"],
    ["status", "isActive"],
    ["is active", "isActive"],
  ];
  for (const [header, canonical] of cases) {
    assert.equal(normalizeHeader(header), canonical, `"${header}" should map to "${canonical}"`);
  }
});

test("header case and punctuation collapse before alias lookup", () => {
  assert.equal(normalizeHeader("Price (₹)"), "price");
  assert.equal(normalizeHeader("is_active"), "isActive");
  assert.equal(normalizeHeader("  ITEM NAME "), "name");
  assert.equal(normalizeHeader("discount %"), "discount");
});

test("an unrecognised header is left alone, not silently mapped to a canonical column", () => {
  const result = normalizeHeader("SKU");
  assert.equal(result, "sku");
  assert.equal((IMPORT_COLUMNS as readonly string[]).includes(result), false);
});

test("when two headers collapse to the same key, the later column wins", () => {
  const row = normalizeRow({ name: "A", item: "B" });
  assert.equal(row.name, "B");
});

// ── Value coercion (coerceProductRow) — the money-critical half ─────────────

test("coerceProductRow returns exactly the 7 canonical keys, nothing else", () => {
  const row = coerceProductRow({ name: "Chai", extra: "ignored" });
  assert.deepEqual(
    Object.keys(row).sort(),
    ["category", "discount", "image", "isActive", "modifiers", "name", "price"].sort(),
  );
});

test("a blank price becomes undefined (so the schema's rule applies), never a silent 0 — but an explicit 0 stays 0", () => {
  assert.equal(coerceProductRow({ price: "" }).price, undefined);
  assert.equal(coerceProductRow({ price: "   " }).price, undefined);
  assert.equal(coerceProductRow({ price: "0" }).price, 0);
});

test("a non-numeric price passes through as text, so the schema reports a type error instead of pricing the dish at 0", () => {
  assert.equal(coerceProductRow({ price: "abc" }).price, "abc");
});

test("a price cell with surrounding whitespace still coerces to a number", () => {
  assert.equal(coerceProductRow({ price: "  350 " }).price, 350);
});

test("isActive recognises common true/false words, case- and space-insensitively, and never defaults an unrecognised word to active", () => {
  for (const word of ["true", "yes", "y", "1", "active", "enabled", "TRUE", " Yes "]) {
    assert.equal(coerceProductRow({ isActive: word }).isActive, true, `"${word}" should be true`);
  }
  for (const word of ["false", "no", "n", "0", "inactive", "disabled", "FALSE", " No "]) {
    assert.equal(coerceProductRow({ isActive: word }).isActive, false, `"${word}" should be false`);
  }
  assert.equal(coerceProductRow({ isActive: "" }).isActive, undefined);
  assert.equal(coerceProductRow({ isActive: "maybe" }).isActive, "maybe");
});

test("modifiers split on the pipe, trim each part, drop empty parts, and blank/array cells behave sensibly", () => {
  assert.deepEqual(coerceProductRow({ modifiers: "A|B" }).modifiers, ["A", "B"]);
  assert.deepEqual(coerceProductRow({ modifiers: " A | B " }).modifiers, ["A", "B"]);
  assert.deepEqual(coerceProductRow({ modifiers: "A||B" }).modifiers, ["A", "B"]);
  assert.equal(coerceProductRow({ modifiers: " | " }).modifiers, undefined);
  assert.deepEqual(coerceProductRow({ modifiers: ["A", "B"] }).modifiers, ["A", "B"]);
  assert.equal(coerceProductRow({ modifiers: "" }).modifiers, undefined);
});

test("name, category, and image are trimmed, and a blank cell becomes undefined so the schema's Required check fires", () => {
  assert.equal(coerceProductRow({ name: "  Chai  " }).name, "Chai");
  assert.equal(coerceProductRow({ name: "" }).name, undefined);
  assert.equal(coerceProductRow({ category: "   " }).category, undefined);
  assert.equal(coerceProductRow({ image: "  r2:abc  " }).image, "r2:abc");
  assert.equal(coerceProductRow({ image: "" }).image, undefined);
});

test("displayName trims the name cell for the preview, or is empty when no usable name was provided", () => {
  assert.equal(displayName({ name: "  Chai  " }), "Chai");
  assert.equal(displayName({}), "");
  assert.equal(displayName({ name: 42 }), "");
});

// ── Bridge to the schema (the module's stated single source of truth) ───────
//
// The route (app/api/products/import/route.ts:34) calls `importProductRowSchema
// .safeParse(raw)` on the RAW parsed CSV row — never createProductSchema
// directly. importProductRowSchema is `z.preprocess(coerceProductRow,
// createProductSchema)`, so calling it on a raw row exercises coercion +
// validation in exactly the shape the route does. The first case below keeps
// ONE two-step `createProductSchema.safeParse(coerceProductRow(...))` alongside
// the one-step call, to prove the wrapper is genuinely equivalent to doing both
// steps by hand — that equivalence is itself a real regression to catch if
// importProductRowSchema's preprocess ever stops calling coerceProductRow.

test("a realistic full CSV row: importProductRowSchema (the route's REAL validator) parses a RAW row the same way the two-step coerce+validate does", () => {
  const raw = {
    name: "Chai",
    category: "Beverages",
    price: "20",
    discount: "0",
    image: "",
    modifiers: "Milk|Sugar",
    isActive: "true",
  };
  const twoStep = createProductSchema.safeParse(coerceProductRow(raw));
  const bridged = importProductRowSchema.safeParse(raw);
  assert.equal(twoStep.success, true);
  assert.equal(bridged.success, true);
  if (twoStep.success && bridged.success) {
    assert.deepEqual(bridged.data, twoStep.data);
    assert.deepEqual(bridged.data, {
      name: "Chai",
      category: "Beverages",
      price: 20,
      discount: 0,
      available: true,
      image: "",
      modifiers: ["Milk", "Sugar"],
      isActive: true,
    });
  }
});

test("a raw row missing category fails importProductRowSchema with a category error", () => {
  const parsed = importProductRowSchema.safeParse({ name: "Chai", price: "20" });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.issues.some((i) => i.path[0] === "category"), true);
  }
});

test("a raw row whose price is text fails importProductRowSchema's numeric type check rather than parsing as 0", () => {
  const parsed = importProductRowSchema.safeParse({
    name: "Chai",
    category: "Beverages",
    price: "abc",
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const priceIssue = parsed.error.issues.find((i) => i.path[0] === "price");
    assert.equal(priceIssue?.code, "invalid_type");
  }
});

// NOTE ON COVERAGE: the task brief for this bridge also asked to pin that "a row
// with only name+category parses and receives the schema defaults (price 0,
// isActive true)". That is NOT true of the current schema — `price` carries no
// `.default()` (unlike discount/available/image/modifiers/isActive), so a row
// with no price cell fails with a "Required" error instead of defaulting to a
// free item. Pinning the claimed behavior would have been a false assertion, so
// this test instead pins what the code actually does: price has no default, and
// the *other* fields do.
test("a raw row with only name+category+price is rejected on price's absence, not silently defaulted — but the other fields DO default (through importProductRowSchema)", () => {
  const missingPrice = importProductRowSchema.safeParse({ name: "Chai", category: "Beverages" });
  assert.equal(missingPrice.success, false);
  if (!missingPrice.success) {
    const priceIssue = missingPrice.error.issues.find((i) => i.path[0] === "price");
    assert.equal(priceIssue?.message, "Required");
  }

  const withPrice = importProductRowSchema.safeParse({
    name: "Chai",
    category: "Beverages",
    price: "20",
  });
  assert.equal(withPrice.success, true);
  if (withPrice.success) {
    assert.equal(withPrice.data.discount, 0);
    assert.equal(withPrice.data.available, true);
    assert.equal(withPrice.data.image, "");
    assert.deepEqual(withPrice.data.modifiers, []);
    assert.equal(withPrice.data.isActive, true);
  }
});
