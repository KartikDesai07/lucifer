// Task 8 (PIN lock): source pins for the staff PIN data and API. The behaviour is proved by
// scripts/verify-staff-pin-live.ts; these pins keep the shapes that carry the guarantees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const MODEL = "apps/cafe/models/Staff.ts";
const LIST = "apps/cafe/app/api/staff/route.ts";
const ITEM = "apps/cafe/app/api/staff/[id]/route.ts";
const PIN = "apps/cafe/app/api/staff/[id]/pin/route.ts";
const MASTERS = "apps/cafe/lib/masters.ts";

test("PIN: the Staff model keeps pin, pinFailDay and pinFailCount out of every default read", () => {
  const s = src(MODEL);
  assert.match(s, /pin:\s*\{[^}]*select:\s*false/, "pin is select:false");
  assert.match(s, /pinFailDay:\s*\{[^}]*select:\s*false/, "pinFailDay is select:false");
  assert.match(s, /pinFailCount:\s*\{[^}]*select:\s*false/, "pinFailCount is select:false");
  assert.match(s, /hasPin:\s*\{[^}]*default:\s*false/, "hasPin defaults to false");
  assert.match(s, /pinBlocked:\s*\{[^}]*default:\s*false/, "pinBlocked defaults to false");
});

test("PIN: POST and PUT write hasPin true when a pin is present, and PUT unblocks with a zeroed count", () => {
  const post = src(LIST);
  assert.match(post, /hasPin:\s*true/, "POST sets hasPin: true");
  const put = src(ITEM);
  assert.match(put, /hasPin:\s*true/, "PUT sets hasPin: true");
  assert.match(put, /pinFailCount:\s*0/, "PUT zeroes pinFailCount");
  assert.match(put, /\$set/, "PUT builds an explicit $set");
  assert.match(put, /auth:revalidated:/, "PUT clears the auth revalidation marker");
});

test("PIN: GET /api/staff/[id]/pin is admin-first, selects +pin and is no-store", () => {
  const s = src(PIN);
  const guard = s.indexOf("requireAdmin(");
  const read = s.indexOf("+pin");
  assert.ok(guard >= 0 && read >= 0, "the route has both requireAdmin( and +pin");
  assert.ok(guard < s.indexOf("connectDB("), "requireAdmin( comes before connectDB(");
  assert.ok(guard < read, "requireAdmin( comes before the +pin read");
  assert.match(s, /no-store/, "the response is no-store");
});

test("PIN: the staff list projection is unchanged (the schema-level select:false keeps the PIN out)", () => {
  assert.match(src(MASTERS), /select:\s*"-password"/, "STAFF_LIST still selects -password");
});
