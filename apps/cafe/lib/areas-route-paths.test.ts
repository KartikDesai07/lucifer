import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// Tables B2 (Areas) Slice A - source pins for the server seams: the areas
// routes (GET/POST/PATCH and PUT/DELETE by id) and the two table writes that
// name an area. Behaviour is proven against a real mongod by
// scripts/verify-areas-live.ts; these pins keep the ORDER of the guards (the
// live leg cannot see a memoized no-op like Area.init()) and the pinned
// literals from being reordered or dropped. Every chain asserts each needle
// EXISTS before comparing positions.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const AREAS_ROUTE = "app/api/areas/route.ts";
const AREA_ID_ROUTE = "app/api/areas/[id]/route.ts";
const TABLES_ROUTE = "app/api/tables/route.ts";
const TABLE_ROUTE = "app/api/tables/[tableNo]/route.ts";
const TABLE_ADMIN = "lib/table-admin.ts";
const AREA_ADMIN = "lib/area-admin.ts";
const MASTERS = "lib/masters.ts";
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string) => src.split(needle).length - 1;

function handlerBodies(src: string): Map<string, string> {
  const marks = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)];
  const bodies = new Map<string, string>();
  marks.forEach((m, i) => bodies.set(m[1], src.slice(m.index, marks[i + 1]?.index ?? src.length)));
  return bodies;
}

function handler(rel: string, verb: string): string {
  const body = handlerBodies(read(rel)).get(verb);
  assert.ok(body, `${rel} must export ${verb}`);
  return body;
}

/** Every needle present exactly where expected: each strictly after the one before it. */
function assertChain(src: string, chain: ReadonlyArray<string>, why: string): void {
  let prev = -1;
  let prevNeedle = "(start)";
  for (const needle of chain) {
    const at = src.indexOf(needle, prev + 1);
    assert.ok(at !== -1, `expected ${JSON.stringify(needle)} after ${JSON.stringify(prevNeedle)} - ${why}`);
    prev = at;
    prevNeedle = needle;
  }
}

test("PIN: GET /api/areas serves success(await listAreas()) - auth, THEN the ?fresh=1 flush, THEN the shared list - and never queries the model itself", () => {
  const get = handler(AREAS_ROUTE, "GET");
  // Vision guard: the body is the real GET, not an empty slice.
  assert.ok(get.includes("export async function GET(req: Request)"), "landmark: GET takes the request");
  assertChain(
    get,
    ["requireAuth()", "AREAS_FRESH_PARAM", "cache.del(CACHE_KEY)", "return success(await listAreas())"],
    "an anonymous caller must never flush the cache, and the list comes from AREA_LIST",
  );
  for (const needle of ["requireAuth()", "return success(await listAreas())", "cache.del(CACHE_KEY)"]) {
    assert.equal(count(get, needle), 1, `GET must contain ${JSON.stringify(needle)} exactly once`);
  }
  assert.ok(!get.includes(".find("), "GET must not re-spell the query - AREA_LIST is the one description of it");
  assert.ok(!get.includes("requireAdmin()"), "staff may read the areas (the floor and New Order group by them)");
});

test("PIN: AREA_LIST is cached under \"areas\" and the routes invalidate exactly that key", () => {
  const masters = read(MASTERS);
  const start = masters.indexOf("export const AREA_LIST");
  assert.ok(start >= 0, "landmark: lib/masters.ts declares AREA_LIST");
  assert.match(masters.slice(start, start + 400), /cacheKey: "areas"/);
  for (const rel of [AREAS_ROUTE, AREA_ID_ROUTE]) {
    const src = read(rel);
    assert.ok(src.includes("const CACHE_KEY = AREA_LIST.cacheKey;"), `${rel}: CACHE_KEY is read off the spec`);
  }
});

