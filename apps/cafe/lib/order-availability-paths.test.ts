import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// Menu B2 Slice A - source pins for the server menu re-check: both staff order
// write routes refuse (409) a NEW line whose item is gone / out of stock /
// re-priced / renamed, AFTER every replay answer and 400, BEFORE any number,
// claim, fence or write. Plan: .claude/plan/v2/_research/menu-redesign/
// 02-PLAN-b2.md (Slice A + rulings B2-R1..R3). The rule itself is
// lib/order-availability.ts (behaviour: order-availability.test.ts; the live
// legs scripts/verify-menu-orders-live*.ts prove the routes end to end).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const ORDERS_ROUTE = "app/api/orders/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const PRODUCTS_ROUTE = "app/api/products/route.ts";
const CRUD_ROUTE = "lib/crud-route.ts";
const RULE_FILE = "lib/order-availability.ts";
const NEW_SELECT = '.select("name variations modifiers modifiersPreselected price discount available isActive")';

// Comment-stripped, CRLF-normalised (autocrlf can flip the checkout).
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8")).replace(/\r\n/g, "\n");
const count = (src: string, needle: string) => src.split(needle).length - 1;

function mustIndexOf(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

/** Every needle present FIRST, then each strictly after the one before it. */
function assertChain(src: string, chain: ReadonlyArray<[string, string]>, why: string): number[] {
  const at = chain.map(([needle, label]) => mustIndexOf(src, needle, label));
  at.forEach((idx, i) => {
    if (i === 0) return;
    assert.ok(idx > at[i - 1], `${chain[i][1]} must come after ${chain[i - 1][1]} - ${why}`);
  });
  return at;
}

const CREATE_REFUSAL = "orderLinesRefusal(products, data.items)";
const CREATE_ANSWER = "if (menuRefusal) return (await lateReplay()) ?? failure(menuRefusal, MENU_REFUSAL_STATUS);";
const ROUND_REFUSAL = "orderLinesRefusal(products, parsed.data.items)";
const ROUND_ANSWER =
  "if (menuRefusal) return (key ? await roundReplayAfterMiss(id, key, parsed.data.items) : null) ?? failure(menuRefusal, MENU_REFUSAL_STATUS);";

test("PIN (create): the menu re-check sits after every replay answer and 400, before pricing, numbers, claims and writes", () => {
  const src = read(ORDERS_ROUTE);
  const at = assertChain(
    src,
    [
      ["if (replayed) return await createReplayVerdict(", "the top replay answer"],
      ["if (bad) return failure(bad, 400);", "the variation 400"],
      ["if (badRemovals) return failure(badRemovals, 400);", "the removals 400"],
      ['if ("error" in table) return failure(table.error, 400);', "the table 400"],
      ["const gstCfg = gstConfigOf(settings);", "the last binding lateReplay reads"],
      ["const lateReplay = async", "the lateReplay declaration"],
      [CREATE_REFUSAL, "the menu check"],
      [CREATE_ANSWER, "the replay-first 409"],
      ["const plainTotals = computeOrderTotals(", "the pricing"],
      ["await nextOrderSequence();", "the order number"],
      ["await claimFor(orderId)", "the stamp claim"],
      ["await allocateOpeningSlips(printCfg, { kitchen: kot.kitchen })", "the opening KOT number and token"],
      ["Order.create({ ...doc, orderId });", "the first insert"],
    ],
    "a refused line must answer before it costs a number, a claim or a write",
  );
  // Upper bound: nothing that spends or publishes may precede the 409.
  const refusalAnswer = at[7];
  for (const writer of ["publishCafeEvent(", "fencePromoFor(orderId)", "runCreateFollowUps(", "bumpOrderSequenceTo("]) {
    const w = mustIndexOf(src, writer, `writer landmark ${writer}`);
    assert.ok(refusalAnswer < w, `the menu 409 must come before ${writer}`);
  }
  assert.equal(count(src, "const lateReplay ="), 1, "lateReplay is declared once (moved up, not copied)");
});

test("PIN (create): lateReplay is declared before its first call, and the menu 409 answers a landed twin first", () => {
  const src = read(ORDERS_ROUTE);
  const decl = mustIndexOf(src, "const lateReplay = async", "the declaration");
  const firstCall = mustIndexOf(src, "await lateReplay()", "the first call");
  assert.ok(decl < firstCall, "declared before it is first called (const TDZ)");
  assert.equal(firstCall, mustIndexOf(src, CREATE_ANSWER, "the menu 409") + "if (menuRefusal) return (".length, "the menu 409 is the first lateReplay call");
  const printCfg = mustIndexOf(src, "const printCfg = printConfigOf(settings);", "the printCfg binding");
  assert.ok(printCfg < decl, "printCfg is bound before lateReplay reads it");
});

test("PIN (round): the menu re-check sits after the open-tab 409 and before the round number, slip number, stamp claim and CAS", () => {
  const src = read(ITEMS_ROUTE);
  const at = assertChain(
    src,
    [
      ["if (replay) return replay;", "the replay answer"],
      ["if (bad) return failure(bad, 400);", "the variation 400"],
      ["if (badRemovals) return failure(badRemovals, 400);", "the removals 400"],
      ['return failure("Can only add items to an open tab", 409);', "the open-tab 409"],
      [ROUND_REFUSAL, "the menu check"],
      [ROUND_ANSWER, "the replay-after-miss 409"],
      ["const round = ", "the round number"],
      ["nextPrintedNumber(\"kot\"", "the slip number"],
      ["claimRewardStamps(", "the stamp claim"],
      ["Order.findOneAndUpdate(filter, update", "the CAS"],
    ],
    "a refused line must answer before it costs a round, a number, a claim or the CAS",
  );
  const refusalAnswer = at[5];
  for (const writer of ["publishCafeEvent(", "returnRewardStamps("]) {
    const w = mustIndexOf(src, writer, `writer landmark ${writer}`);
    assert.ok(refusalAnswer < w, `the menu 409 must come before ${writer}`);
  }
});

test("PIN (round): the 409 answers a landed twin via roundReplayAfterMiss in the same statement, and the first-occurrence chains are untouched", () => {
  const src = read(ITEMS_ROUTE);
  const start = mustIndexOf(src, "if (menuRefusal)", "the menu 409 statement");
  const end = mustIndexOf(src, ";\n", "its end", start);
  const stmt = src.slice(start, end + 1);
  assert.ok(stmt.includes("roundReplayAfterMiss(id, key, parsed.data.items)"), "the twin lookup is in the menu 409 statement");
  assert.ok(stmt.includes("failure(menuRefusal, MENU_REFUSAL_STATUS)"), "the refusal is the fallback answer");
  // The CAS-miss chain (write-route-paths, reward-wiring) keys on these texts.
  assert.equal(count(src, "const late = "), 1, "the CAS-miss late replay is the only `const late =`");
  assert.equal(count(src, "if (late) return late;"), 1, "and the only late answer");
  assert.equal(count(src, "if (!updated) {"), 1, "and the only CAS-miss branch");
});

test("PIN (both routes): one menu check, judging only the request's own new lines", () => {
  for (const [rel, arg] of [
    [ORDERS_ROUTE, "products, data.items"],
    [ITEMS_ROUTE, "products, parsed.data.items"],
  ] as const) {
    const src = read(rel);
    assert.equal(count(src, "orderLinesRefusal("), 1, `${rel}: exactly one call`);
    const m = /orderLinesRefusal\(([^)]*)\)/.exec(src);
    assert.ok(m, `${rel}: the call is parseable`);
    assert.equal(m[1], arg, `${rel}: the argument is the request's items only`);
    assert.doesNotMatch(m[1], /old\.items|newItems|fullItems|rewardItems/, `${rel}: never a merged or server-built list`);
    assert.ok(
      src.includes('import { orderLinesRefusal, MENU_REFUSAL_STATUS } from "@/lib/order-availability";'),
      `${rel}: imports the frozen contract`,
    );
    assert.equal(count(src, "effectiveUnitPrice("), 0, `${rel}: no second price rule (B2-R3)`);
    assert.equal(count(src, "publicVisible"), 0, `${rel}: a hidden-from-QR item stays sellable`);
  }
});

