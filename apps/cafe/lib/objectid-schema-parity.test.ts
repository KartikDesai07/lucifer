import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { objectIdString } from "@pos/shared/schemas/object-id.schema";
import { stripComments } from "@/lib/source-pin-utils";

// CB-DL-2 T2: parity pin against @pos/shared's SOURCE (readFileSync, per
// testing.md's cross-app-contract rule) for the objectIdString rollout —
// order.schema.ts's productId/customerId and product.schema.ts's categoryId
// all switched onto the shared hex-pattern validator, and this pin makes any
// future drift (one call site quietly reverting to a bare z.string()) fail
// the suite instead of silently accepting a malformed id.
//
// Same REPO_ROOT/readSrc idiom as every other apps/cafe *-paths.test.ts file
// (e.g. lib/table-constants-pin.test.ts, lib/public-hardening-paths.test.ts).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const OBJECT_ID_SCHEMA = "packages/shared/src/schemas/object-id.schema.ts";
const ORDER_SCHEMA = "packages/shared/src/schemas/order.schema.ts";
const PRODUCT_SCHEMA = "packages/shared/src/schemas/product.schema.ts";

// ── object-id.schema.ts: the pattern + objectIdString definition ──────────

test("PIN: object-id.schema.ts declares the exact pattern literal /^[0-9a-f]{24}$/ and defines objectIdString from it", () => {
  const src = stripComments(readSrc(OBJECT_ID_SCHEMA));
  // Mutation this catches: loosening the pattern (e.g. allowing upper-case,
  // a different length, or a non-hex character) — every id this platform
  // hands out is server-serialised lower-case 24-hex (Mongo ObjectId.toString()).
  assert.match(
    src,
    /export const OBJECT_ID_HEX_PATTERN = \/\^\[0-9a-f\]\{24\}\$\/;/,
    "OBJECT_ID_HEX_PATTERN must be exactly /^[0-9a-f]{24}$/",
  );
  assert.match(
    src,
    /export const objectIdString = z\.string\(\)\.regex\(OBJECT_ID_HEX_PATTERN/,
    "objectIdString must be built from z.string().regex(OBJECT_ID_HEX_PATTERN, ...)",
  );
  assert.match(src, /export const isObjectIdString/, "landmark: object-id.schema.ts must still export isObjectIdString");
});

// ── order.schema.ts: objectIdString for productId AND both customerId sites ─

test("PIN: order.schema.ts uses objectIdString for orderItemSchema.productId, the order object's customerId, AND settleOrderSchema's customerId", () => {
  const src = stripComments(readSrc(ORDER_SCHEMA));

  assert.match(
    src,
    /import \{ objectIdString \} from ["'].\/object-id\.schema["'];/,
    "order.schema.ts must import objectIdString from ./object-id.schema",
  );

  // orderItemSchema.productId
  const itemSchemaMatch = src.match(/export const orderItemSchema = z\.object\(\{([\s\S]*?)\n\}\);/);
  assert.ok(itemSchemaMatch, "orderItemSchema must exist");
  assert.match(
    itemSchemaMatch![1],
    /productId:\s*objectIdString,/,
    "orderItemSchema.productId must be objectIdString — a raw z.string() would accept a malformed id the server later fails to cast",
  );

  // orderObject.customerId (the create-order shape)
  const orderObjectMatch = src.match(/const orderObject = z\.object\(\{([\s\S]*?)\n\}\);/);
  assert.ok(orderObjectMatch, "orderObject must exist");
  assert.match(
    orderObjectMatch![1],
    /customerId:\s*objectIdString\.optional\(\),/,
    "orderObject.customerId must be objectIdString.optional()",
  );

  // settleOrderSchema.customerId (the settle-time shape — a SEPARATE object literal)
  const settleMatch = src.match(/export const settleOrderSchema = z\s*\.object\(\{([\s\S]*?)\n\s*\}\)\s*\n\s*\.strict\(\);/);
  assert.ok(settleMatch, "settleOrderSchema must exist");
  assert.match(
    settleMatch![1],
    /customerId:\s*objectIdString\.optional\(\),/,
    "settleOrderSchema.customerId must ALSO be objectIdString.optional() — a settle-time customer attach is a separate object literal from orderObject and must not drift from it",
  );
});

// ── product.schema.ts: categoryId uses the hex pattern; no bare `category` ──

test("PIN: createProductSchema.categoryId uses OBJECT_ID_HEX_PATTERN (via objectIdString or a direct regex), has NO category: field, and importProductRowSchema re-adds category as a plain string", () => {
  const src = stripComments(readSrc(PRODUCT_SCHEMA));

  const createSchemaMatch = src.match(/export const createProductSchema = z\.object\(\{([\s\S]*?)\n\}\);/);
  assert.ok(createSchemaMatch, "createProductSchema must exist");
  const createBody = createSchemaMatch![1];

  // Positive landmark: categoryId is declared and validated against the
  // shared hex pattern (either the imported constant name or the objectIdString
  // helper — product.schema.ts's own comment documents choosing the former for
  // a custom required_error message).
  assert.match(createBody, /categoryId:/, "landmark: createProductSchema must declare categoryId");
  assert.ok(
    /OBJECT_ID_HEX_PATTERN/.test(createBody) || /objectIdString/.test(createBody),
    "createProductSchema.categoryId must validate against OBJECT_ID_HEX_PATTERN or objectIdString — a bare z.string() would accept a malformed id",
  );

  // Negative: createProductSchema must carry no `category:` field (it moved
  // to categoryId) — paired with the categoryId landmark just above so this
  // can never pass vacuously (e.g. via a gutted/renamed schema object).
  assert.ok(
    !/(?:^|[^A-Za-z0-9_"'])category:/.test(createBody),
    "createProductSchema must have NO `category:` field — Product only carries categoryId now",
  );

  assert.match(
    src,
    /import \{[^}]*OBJECT_ID_HEX_PATTERN[^}]*\} from ["'].\/object-id\.schema["'];/,
    "product.schema.ts must import OBJECT_ID_HEX_PATTERN from ./object-id.schema",
  );

  // importProductRowSchema: the CSV path re-adds `category` as a human-typed
  // NAME string (there is no id column in a CSV) — this is the one legitimate
  // reintroduction of the field, and it must omit categoryId to avoid the two
  // colliding.
  const importRowMatch = src.match(/export const importProductRowSchema = z\.preprocess\(([\s\S]*?)\n\);/);
  assert.ok(importRowMatch, "importProductRowSchema must exist");
  assert.match(
    importRowMatch![1],
    /\.omit\(\{ categoryId: true \}\)/,
    "importProductRowSchema must .omit({ categoryId: true }) off createProductSchema",
  );
  assert.match(
    importRowMatch![1],
    /\.extend\(\{ category: z\.string\(\)/,
    "importProductRowSchema must re-add category as a plain z.string() — the CSV has a name column, not an id column",
  );
});

// ── Behaviour: the imported objectIdString itself ──────────────────────────

test("objectIdString: accepts a well-formed 24-hex id, rejects a non-hex string, an upper-case spelling, and an empty string", () => {
  const valid = "64f000000000000000000001";
  assert.equal(objectIdString.safeParse(valid).success, true, "a real 24-hex lower-case id must parse");

  assert.equal(objectIdString.safeParse("p1").success, false, "a non-hex, non-24-length string must be rejected");

  // Every id this platform hands out is server-serialised lower-case hex
  // (Mongo ObjectId.toString()) — an otherwise well-formed but upper-case
  // spelling is not one this platform ever produces, so it must be rejected
  // rather than silently cast.
  assert.equal(
    objectIdString.safeParse(valid.toUpperCase()).success,
    false,
    "an UPPER-CASE 24-char hex spelling must be rejected — this platform never emits one",
  );

  assert.equal(objectIdString.safeParse("").success, false, "an empty string must be rejected");
});
