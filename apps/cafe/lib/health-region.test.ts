// /api/health tells which Vercel region the function runs in, so one read-only GET proves where the live app
// is served from (Virginia vs Mumbai). The failover Worker reads only ok / db, so the extra field is safe, but the
// 503 answer must stay exactly as the Worker knows it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { functionRegion } from "@/lib/health-region";
import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

test("functionRegion returns the trimmed VERCEL_REGION", () => {
  assert.equal(functionRegion({ VERCEL_REGION: "bom1" }), "bom1", "a set region comes back as is");
  assert.equal(functionRegion({ VERCEL_REGION: " iad1 " }), "iad1", "surrounding spaces are trimmed");
});

test("functionRegion is null when unset or blank", () => {
  assert.equal(functionRegion({}), null, "unset gives null");
  assert.equal(functionRegion({ VERCEL_REGION: "  " }), null, "blank gives null");
  assert.equal(functionRegion({ VERCEL_REGION: "" }), null, "empty gives null");
});

test("route.ts: the plain answer carries the region, the 503 answer is unchanged", () => {
  const src = read("app/api/health/route.ts");
  assert.ok(
    src.includes("const base = { ok: true, db: \"up\", tenant, ts, region: functionRegion(process.env) };"),
    "base (plain and stats answers) carries region: functionRegion(process.env)",
  );
  assert.ok(
    src.includes("{ ok: false, db: \"down\", tenant, ts },"),
    "the 503 answer stays exactly { ok: false, db: \"down\", tenant, ts }",
  );
  assert.equal(src.split("region").length - 1, 2, "region appears only twice in code: the import path and the base key (no stray copy in another answer)");
});
