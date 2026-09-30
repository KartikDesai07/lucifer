import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Tables redesign B1 Slice A - source pins for the two server seams the Setup
// and Floor screens lean on: GET /api/tables?fresh=1 (auth BEFORE the cache
// flush) and PATCH /api/tables (exact-set check BEFORE the bulkWrite), plus the
// R6 pin that the live leg's order-claim filter still mirrors the real route's.
// Their behaviour is proven against a real mongod by
// scripts/verify-tables-floor-live.ts; these pins only keep the shapes from
// being reordered or dropped. Needles are built by concatenation so this file
// never contains one as a single literal.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const TABLES_ROUTE = "apps/cafe/app/api/tables/route.ts";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";
const FLOOR_LEG = "apps/cafe/scripts/verify-tables-floor-live.ts";

const AUTH_CALL = "requireAuth" + "(";
const FRESH_PARAM = "TABLES_FRESH" + "_PARAM";
const LIST_RETURN = "return success(" + "await listTables())";
const CACHE_FLUSH = "cache.del(" + "CACHE_KEY)";
const SAME_SET = "sameTableSet" + "(";
const BULK_WRITE = "await Table." + "bulkWrite(";
const LIST_CHANGED_409 = "failure(TABLE_LIST_CHANGED" + "_ERROR, 409)";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

function routeBodies(): { get: string; patch: string } {
  const src = stripComments(readSrc(TABLES_ROUTE));
  const getStart = src.indexOf("export async function GET");
  const postStart = src.indexOf("export async function POST");
  const patchStart = src.indexOf("export async function PATCH");
  assert.ok(getStart >= 0 && postStart > getStart && patchStart > postStart, "GET, POST, PATCH must exist in order");
  return { get: src.slice(getStart, postStart), patch: src.slice(patchStart) };
}

// The status literal the order-claim filter demands, read out of the source.
function claimStatusOfRoute(ordersSrc: string): string | null {
  const start = ordersSrc.indexOf("const occupyTable");
  if (start < 0) return null;
  const open = ordersSrc.indexOf("=> {", start) + 3;
  const body = ordersSrc.slice(open, matchingBraceEnd(ordersSrc, open) + 1);
  const m = body.match(/Table\.findOneAndUpdate\(\s*\{ tableNo: data\.tableNo, status: "(\w+)" \}/);
  return m ? m[1] : null;
}
function claimStatusOfLeg(legSrc: string): { shape: string | null; keyedByTableNo: boolean } {
  const shape = legSrc.match(/const ORDER_CLAIM_FILTER_SHAPE = \{ status: "(\w+)" \} as const;/);
  const fn = legSrc.indexOf("function orderClaimFilter(tableNo: string)");
  const body = fn < 0 ? "" : legSrc.slice(legSrc.indexOf("{", fn), matchingBraceEnd(legSrc, legSrc.indexOf("{", fn)) + 1);
  return { shape: shape ? shape[1] : null, keyedByTableNo: /\{ tableNo, \.\.\.ORDER_CLAIM_FILTER_SHAPE \}/.test(body) };
}

test("PIN: GET /api/tables runs requireAuth, THEN the ?fresh=1 cache flush, THEN the unchanged listTables() return - an anonymous caller can never flush the cache", () => {
  const { get } = routeBodies();
  // Vision guard: the body is the real GET, not an empty slice.
  assert.ok(get.includes("export async function GET(req: Request)"), "landmark: GET takes the request");

  for (const needle of [AUTH_CALL, FRESH_PARAM, LIST_RETURN, CACHE_FLUSH]) {
    assert.equal(count(get, needle), 1, `GET must contain "${needle}" exactly once`);
  }
  const authIdx = get.indexOf(AUTH_CALL);
  const freshIdx = get.indexOf(FRESH_PARAM);
  const returnIdx = get.indexOf(LIST_RETURN);
  assert.ok(authIdx < freshIdx, "requireAuth must come BEFORE the fresh check");
  assert.ok(freshIdx < returnIdx, "the fresh check must come BEFORE the listTables() return");

  // The flush is the body of the fresh branch (a braceless or braced if), never
  // a statement that runs on every read.
  const branch = new RegExp(
    'if \\(new URL\\(req\\.url\\)\\.searchParams\\.get\\(' + FRESH_PARAM + '\\) === "1"\\)\\s*\\{?\\s*cache\\.del\\(CACHE_KEY\\);',
  );
  assert.match(get, branch, "cache.del(CACHE_KEY) must be the fresh branch's body");
});

test("PIN: PATCH /api/tables refuses a list that is not the current set (409, TABLE_LIST_CHANGED_ERROR) BEFORE it bulk-writes anything", () => {
  const { patch } = routeBodies();
  assert.ok(patch.includes("reorderOps("), "landmark: PATCH still builds its ops with reorderOps");

  for (const needle of [SAME_SET, BULK_WRITE, LIST_CHANGED_409]) {
    assert.equal(count(patch, needle), 1, `PATCH must contain "${needle}" exactly once`);
  }
  const checkIdx = patch.indexOf(SAME_SET);
  const refuseIdx = patch.indexOf(LIST_CHANGED_409);
  const writeIdx = patch.indexOf(BULK_WRITE);
  assert.ok(checkIdx < refuseIdx, "the exact-set check must come before its 409");
  assert.ok(refuseIdx < writeIdx, "the 409 must come before the bulkWrite");

  // The old unknown-name 400 is gone: a stale list is one 409 now (landmark:
  // the new constant above is present).
  assert.ok(!patch.includes("unknownTable" + "Message"), "PATCH no longer answers 400 with the unknown-table copy");
});

test("PIN (R6): the live leg's order-claim filter is the same shape as the real occupyTable claim - status Available, keyed by tableNo", () => {
  const ordersSrc = stripComments(readSrc(ORDERS_ROUTE));
  const legSrc = stripComments(readSrc(FLOOR_LEG));

  // Vision guard: the extractor really finds the route's literal, and it
  // notices when that literal changes.
  assert.equal(claimStatusOfRoute(ordersSrc), "Available", "occupyTable must still claim only an Available table");
  assert.notEqual(
    claimStatusOfRoute(ordersSrc.replace('status: "Available" }', 'status: "Reserved" }')),
    "Available",
    "the extractor must see a changed status literal",
  );

  const leg = claimStatusOfLeg(legSrc);
  assert.equal(leg.shape, "Available", "the leg's ORDER_CLAIM_FILTER_SHAPE must carry status Available");
  assert.equal(leg.keyedByTableNo, true, "the leg's claim filter must be keyed by tableNo");
  assert.equal(leg.shape, claimStatusOfRoute(ordersSrc), "leg and route must agree on the claim status");
});
