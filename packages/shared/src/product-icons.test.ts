import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_ICONS,
  PRODUCT_ICON_KEYS,
  PRODUCT_ICON_GROUPS,
  isProductIconKey,
  productIconSchema,
} from "./product-icons";

// Menu redesign (owner, 2026-09-30) — item icons. This file pins the
// catalogue's shape: a reasonable size, no duplicates, every key carries real
// metadata, and the two "no icon" guards (unknown key, prototype key) both
// hold. Pure data — no DB, no React.

test("PRODUCT_ICON_KEYS has between 60 and 100 keys", () => {
  assert.ok(
    PRODUCT_ICON_KEYS.length >= 60 && PRODUCT_ICON_KEYS.length <= 100,
    `expected 60-100 keys, found ${PRODUCT_ICON_KEYS.length}`,
  );
});

test("PRODUCT_ICON_KEYS has no duplicates", () => {
  assert.equal(new Set(PRODUCT_ICON_KEYS).size, PRODUCT_ICON_KEYS.length);
});

test("PRODUCT_ICON_KEYS matches Object.keys(PRODUCT_ICONS) exactly", () => {
  assert.deepEqual([...PRODUCT_ICON_KEYS].sort(), Object.keys(PRODUCT_ICONS).sort());
});

test("every key has a meta entry with a non-empty label and a valid group", () => {
  for (const key of PRODUCT_ICON_KEYS) {
    const meta = PRODUCT_ICONS[key];
    assert.ok(meta, `missing meta for key "${key}"`);
    assert.ok(typeof meta.label === "string" && meta.label.length > 0, `key "${key}" must have a non-empty label`);
    assert.ok(
      (PRODUCT_ICON_GROUPS as readonly string[]).includes(meta.group),
      `key "${key}"'s group "${meta.group}" must be one of PRODUCT_ICON_GROUPS`,
    );
    assert.ok(Array.isArray(meta.keywords), `key "${key}" must have a keywords array`);
  }
});

// ── isProductIconKey: the "no icon" guards ──────────────────────────────────

test("isProductIconKey accepts every real catalogue key", () => {
  for (const key of PRODUCT_ICON_KEYS) {
    assert.equal(isProductIconKey(key), true, `expected "${key}" to be accepted`);
  }
});

test("isProductIconKey rejects an unknown string", () => {
  assert.equal(isProductIconKey("not-a-real-icon"), false);
  assert.equal(isProductIconKey(""), false);
});

// Object.hasOwn, not `in` — this repo has a live history of prototype-key
// bypasses (buildUpdate, ADMIN allow-lists). "constructor"/"toString" sit on
// every object's prototype and must never read as a stored icon.
test("isProductIconKey rejects prototype keys ('constructor', 'toString')", () => {
  assert.equal(isProductIconKey("constructor"), false);
  assert.equal(isProductIconKey("toString"), false);
});

test("isProductIconKey rejects non-string values", () => {
  assert.equal(isProductIconKey(undefined), false);
  assert.equal(isProductIconKey(null), false);
  assert.equal(isProductIconKey(42), false);
  assert.equal(isProductIconKey({}), false);
});

// ── productIconSchema: Zod-level parity with isProductIconKey ───────────────

test("productIconSchema accepts every real catalogue key", () => {
  for (const key of PRODUCT_ICON_KEYS) {
    assert.equal(productIconSchema.safeParse(key).success, true, `expected "${key}" to parse`);
  }
});

test("productIconSchema rejects an unknown key with the friendly message", () => {
  const r = productIconSchema.safeParse("not-a-real-icon");
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues[0]?.message, "Pick an icon from the list");
  }
});

test("productIconSchema rejects a prototype key the same way as any other unknown value", () => {
  assert.equal(productIconSchema.safeParse("constructor").success, false);
});
