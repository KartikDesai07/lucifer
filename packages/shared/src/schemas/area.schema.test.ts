import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  areaNameSchema,
  createAreaSchema,
  renameAreaSchema,
  reorderAreasSchema,
} from "./area.schema";
import {
  TABLE_AREAS_MAX,
  TABLE_AREA_NAME_MAX_LEN,
  TABLE_AREA_NAME_PATTERN,
  TABLE_CHARGE_LABEL_PATTERN,
} from "../constants";
import { TTL } from "../cache";

// Tables B2 — floor areas. The name is display text (like the charge label), the
// reorder body is the categories precedent (whole id list, index = position).

const ID1 = "64f000000000000000000001";
const ID2 = "64f000000000000000000002";

test("areaNameSchema accepts a cafe's own area names, in any language, and trims padding", () => {
  for (const name of ["Garden", "AC Hall", "Rooftop 2", "छत", "Café", "Bar & Grill"]) {
    assert.equal(areaNameSchema.safeParse(name).success, true, `${name} should be accepted`);
  }
  const r = areaNameSchema.safeParse("  Garden  ");
  assert.equal(r.success && r.data, "Garden");
});

test("areaNameSchema rejects empty, blank, over-long and control-character names", () => {
  for (const name of ["", "   ", "x".repeat(TABLE_AREA_NAME_MAX_LEN + 1), "Gar\nden", "Gar\tden"]) {
    assert.equal(
      areaNameSchema.safeParse(name).success,
      false,
      `${JSON.stringify(name)} must be rejected`,
    );
  }
  assert.equal(areaNameSchema.safeParse("x".repeat(TABLE_AREA_NAME_MAX_LEN)).success, true);
});

test("the name limits are the pinned contract: 24 characters, 50 areas", () => {
  assert.equal(TABLE_AREA_NAME_MAX_LEN, 24);
  assert.equal(TABLE_AREAS_MAX, 50);
  assert.equal(TTL.AREAS, 20);
});

test("TABLE_AREA_NAME_PATTERN is the charge-label rule itself (reused, not restated)", () => {
  assert.equal(TABLE_AREA_NAME_PATTERN, TABLE_CHARGE_LABEL_PATTERN);
  const src = readFileSync(new URL("../constants.ts", import.meta.url), "utf8");
  assert.ok(
    /export const TABLE_AREA_NAME_PATTERN = TABLE_CHARGE_LABEL_PATTERN;/.test(src),
    "the area pattern must alias the charge-label constant",
  );
});

test("createAreaSchema / renameAreaSchema take exactly {name} and are strict", () => {
  assert.equal(createAreaSchema.safeParse({ name: "Garden" }).success, true);
  assert.equal(createAreaSchema.safeParse({}).success, false);
  assert.equal(createAreaSchema.safeParse({ name: "Garden", displayOrder: 3 }).success, false);
  assert.equal(renameAreaSchema.safeParse({ name: "Patio" }).success, true);
  assert.equal(renameAreaSchema.safeParse({ name: "" }).success, false);
  assert.equal(renameAreaSchema.safeParse({ name: "Patio", extra: 1 }).success, false);
});

test("the empty-name copy is plain English", () => {
  const r = areaNameSchema.safeParse("");
  assert.equal(r.success, false);
  if (!r.success) assert.equal(r.error.issues[0].message, "Area name is required");
  const long = areaNameSchema.safeParse("x".repeat(TABLE_AREA_NAME_MAX_LEN + 1));
  if (!long.success) {
    assert.equal(long.error.issues[0].message, "Keep it to 24 characters or fewer");
  }
});

test("reorderAreasSchema accepts a plain {ids} payload", () => {
  assert.equal(reorderAreasSchema.safeParse({ ids: [ID1, ID2] }).success, true);
});

test("reorderAreasSchema rejects an empty ids array", () => {
  assert.equal(reorderAreasSchema.safeParse({ ids: [] }).success, false);
});

test(`reorderAreasSchema: exactly TABLE_AREAS_MAX (${TABLE_AREAS_MAX}) ids parses; one more is rejected`, () => {
  const atMax = Array.from({ length: TABLE_AREAS_MAX }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(reorderAreasSchema.safeParse({ ids: atMax }).success, true);
  assert.equal(reorderAreasSchema.safeParse({ ids: [...atMax, "f".repeat(24)] }).success, false);
});

test("reorderAreasSchema rejects a duplicate id, error path on 'ids'", () => {
  const r = reorderAreasSchema.safeParse({ ids: [ID1, ID1] });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path[0] === "ids"));
    assert.ok(r.error.issues.some((i) => i.message === "The same area appears twice"));
  }
});

test("reorderAreasSchema rejects a malformed id and an extra key", () => {
  assert.equal(reorderAreasSchema.safeParse({ ids: ["not-an-id"] }).success, false);
  assert.equal(reorderAreasSchema.safeParse({ ids: [ID1], extra: true }).success, false);
});
