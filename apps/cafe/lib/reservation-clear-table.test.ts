// U6 Task 4 (owner Q6, B28): clearing a booking's table. The item route lists tableNo in nullClearsFields, so a PUT with
// `tableNo: null` builds `$unset: { tableNo: "" }`; an absent or a string table is a plain $set; crud-route is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { updateReservationSchema } from "@pos/shared/schemas";

import { buildUpdate } from "./crud-route";
import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const route = stripComments(readFileSync(path.join(CAFE_ROOT, "app/api/reservations/[id]/route.ts"), "utf8"));

test("the item route clears tableNo on null", () => {
  assert.match(route, /nullClearsFields:\s*\[\s*"tableNo"\s*\]/, "nullClearsFields: [tableNo]");
  assert.match(route, /updateSchema:\s*updateReservationSchema/, "the route validates with the update schema");
});

test("a PUT with tableNo: null builds $unset (and nothing else touches the other fields)", () => {
  const body = updateReservationSchema.parse({ name: "Asha", tableNo: null });
  assert.deepEqual(buildUpdate(body, ["tableNo"]), { $set: { name: "Asha" }, $unset: { tableNo: "" } }, "null becomes $unset");
  assert.deepEqual(buildUpdate(updateReservationSchema.parse({ tableNo: null }), ["tableNo"]), { $unset: { tableNo: "" } }, "alone: a lone $unset");
});

test("a table name or an absent table is a plain $set / untouched", () => {
  assert.deepEqual(buildUpdate(updateReservationSchema.parse({ tableNo: "T-3" }), ["tableNo"]), { $set: { tableNo: "T-3" } }, "a name sets");
  assert.deepEqual(buildUpdate(updateReservationSchema.parse({ status: "Seated" }), ["tableNo"]), { $set: { status: "Seated" } }, "absent: kept");
});