test("PIN (both routes): the product read carries the fields the rule judges", () => {
  for (const rel of [ORDERS_ROUTE, ITEMS_ROUTE]) {
    const src = read(rel);
    assert.equal(count(src, NEW_SELECT), 1, `${rel}: one product select, with price discount available isActive`);
    assert.ok(src.includes("price discount available isActive"), `${rel}: landmark`);
    assert.equal(count(src, "Product.find("), 1, `${rel}: still one product read`);
  }
});

test("PIN (products): ?fresh=1 is an uncached read of the same active list", () => {
  const src = read(PRODUCTS_ROUTE);
  mustIndexOf(src, "...listSpecConfig(PRODUCT_LIST),", "landmark: the shared list spec");
  assert.ok(
    src.includes('return { query: archived ? { isActive: false } : {}, filtered: archived || sp.get("fresh") === "1" };'),
    'fresh=1 flips `filtered` and leaves the query {} so the active baseFilter still applies',
  );
  assert.equal(count(src, 'sp.get("fresh")'), 1, "one fresh param read");
  // The bypass is crud-route's `filtered` flag: no cache read, no cache write.
  const crud = read(CRUD_ROUTE);
  mustIndexOf(crud, "let filtered = false;", "landmark: the flag");
  assert.equal(count(crud, "if (!filtered) {"), 1, "the cache read is skipped when filtered");
  assert.equal(count(crud, "if (!filtered) cache.set("), 1, "the cache write is skipped when filtered");
  assert.equal(count(crud, "if (!filtered && config.listSpec) {"), 1, "the shared list function is skipped when filtered");
});

test("PIN (rule file): lib/order-availability.ts stays pure, judges by derivedLinePrice, and never reads publicVisible", () => {
  const src = read(RULE_FILE);
  mustIndexOf(src, "derivedLinePrice(", "vision guard: the one price rule is called");
  mustIndexOf(src, "export function orderLinesRefusal(", "vision guard: the routes' entry point");
  const specifiers = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "vision guard: the imports were parsed");
  for (const spec of specifiers) {
    assert.doesNotMatch(spec, /mongoose|^@\/models|\/models\/|@\/lib\/db$|\/db$/, `no server-only import: ${spec}`);
  }
  assert.equal(count(src, "import mongoose"), 0, "no mongoose value import");
  assert.equal(count(src, "publicVisible"), 0, "publicVisible is never read");
  assert.equal(count(src, "effectiveUnitPrice("), 0, "no second price rule (B2-R3)");
});
