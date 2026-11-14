import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Kitchen paid Walk-In arm (spec 2026-11-13) — source pins over COMMENT-STRIPPED source: the arm's two-phase read, its
// place in the kitchen route's GET merge, and the widened POST gate. DB-free.

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const KITCHEN = "app/api/kitchen/route.ts";
const ARM = "lib/kitchen-walkin-server.ts";

/** The text of one exported handler: from its `export async function NAME(` to the next export (or the file end). */
function handlerOf(src: string, name: "GET" | "POST"): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `landmark: ${name} handler exists`);
  const next = src.indexOf("export async function ", start + 10);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

test("readKitchenWalkInArm: the token arm's two-phase shape over walkInArmFilter(mode)", () => {
  const src = read(ARM);
  assert.match(src, /export async function readKitchenWalkInArm\(mode: TokenMode\): Promise<KitchenOrderInput\[\]>/);
  assert.match(src, /Order\.find\(\{\s*\.\.\.walkInArmFilter\(mode\),\s*kotRounds:\s*\{\s*\$gte:\s*1\s*\}\s*\}\)/, "candidates");
  assert.match(src, /\.select\("kotFiredAt createdAt items\.kotRound items\.noKot"\)/);
  assert.match(src, /\.sort\(\{\s*createdAt:\s*-1\s*\}\)/);
  assert.match(src, /\.limit\(TOKEN_DAY_SCAN_LIMIT\)/);
  assert.match(src, /if \(candidates\.length === 0\) return \[\];/, "early exit without candidates");
  assert.match(src, /KotTick\.find\(\{\s*_id:\s*\{\s*\$in:\s*ids\s*\}\s*\}\)\.select\("readyAt"\)/, "ticks by _id");
  assert.match(src, /pendingTokenIds\(kept,\s*readyAtById,\s*Date\.now\(\)\)/);
  assert.match(src, /if \(pending\.length === 0\) return \[\];/, "early exit when nothing is pending");
  assert.match(src, /Order\.find\(\{\s*_id:\s*\{\s*\$in:\s*pending\s*\},\s*\.\.\.walkInArmFilter\(mode\)\s*\}\)/, "full read re-applies the filter");
  assert.match(src, /\.select\(kitchenSelectOf\(filterModeOf\(mode\)\)\)/);
  assert.match(src, /\.sort\(\{\s*createdAt:\s*1\s*\}\)/);
  for (const banned of ["connectDB(", ".updateOne(", ".create(", "$set", "setTimeout", "setInterval"]) {
    assert.ok(!src.includes(banned), `read only: no ${banned}`);
  }
});

// Fix wave F1: a paid Walk-In whose every fired line is noKot is still written with kotRounds 1, so it is a candidate,
// but buildKitchenCards gives it no card and nobody can tap Ready. Kept, it would hold one of pendingTokenIds' oldest-
// first slots for 2 h, and 60 of them would hide every newer real paid Walk-In. The token arm needs no such drop.
test("readKitchenWalkInArm: noKot-only candidates are dropped BEFORE pendingTokenIds, which gets the kept list", () => {
  const src = read(ARM);
  assert.match(src, /import \{ orderSkipsKitchen \} from "@\/lib\/kitchen-lines";/);
  const drop = /const kept = candidates\.filter\(\s*\(order\) => !\(order\.items !== undefined && orderSkipsKitchen\(\{ items: order\.items \}\)\),?\s*\);/;
  assert.match(src, drop, "the noKot-only drop, guarded on items like token-board.ts");
  const dropAt = src.search(drop);
  const pendingAt = src.indexOf("pendingTokenIds(");
  assert.ok(dropAt > 0 && pendingAt > dropAt, "the drop sits before pendingTokenIds(");
  assert.equal(count(src, "pendingTokenIds("), 1, "pendingTokenIds runs once");
  assert.ok(!src.includes("pendingTokenIds(candidates"), "pendingTokenIds never receives the unfiltered candidates");
  assert.match(src, /const pending = pendingTokenIds\(kept,/, "pendingTokenIds receives the kept list");
});

test("kitchen GET: the Walk-In arm runs once, after the token arm, and merges last", () => {
  const src = read(KITCHEN);
  const get = handlerOf(src, "GET");
  assert.equal(count(get, "readKitchenWalkInArm(mode)"), 1);
  assert.equal(count(handlerOf(src, "POST"), "readKitchenWalkInArm("), 0, "not in POST");
  assert.match(
    get,
    /mergeKitchenArms\(mergeKitchenArms\(open as unknown as KitchenOrderInput\[\],\s*tokenArm\),\s*walkInArm\)/,
  );
  assert.ok(get.indexOf("readKitchenTokenArm(") < get.indexOf("readKitchenWalkInArm("), "token arm first");
  assert.equal(count(get, "Order.find("), 1, "the route itself still runs ONE Order.find");
  assert.match(get, /tabCount:\s*open\.length/, "tabCount stays the open arm only");
});

test("kitchen POST: the gate is kitchenGateFilter(mode), before every writer", () => {
  const post = handlerOf(read(KITCHEN), "POST");
  assert.match(post, /Order\.exists\(\{\s*_id:\s*orderId,\s*\.\.\.kitchenGateFilter\(mode\)\s*\}\)/);
  assert.ok(!post.includes("kitchenOrderFilter("), "the old gate is gone from POST");
  const gateAt = post.indexOf("Order.exists(");
  const readyAt = post.indexOf("writeKotReady(");
  const tickAt = post.indexOf("$addToSet");
  const untickAt = post.indexOf("$pull");
  assert.ok(gateAt > 0 && readyAt > gateAt && tickAt > gateAt && untickAt > gateAt, "every writer comes after the gate");
  assert.ok(post.includes('"That tab was settled — its card is already off the board"'));
  assert.ok(post.includes('"Tab not found or already settled"'));
  assert.ok(post.includes('"That tab was settled — the line stays marked done"'));
});
