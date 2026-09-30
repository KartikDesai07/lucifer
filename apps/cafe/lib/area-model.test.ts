// Tables B2 Step 0 - the Area model, the Table.areaId field and the reorder
// helper. DB-free: index DEFINITIONS are read off the compiled schemas (the
// collation proof against a real mongod is scripts/verify-areas-live.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Area, AREA_NAME_COLLATION, areaSchema } from "@/models/Area";
import { tableSchema } from "@/models/Table";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";
import { AREAS_FRESH_PARAM, AREA_LIST_CHANGED_ERROR, areaReorderOps } from "@/lib/area-order";
import { sameIdSet } from "@/lib/category-order";
import { stripComments } from "@/lib/source-pin-utils";
import { TABLE_AREA_NAME_MAX_LEN } from "@/lib/constants";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readStripped = (rel: string): string =>
  stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const optionsOf = (schema: typeof areaSchema, pathName: string): Record<string, unknown> =>
  (schema.path(pathName) as unknown as { options: Record<string, unknown> }).options;

test("Area: the name index is unique WITH the case-insensitive collation, and there is no second name index", () => {
  const indexes = areaSchema.indexes();
  const nameIndexes = indexes.filter(([keys]) => Object.keys(keys).join() === "name");
  assert.equal(nameIndexes.length, 1, "exactly one index on {name} - a field-level unique would add a case-sensitive twin");
  const [keys, options] = nameIndexes[0];
  assert.deepEqual(keys, { name: 1 });
  assert.equal(options?.unique, true);
  assert.deepEqual(options?.collation, { locale: "en", strength: 2 });
  assert.deepEqual(AREA_NAME_COLLATION, { locale: "en", strength: 2 });
});

test("Area: the arranged-order index is {displayOrder, name} and nothing else is indexed", () => {
  const indexes = areaSchema.indexes();
  assert.equal(indexes.length, 2, `expected exactly 2 indexes, got ${JSON.stringify(indexes)}`);
  const arranged = indexes.find(([keys]) => Object.keys(keys).join() === "displayOrder,name");
  assert.ok(arranged, "the {displayOrder:1,name:1} index must exist");
  assert.deepEqual(arranged[0], { displayOrder: 1, name: 1 });
  assert.equal(arranged[1]?.unique, undefined, "the arrangement index must not be unique");
});

test("Area: no field-level unique on name (the collation index above is the only uniqueness)", () => {
  assert.equal(optionsOf(areaSchema, "name").unique, undefined);
  assert.equal(optionsOf(areaSchema, "name").index, undefined);
});

test("Area: name is required, trimmed and capped at TABLE_AREA_NAME_MAX_LEN; displayOrder has NO default and min 0", () => {
  const name = optionsOf(areaSchema, "name");
  assert.equal(name.required, true);
  assert.equal(name.trim, true);
  assert.equal(name.maxlength, TABLE_AREA_NAME_MAX_LEN);
  const order = optionsOf(areaSchema, "displayOrder");
  assert.equal(order.default, undefined, "an area with no displayOrder must stay without one (omit-empty)");
  assert.equal(order.min, 0);

  const minimal = new Area({ name: "Garden" });
  assert.equal(minimal.validateSync(), undefined);
  assert.equal(minimal.displayOrder, undefined);
  assert.notEqual(new Area({}).validateSync(), undefined, "a nameless area is invalid");
  assert.notEqual(new Area({ name: "x".repeat(TABLE_AREA_NAME_MAX_LEN + 1) }).validateSync(), undefined);
  assert.notEqual(new Area({ name: "Garden", displayOrder: -1 }).validateSync(), undefined);
});

test("Area: timestamps are on and the TTL guard has nothing to object to", () => {
  assert.equal(areaSchema.get("timestamps"), true);
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Area", areaSchema));
  for (const [, options] of areaSchema.indexes()) {
    assert.equal((options as Record<string, unknown>).expireAfterSeconds, undefined);
  }
});

test("Area is NOT federated: the cluster registry neither lists nor imports it (the DuePayment precedent)", () => {
  const registry = readStripped("apps/cafe/lib/cluster-registry.ts");
  assert.ok(registry.includes('"Category"'), "positive landmark: the registry still lists the federated models");
  assert.ok(!registry.includes('"Area"'), "FEDERATED_MODELS must not list Area");
  assert.ok(!registry.includes("models/Area"), "the registry must not import the Area schema");
});

test("Table.areaId: an ObjectId ref to Area with NO default and NO index", () => {
  const areaId = tableSchema.path("areaId") as unknown as { instance: string; options: Record<string, unknown> };
  assert.ok(areaId, "the areaId path must exist");
  assert.equal(areaId.instance, "ObjectId");
  assert.equal(areaId.options.ref, "Area");
  assert.equal(areaId.options.default, undefined, "an unassigned table carries no key");
  assert.equal(areaId.options.index, undefined);
  for (const [keys] of tableSchema.indexes()) {
    assert.ok(!Object.hasOwn(keys, "areaId"), "no index on areaId (the only lookup is the small in-use count)");
  }
  // Positive landmark for the loop above: the other indexes really were walked.
  assert.ok(tableSchema.indexes().some(([keys]) => Object.hasOwn(keys, "tableNo")));
});

test("areaReorderOps: one $set per area, position = index; empty in, empty out", () => {
  assert.deepEqual(areaReorderOps(["b", "a", "c"]), [
    { updateOne: { filter: { _id: "b" }, update: { $set: { displayOrder: 0 } } } },
    { updateOne: { filter: { _id: "a" }, update: { $set: { displayOrder: 1 } } } },
    { updateOne: { filter: { _id: "c" }, update: { $set: { displayOrder: 2 } } } },
  ]);
  assert.deepEqual(areaReorderOps([]), []);
});

test("area-order constants and the reused set comparison", () => {
  assert.equal(AREAS_FRESH_PARAM, "fresh");
  assert.equal(
    AREA_LIST_CHANGED_ERROR,
    "The area list changed on another screen. It has been refreshed — arrange again.",
  );
  assert.equal(sameIdSet(["a", "b"], ["b", "a"]), true);
  assert.equal(sameIdSet(["a"], ["a", "b"]), false);
});

test("lib/area-order.ts stays client-safe: no model, no db, no mongoose", () => {
  const src = readStripped("apps/cafe/lib/area-order.ts");
  assert.ok(src.includes("export function areaReorderOps"), "positive landmark: the helper is in this file");
  assert.ok(!/from\s+["']mongoose["']/.test(src));
  assert.ok(!/from\s+["']@\/(models|lib\/db)/.test(src));
});