test("PIN: POST /api/areas - admin, validate, connect, Area.init(), THEN the cap count, THEN the append position, THEN create, THEN the cache flush", () => {
  const post = handler(AREAS_ROUTE, "POST");
  assertChain(
    post,
    [
      "await requireAdmin();",
      "validateBody(req, createAreaSchema)",
      "await connectDB();",
      "await Area.init();",
      "await Area.countDocuments()",
      "TABLE_AREAS_MAX) return failure(AREA_LIMIT_ERROR, 400)",
      "displayOrder: { $exists: true }",
      "Area.create({ ...parsed.data, displayOrder })",
      "cache.del(CACHE_KEY)",
      "return created(area)",
    ],
    "init() guarantees the unique collation index before the cap check and the insert",
  );
  const dup = post.indexOf("isDuplicateKeyError(error)");
  assert.ok(dup > post.indexOf("cache.del(CACHE_KEY)"), "landmark: the duplicate catch follows the write");
  assert.match(post.slice(dup), /^isDuplicateKeyError\(error\)\) return failure\(AREA_DUPLICATE_ERROR, 400\);/);
  assert.equal(count(post, "Area.init()"), 1, "POST awaits Area.init() exactly once");
});

test("PIN: PATCH /api/areas - admin, validate, the exact-set check BEFORE the bulkWrite, the 409 copy, then flush and the fresh list", () => {
  const patch = handler(AREAS_ROUTE, "PATCH");
  assertChain(
    patch,
    [
      "await requireAdmin();",
      "validateBody(req, reorderAreasSchema)",
      "await connectDB();",
      "await Area.find().select(\"_id\").lean()",
      "sameIdSet(parsed.data.ids",
      "failure(AREA_LIST_CHANGED_ERROR, 409)",
      "await Area.bulkWrite(areaReorderOps(parsed.data.ids))",
      "cache.del(CACHE_KEY)",
      "return success(await listAreas())",
    ],
    "a stale list is refused whole before anything is written",
  );
});

test("PIN: PUT /api/areas/[id] - admin, id shape, validate, connect, Area.init() (the second writer of name), ONE findOneAndUpdate, null -> 404, flush; duplicate -> 400", () => {
  const put = handler(AREA_ID_ROUTE, "PUT");
  assertChain(
    put,
    [
      "await requireAdmin();",
      "mongoose.isValidObjectId(id)) return notFound(AREA_NOT_FOUND_ERROR)",
      "validateBody(req, renameAreaSchema)",
      "await connectDB();",
      "await Area.init();",
      "await Area.findOneAndUpdate({ _id: id }, { $set: parsed.data }, { new: true, runValidators: true })",
      "if (!updated) return notFound(AREA_NOT_FOUND_ERROR)",
      "cache.del(CACHE_KEY)",
      "return success(updated.toObject())",
    ],
    "the unique collation index must exist before a rename can race an insert; a rename that loses to a delete is a 404",
  );
  // One atomic write: no read-then-save (a rename racing a delete would 500 on save).
  assert.equal(count(put, "Area.findOneAndUpdate("), 1, "landmark: exactly one update write");
  for (const banned of ["Area.findById(", ".save(", "existing"]) assert.equal(count(put, banned), 0, `PUT must not use ${banned}`);
  assert.match(put, /if \(isDuplicateKeyError\(error\)\) return failure\(AREA_DUPLICATE_ERROR, 400\);/);
});

test("PIN: DELETE /api/areas/[id] - findById -> 404 BEFORE the table count -> 409 BEFORE deleteOne; then flush and {deleted:true}", () => {
  const del = handler(AREA_ID_ROUTE, "DELETE");
  assertChain(
    del,
    [
      "await requireAdmin();",
      "mongoose.isValidObjectId(id)) return notFound(AREA_NOT_FOUND_ERROR)",
      "await connectDB();",
      "await Area.findById(id)",
      "if (!area) return notFound(AREA_NOT_FOUND_ERROR)",
      "await Table.countDocuments({ areaId: id })",
      "if (count > 0) return failure(areaInUseMessage(count), 409)",
      "await area.deleteOne()",
      "cache.del(CACHE_KEY)",
      "return success({ deleted: true })",
    ],
    "an unknown id is a 404, not a 409 or a silent success; a used area is never deleted",
  );
  assert.equal(count(del, "Table.countDocuments("), 1, "exactly one in-use count");
});

