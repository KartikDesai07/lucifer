import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../source-pin-utils";

// Inventory lite Slice 2: source pins for the stock-item routes and core (plan:
// docs/superpowers/plans/2026-11-10-inventory-lite.md, Slice 2). Behaviour: items.test.ts; DB truth:
// scripts/verify-inventory-items-live.ts. Needles are built by concatenation so this file can never match itself.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIST_ROUTE = "app/api/inventory/items/route.ts";
const ITEM_ROUTE = "app/api/inventory/items/[id]/route.ts";
const CORE = "lib/inventory/items.ts";

const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

const REQUIRE_ADMIN = "require" + "Admin(";
const REQUIRE_AUTH = "require" + "Auth(";
const CREATE_CALL = "StockItem" + ".create(";
const FIND_UPDATE_CALL = "StockItem" + ".findOneAndUpdate(";

/** The text of `export async function NAME(...) { ... }` (comment-stripped source). */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf("export async function " + name + "(");
  assert.ok(start !== -1, `expected handler ${name}`);
  const open = src.indexOf(") {", start) + 2;
  assert.equal(src[open], "{", `${name} body opens`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return assert.fail(`${name} body never closes`);
}

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(CAFE_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...codeFiles(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test("PIN GET: any signed-in user (requireAuth), not admin-only", () => {
  const body = handlerBody(read(LIST_ROUTE), "GET");
  assert.ok(body.includes("listStockItems("), "landmark: GET lists the items");
  assert.ok(body.includes(REQUIRE_AUTH), "GET calls requireAuth");
  assert.ok(!body.includes(REQUIRE_ADMIN), "GET must not be admin-only: staff see stock");
});

test("PIN POST and PATCH: admin-only", () => {
  const post = handlerBody(read(LIST_ROUTE), "POST");
  assert.ok(post.includes("createStockItem("), "landmark: POST creates");
  assert.ok(post.includes(REQUIRE_ADMIN), "POST calls requireAdmin");
  const patch = handlerBody(read(ITEM_ROUTE), "PATCH");
  assert.ok(patch.includes("updateStockItem("), "landmark: PATCH updates");
  assert.ok(patch.includes(REQUIRE_ADMIN), "PATCH calls requireAdmin");
});

test("PIN no DELETE handler on the item route (archive instead)", () => {
  const src = read(ITEM_ROUTE);
  assert.ok(src.includes("export async function PATCH("), "landmark: PATCH exists");
  assert.ok(!src.includes("export async function " + "DELETE("), "no DELETE: an item is archived, never removed");
});

test("PIN stockItemUpdate never writes qty or unit", () => {
  const src = read(CORE);
  const start = src.indexOf("export function stockItemUpdate(");
  assert.ok(start !== -1, "expected stockItemUpdate");
  const end = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, end === -1 ? undefined : end);
  assert.ok(body.includes("lowAt"), "landmark: the body writes lowAt");
  assert.ok(body.includes("archived"), "landmark: the body writes archived");
  assert.ok(!/qty/i.test(body), "stockItemUpdate must not mention qty");
  assert.ok(!/unit/i.test(body), "stockItemUpdate must not mention unit");
});

test("PIN the DTO sends lastRatePaise only when isAdmin", () => {
  const src = read(CORE);
  const start = src.indexOf("export function toStockItemDto(");
  assert.ok(start !== -1, "expected toStockItemDto");
  const end = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, end);
  assert.ok(body.includes("dto.lastRatePaise ="), "landmark: the DTO assigns lastRatePaise");
  assert.ok(
    body.includes("isAdmin && typeof row.lastRatePaise" + ' === "number") dto.lastRatePaise ='),
    "the assignment is gated on isAdmin",
  );
  assert.equal(body.split("dto.lastRatePaise =").length - 1, 1, "lastRatePaise is assigned in exactly one place");
});

// Slice 3 moved this pin on purpose: the one-tap "Track this item's own stock" upserts its own StockItem
// (findOneAndUpdate with $setOnInsert) in lib/inventory/stock-use-write.ts. A plain create stays items.ts only.
const OWN_STOCK_WRITER = "lib/inventory/stock-use-write.ts";

test("PIN StockItem create is only in items.ts; findOneAndUpdate only in items.ts and the own-stock upsert", () => {
  const core = read(CORE);
  assert.ok(core.includes(CREATE_CALL), "landmark: items.ts creates");
  assert.ok(core.includes(FIND_UPDATE_CALL), "landmark: items.ts updates");
  const own = read(OWN_STOCK_WRITER);
  assert.equal(own.split(FIND_UPDATE_CALL).length - 1, 1, "landmark: the own-stock upsert is one call");
  const files = [...codeFiles("app"), ...codeFiles("lib")];
  assert.ok(files.length > 50, "the scan sees the source tree");
  for (const rel of files) {
    if (rel === CORE) continue;
    const src = read(rel);
    assert.ok(!src.includes(CREATE_CALL), `${rel} must not create StockItems`);
    if (rel === OWN_STOCK_WRITER) continue;
    assert.ok(!src.includes(FIND_UPDATE_CALL), `${rel} must not findOneAndUpdate StockItems`);
  }
});

test("PIN updateStockItem writes only an ACTIVE item (one archived meanwhile is a 404, never a silent edit)", () => {
  // From the function to the next top-level export (handlerBody would stop at the first inner "if (...) {").
  const src = read(CORE);
  const start = src.indexOf("export async function " + "updateStockItem(");
  assert.ok(start !== -1, "landmark: updateStockItem");
  const next = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, next === -1 ? src.length : next);
  assert.ok(body.includes(FIND_UPDATE_CALL), "landmark: the one atomic write");
  assert.ok(body.includes(FIND_UPDATE_CALL + "{ _id: id, ..." + "ACTIVE }"), "its filter carries the ACTIVE term");
});
