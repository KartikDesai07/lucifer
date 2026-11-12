import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 3: source pins for the stock-use routes and the ONE writer of Product.stockUse. Behaviour:
// stock-use-write.test.ts; DB truth: scripts/verify-inventory-stock-use-live.ts. Needles are built by concatenation
// so this file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTE = "app/api/products/[id]/stock-use/route.ts";
const OWN_ROUTE = "app/api/products/[id]/stock-use/own/route.ts";
const WRITER = "lib/inventory/stock-use-write.ts";
const PRODUCT_PUT = "app/api/products/[id]/route.ts";
const PRODUCT_IMPORT = "app/api/products/import/route.ts";

const raw = (rel: string) => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string) => stripComments(raw(rel));
const count = (src: string, needle: string) => src.split(needle).length - 1;

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

/** The index of the `}` that closes the `{` at `open` (comment-stripped source, no braces inside strings). */
function closeOf(src: string, open: number): number {
  assert.equal(src[open], "{", "closeOf starts at an opening brace");
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  assert.fail("unclosed block");
}

/** The body of `export async function NAME(...)`: from its opening brace to the matching close. */
function handler(src: string, name: string): string {
  const head = at(src, "export async function " + name + "(", `the ${name} handler`);
  const open = at(src, ") {", `the ${name} signature end`, head) + 2;
  return src.slice(open, closeOf(src, open) + 1);
}

const ADMIN = "requireAdmin" + "(";
const CACHE_DEL = "cache.del(PRODUCT_LIST" + ".cacheKey);";

test("PIN routes: requireAdmin( is the first call in GET, PUT and POST", () => {
  const get = handler(read(ROUTE), "GET");
  const put = handler(read(ROUTE), "PUT");
  const post = handler(read(OWN_ROUTE), "POST");
  for (const [label, body] of [["GET", get], ["PUT", put], ["POST", post]] as const) {
    assert.ok(body.includes("await " + ADMIN + ")"), `${label} checks admin`);
    assert.ok(body.indexOf(ADMIN) < body.indexOf("await params"), `${label}: admin before anything else`);
    assert.equal(count(body, ADMIN), 1);
  }
  assert.ok(get.includes("get" + "StockUse(id)"), "landmark: GET is the read handler");
});

test("PIN routes: each writer validates with its own schema before the lib call", () => {
  const put = handler(read(ROUTE), "PUT");
  const post = handler(read(OWN_ROUTE), "POST");
  const putCall = at(put, "set" + "StockUse(id, parsed.data)", "the replace call");
  assert.ok(at(put, "validateBody(req, " + "stockUseSchema)", "PUT validation") < putCall);
  const postCall = at(post, "track" + "OwnStock(id, parsed.data.unit)", "the one-tap call");
  assert.ok(at(post, "validateBody(req, " + "ownStockSchema)", "POST validation") < postCall);
  assert.equal(handler(read(ROUTE), "GET").includes("validateBody("), false, "GET has no body");
});

test("PIN routes: the products cache is dropped after the lib call and only on the ok branch", () => {
  for (const [file, name, call] of [
    [ROUTE, "PUT", "set" + "StockUse(id, parsed.data)"],
    [OWN_ROUTE, "POST", "track" + "OwnStock(id, parsed.data.unit)"],
  ] as const) {
    const body = handler(read(file), name);
    const lib = at(body, call, `${name}: the lib call`);
    const refuse = at(body, "if (!result.ok) return failure(", `${name}: the refusal`, lib);
    const del = at(body, CACHE_DEL, `${name}: the cache drop`);
    assert.ok(lib < refuse && refuse < del, `${name}: after the lib call, after the early return on !ok`);
    assert.equal(count(body, CACHE_DEL), 1);
    assert.ok(del < at(body, "return success(result.dto)", `${name}: the answer`), `${name}: before the answer`);
  }
  assert.equal(handler(read(ROUTE), "GET").includes("cache.del("), false, "GET never drops the cache");
});

test("PIN own CAS: the claim only matches a product with no stock use yet", () => {
  const src = read(WRITER);
  const claim = at(src, "const claim = { _id: productId, stockUse: { $exists: false } };", "the claim filter");
  const update = at(src, "deps.updateProduct(claim, set)", "the claim write", claim);
  assert.ok(claim < update);
  assert.equal(count(src, "stockUse: { $exists: false }"), 1, "the only $exists CAS on the field");
  assert.ok(src.includes("{ $setOnInsert: { name, unit }, $unset: { archived: \"\" } }"), "the upsert is $setOnInsert + $unset only");
  assert.equal(/\$set\s*:\s*\{[^}]*\b(qty|unit|name)\b/.test(src.slice(at(src, "const update = { $setOnInsert", "the upsert doc"), claim)), false, "the upsert never $sets a field");
});

/** Every non-test .ts/.tsx file under `dir` (relative to the cafe root). */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(CAFE_ROOT, rel))) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(CAFE_ROOT, child)).isDirectory()) walk(child);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(child);
    }
  };
  walk(dir);
  return out;
}

test("PIN write census: only the stock-use writer sets or unsets Product.stockUse", () => {
  const files = [...sources("app"), ...sources("lib")];
  assert.ok(files.includes(WRITER) && files.includes(ROUTE) && files.includes(PRODUCT_PUT), "landmark: the walk sees the writer and the routes");
  const writes = /\$(set|unset)\s*:\s*\{\s*stockUse\b/;
  assert.ok(writes.test(read(WRITER)), "landmark: the needle matches the real writer");
  assert.deepEqual(files.filter((f) => writes.test(read(f))), [WRITER]);
  // Any other operator shape that names the field as a write target.
  const dotted = /\bstockUse\s*:\s*(\[|\{\s*\$(push|pull|each))/;
  assert.deepEqual(files.filter((f) => dotted.test(read(f)) && f !== WRITER), []);
});

test("PIN product PUT and CSV import never mention stockUse", () => {
  const put = read(PRODUCT_PUT);
  const csv = read(PRODUCT_IMPORT);
  assert.ok(put.includes("variations"), "landmark: the product PUT handles sizes");
  assert.ok(csv.includes("Product"), "landmark: the import writes products");
  assert.equal(put.includes("stock" + "Use"), false);
  assert.equal(csv.includes("stock" + "Use"), false);
});