test("PIN: every areas write is admin-only, flushes the areas cache, and echoes no input in an error", () => {
  const cases: Array<[string, string]> = [
    [AREAS_ROUTE, "POST"],
    [AREAS_ROUTE, "PATCH"],
    [AREA_ID_ROUTE, "PUT"],
    [AREA_ID_ROUTE, "DELETE"],
  ];
  for (const [rel, verb] of cases) {
    const body = handler(rel, verb);
    assert.ok(body.includes("await requireAdmin();"), `${rel} ${verb}: requireAdmin`);
    assert.ok(!body.includes("requireAuth()"), `${rel} ${verb}: not the staff guard`);
    assert.equal(count(body, "cache.del(CACHE_KEY)"), 1, `${rel} ${verb}: one areas cache flush`);
    assert.ok(!/serverError\([^)]*(?:parsed|req|id)\b/.test(body), `${rel} ${verb}: a 500 never quotes the input`);
  }
  // Nothing in the areas routes publishes a realtime nudge or logs.
  const consoleCall = "console" + ".";
  for (const rel of [AREAS_ROUTE, AREA_ID_ROUTE]) {
    const src = read(rel);
    assert.ok(!src.includes(consoleCall), `${rel}: no console output`);
    assert.ok(!/publishCafeEvent|broadcastCafeEvent/.test(src), `${rel}: areas are config - no realtime publish`);
  }
});

test("PIN: POST /api/tables - checkAreaExists BEFORE the position and the create; the pinned Table.create literal is unchanged", () => {
  const post = handler(TABLES_ROUTE, "POST");
  assertChain(
    post,
    [
      "await connectDB();",
      "await checkAreaExists(parsed.data.areaId)",
      "return failure(invalid, 400)",
      "await nextTableDisplayOrder()",
      "mintUniquePublicToken(",
      "Table.create({ ...parsed.data, displayOrder, publicToken })",
      "cache.del(CACHE_KEY)",
    ],
    "an unknown area creates nothing; a new table lands at the end",
  );
  assert.ok(post.includes("if (parsed.data.areaId !== undefined)"), "the check runs only when an area was posted");
});

test("PIN: PATCH /api/tables/[tableNo] - checkAreaExists for a string areaId, an area change takes the next displayOrder, the write goes through buildUpdate (null -> $unset), the rename busy-guard is unchanged", () => {
  const patch = handler(TABLE_ROUTE, "PATCH");
  assertChain(
    patch,
    [
      "await connectDB();",
      'typeof parsed.data.areaId === "string"',
      "await checkAreaExists(parsed.data.areaId)",
      "return failure(invalid, 400)",
      "parsed.data.areaId !== undefined",
      "{ ...parsed.data, displayOrder: await nextTableDisplayOrder() }",
      "const filter = renaming ? { tableNo, ...FREE_TABLE_FILTER } : { tableNo };",
      "Table.findOneAndUpdate(",
      "buildUpdate<ITable>(fields, TABLE_NULL_CLEARS_FIELDS)",
      "{ new: true, runValidators: true }",
      "cache.del(CACHE_KEY)",
    ],
    "validate the area first, then write with the busy-guard in the filter",
  );
  assert.ok(!patch.includes("$set: parsed.data"), "a plain $set of the body would STORE the null instead of unsetting it");
  assert.match(patch, /return stillThere\s*\?\s*failure\(TABLE_BUSY_ERROR, 400\)/, "the busy 400 copy is unchanged");
});

test("PIN: table-admin owns TABLE_NULL_CLEARS_FIELDS (areaId) and nextTableDisplayOrder (max + 1 over the arranged tables)", () => {
  const src = read(TABLE_ADMIN);
  assert.ok(src.includes('export const TABLE_NULL_CLEARS_FIELDS = ["areaId"] as const;'));
  const start = src.indexOf("export async function nextTableDisplayOrder(): Promise<number> {");
  assert.ok(start >= 0, "landmark: nextTableDisplayOrder");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes("displayOrder: { $exists: true }") && body.includes(".sort({ displayOrder: -1 })"));
  assert.ok(body.includes("(last?.displayOrder ?? -1) + 1"), "one past the LAST arranged table");
});

test("PIN: area-admin copy and existence check", () => {
  const src = read(AREA_ADMIN);
  assert.ok(src.includes('export const AREA_DUPLICATE_ERROR = "An area with that name already exists";'));
  assert.ok(src.includes('export const AREA_INVALID_ERROR = "Select a valid area.";'));
  assert.ok(src.includes("`You can have up to ${TABLE_AREAS_MAX} areas.`"));
  assert.ok(src.includes("Area.exists({ _id: areaId })"));
});
