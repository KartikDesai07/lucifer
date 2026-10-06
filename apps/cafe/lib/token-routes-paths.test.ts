import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { KotTick } from "@/models/KotTick";
import { writeKotReady, writeTokenCollected } from "@/lib/token-board-server";

// Print customization S8 (phase 2) — the server slice: the kitchen route's widened gate, the token list and token
// action routes, and the token board's queries/writers. Source pins over COMMENT-STRIPPED source, plus a DB-free
// behavioural leg that drives the REAL writers against a mocked KotTick.updateOne (the exact call shape the routes use).

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const KITCHEN = "app/api/kitchen/route.ts";
const TOKENS = "app/api/tokens/route.ts";
const TOKEN_ID = "app/api/tokens/[id]/route.ts";
const SERVER = "lib/token-board-server.ts";

/** The text of one exported handler: from its `export async function NAME(` to the next export (or the file end). */
function handlerOf(src: string, name: "GET" | "POST"): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `landmark: ${name} handler exists`);
  const next = src.indexOf("export async function ", start + 10);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

// ── Kitchen GET: tokens off is exactly today's query; the token arm is behind the mode ─────────────────────────────

test("kitchen GET: arm 1 is kitchenOrderFilter(TOKENS_OFF) + kotRounds >= 1, selected by kitchenSelectOf(filterModeOf(mode)), sorted createdAt asc, limited by OPEN_TAB_LIMIT", () => {
  const src = read(KITCHEN);
  const get = handlerOf(src, "GET");
  assert.match(src, /const OPEN_TAB_LIMIT = 100;/, "landmark: the open-tab bound is still 100");
  assert.match(get, /Order\.find\(\{\s*\.\.\.kitchenOrderFilter\(TOKENS_OFF\),\s*kotRounds:\s*\{\s*\$gte:\s*1\s*\}\s*\}\)/, "arm 1 is the OFF filter, never the mode's filter");
  assert.match(get, /\.select\(kitchenSelectOf\(filterModeOf\(mode\)\)\)/);
  assert.match(get, /\.sort\(\{\s*createdAt:\s*1\s*\}\)/);
  assert.match(get, /\.limit\(OPEN_TAB_LIMIT\)/);
  assert.equal(count(get, "Order.find("), 1, "the route itself runs exactly ONE Order.find (the token arm lives in token-board-server)");
  // vision guard for the next negative: the filter symbols are what the route uses, so a raw literal would be a regression
  assert.ok(!/status:\s*"Pending"/.test(src) && !/payment:\s*"Unpaid"/.test(src), "no hand-written open-tab filter in the route — kitchenOrderFilter owns it");
});

test("kitchen GET: the token arm runs ONLY under mode.enabled, once, and tabCount counts the open arm only", () => {
  const src = read(KITCHEN);
  const get = handlerOf(src, "GET");
  assert.equal(count(get, "readKitchenTokenArm("), 1, "one call, in GET");
  assert.equal(count(handlerOf(src, "POST"), "readKitchenTokenArm("), 0, "not in POST");
  const at = get.indexOf("readKitchenTokenArm(");
  assert.match(get.slice(Math.max(0, at - 60), at), /mode\.enabled\s*\?\s*await\s*$/, "the call sits directly behind a mode.enabled condition");
  assert.match(get, /mergeKitchenArms\(open as unknown as KitchenOrderInput\[\],\s*tokenArm\)/, "the arms merge with the open arm winning");
  assert.match(get, /tabCount:\s*open\.length/, "tabCount is the open arm only");
  assert.ok(!/tabCount:\s*orders\.length/.test(get), "never the merged length");
  assert.match(get, /tokenModeOf\(await getSettings\(\),\s*new Date\(\)\)/, "the mode comes from the (cached) settings read");
  assert.ok(!/@\/models\/Settings/.test(src), "settings via getSettings(), not the model");
});

test("kitchen POST: the gate is kitchenOrderFilter(filterModeOf(mode)) and runs BEFORE any write; ready goes through writeKotReady; tick and untick keep their writers", () => {
  const post = handlerOf(read(KITCHEN), "POST");
  assert.match(post, /Order\.exists\(\{\s*_id:\s*orderId,\s*\.\.\.kitchenOrderFilter\(filterModeOf\(mode\)\)\s*\}\)/);
  const gateAt = post.indexOf("Order.exists(");
  const readyAt = post.indexOf("writeKotReady(");
  const tickAt = post.indexOf("$addToSet");
  const untickAt = post.indexOf("$pull");
  assert.ok(gateAt > 0 && readyAt > gateAt && tickAt > gateAt && untickAt > gateAt, "every writer comes after the gate");
  assert.match(post, /publishCafeEvent\("kot-ticked"\)/, "the kitchen nudge is unchanged");
  assert.ok(post.indexOf('publishCafeEvent("kot-ticked")') > Math.max(readyAt, tickAt, untickAt), "and still after the writes");
});

// ── Token list route ────────────────────────────────────────────────────────────────────────────────────────────────

test("GET /api/tokens: requireAuth, tokens off answers BEFORE any board read (no Order query), tokens on spreads readTokenBoard", () => {
  const src = read(TOKENS);
  const get = handlerOf(src, "GET");
  assert.match(get, /requireAuth\(\)/);
  assert.ok(!src.includes("requireAdmin"), "counter staff, not admin-only");
  const offAt = get.indexOf("if (!mode.enabled)");
  const readAt = get.indexOf("readTokenBoard(");
  assert.ok(offAt > 0 && readAt > 0, "landmarks: the off gate and the board read both exist");
  assert.ok(offAt < readAt, "the off answer comes first");
  const offBlock = get.slice(offAt, readAt);
  assert.match(offBlock, /enabled:\s*false,\s*preparing:\s*\[\],\s*ready:\s*\[\]/, "the off payload is the empty board");
  assert.match(offBlock, /return success\(/);
  assert.match(get, /enabled:\s*true,\s*\.\.\.\(await readTokenBoard\(mode,\s*now\.getTime\(\)\)\)/, "the on payload is the board read at one instant");
  assert.ok(!/@\/models\//.test(src), "the route reads no model itself — tokens off cannot reach Orders");
  assert.match(src, /export const dynamic = "force-dynamic"/, "never cached");
});

// ── Token action route ──────────────────────────────────────────────────────────────────────────────────────────────

test("POST /api/tokens/[id]: requireAuth (never requireAdmin) and a 4-action strict discriminated union", () => {
  const src = read(TOKEN_ID);
  assert.match(handlerOf(src, "POST"), /requireAuth\(\)/);
  assert.ok(!src.includes("requireAdmin"), "the kitchen's staff surface, not admin");
  const at = src.indexOf('z.discriminatedUnion("action", [');
  assert.ok(at > 0, "landmark: a discriminated union on action");
  const union = src.slice(at, src.indexOf("]);", at));
  const literals = Array.from(union.matchAll(/z\.literal\("([a-z]+)"\)/g)).map((m) => m[1]);
  assert.deepEqual(literals, ["ready", "unready", "collected", "uncollected"], "exactly the four actions, in this order");
  assert.equal(count(union, ".strict()"), 4, "every variant is strict: a stray field is a 400");
  assert.equal(count(union, "seenFiredAt"), 1, "only Ready carries seenFiredAt");
  assert.match(union, /action:\s*z\.literal\("ready"\),\s*seenFiredAt:\s*z\.string\(\)\.datetime\(\)\.optional\(\)/);
  assert.match(src, /validateBody\(req,\s*tokenActionSchema\)/, "the shared validator, the envelope's 400");
});

test("POST /api/tokens/[id]: tokens off is a 404 BEFORE any Order read; the gate is tokenOrderFilter + kotRounds >= 1; writes go through the two token writers", () => {
  const post = handlerOf(read(TOKEN_ID), "POST");
  const offAt = post.indexOf("if (!mode.enabled) return notFound(");
  const existsAt = post.indexOf("Order.exists(");
  assert.ok(offAt > 0 && existsAt > 0, "landmarks: the off gate and the Order gate both exist");
  assert.ok(offAt < existsAt, "tokens off answers before any Order query");
  assert.equal(post.slice(0, offAt).includes("Order."), false, "nothing before the off gate touches Orders");
  assert.match(post, /notFound\("Tokens are off"\)/);
  assert.match(post, /Order\.exists\(\{\s*_id:\s*id,\s*\.\.\.tokenOrderFilter\(mode\.dayStart\),\s*kotRounds:\s*\{\s*\$gte:\s*1\s*\}\s*\}\)/);
  assert.match(post, /notFound\("That token is no longer on the list"\)/);
  assert.match(post, /mongoose\.isValidObjectId\(id\)/, "a malformed id is refused before any query");
  const gateAt = existsAt;
  const writeAt = Math.min(post.indexOf("writeKotReady("), post.indexOf("writeTokenCollected("));
  assert.ok(writeAt > gateAt, "the writers come after the gate");
  assert.match(post, /writeKotReady\(id,\s*body\.action === "ready",\s*body\.action === "ready" \? body\.seenFiredAt : undefined\)/, "seenFiredAt only ever rides a Ready");
  assert.match(post, /writeTokenCollected\(id,\s*body\.action === "collected"\)/);
  assert.match(post, /success\(\{\s*id,\s*action:\s*body\.action\s*\}\)/, "the envelope answer");
});

test("POST /api/tokens/[id]: the route writes nothing itself — no KotTick/Order write, no Order model write, no Settings write", () => {
  const src = read(TOKEN_ID);
  assert.match(src, /writeKotReady\(/, "positive landmark: it does write, through the helper");
  for (const banned of [".updateOne(", ".updateMany(", ".findOneAndUpdate(", ".save(", ".create(", ".deleteOne(", ".insertMany(", "KotTick."]) {
    assert.ok(!src.includes(banned), `the token route must not call ${banned}`);
  }
});

// ── token-board-server: queries and writers ─────────────────────────────────────────────────────────────────────────

test("token-board-server: the board read selects TOKEN_BOARD_SELECT and no select literal in the file reaches a name, amount, dish or receiver", () => {
  const src = read(SERVER);
  assert.match(src, /readTokenBoard[\s\S]*\.select\(TOKEN_BOARD_SELECT\)/, "readTokenBoard uses the pinned constant");
  const literals = Array.from(src.matchAll(/\.select\("([^"]*)"\)/g)).map((m) => m[1]);
  assert.ok(literals.length >= 3, `landmark: the scan saw the file's select literals (${literals.join(" | ")})`);
  for (const literal of literals) {
    for (const banned of ["customerName", "total", "items", "paidAmount", "receiver", "paymentMode"]) {
      assert.ok(!literal.split(/\s+/).includes(banned), `select "${literal}" must not carry ${banned}`);
    }
  }
  assert.match(src, /\.sort\(\{\s*createdAt:\s*-1\s*\}\)\s*\.limit\(TOKEN_DAY_SCAN_LIMIT\)/, "the board scan is bounded");
  assert.match(src, /select\("readyAt readyMarkedAt collectedAt"\)/, "the ticks read is the three stamps and not the refs");
});

test("token-board-server readKitchenTokenArm: indexed candidates, ticks by _id, the same comparison, then the FULL read re-applies paidTokenFilter", () => {
  const src = read(SERVER);
  const arm = src.slice(src.indexOf("export async function readKitchenTokenArm("), src.indexOf("export async function readTokenBoard("));
  assert.ok(arm.length > 100, "landmark: the arm body was found");
  assert.match(arm, /Order\.find\(\{\s*\.\.\.paidTokenFilter\(dayStart\),\s*kotRounds:\s*\{\s*\$gte:\s*1\s*\}\s*\}\)/, "candidates: paid token orders with a fired round");
  assert.match(arm, /\.limit\(TOKEN_DAY_SCAN_LIMIT\)/);
  assert.match(arm, /KotTick\.find\(\{\s*_id:\s*\{\s*\$in:\s*ids\s*\}\s*\}\)/, "ticks are read by _id, never scanned by readyAt");
  assert.match(arm, /pendingTokenIds\(candidates,\s*readyAtById,\s*Date\.now\(\)\)/, "the comparison, not readyAt presence, with the server clock for the stale-out (a paid order fired 2 h ago leaves the kitchen board)");
  assert.match(arm, /Order\.find\(\{\s*_id:\s*\{\s*\$in:\s*pending\s*\},\s*\.\.\.paidTokenFilter\(dayStart\)\s*\}\)/, "the full read re-applies the paid-token filter (a cancel between the two reads drops out)");
  assert.match(arm, /\.select\(kitchenSelectOf\(\{\s*tokenMode:\s*true,\s*dayStart\s*\}\)\)/, "the card read carries the token number");
  assert.ok(!/readyAt:\s*\{\s*\$/.test(arm), "no readyAt range query (it has no index)");
});

test("token-board-server writers: ONE Ready writer shared by the kitchen and token routes; Collected upserts only when collecting", () => {
  const src = read(SERVER);
  assert.match(src, /readyUpdateOf\(ready,\s*seenFiredAt,\s*Date\.now\(\)\)/);
  assert.match(src, /collectedUpdateOf\(collected,\s*Date\.now\(\)\)/);
  assert.match(src, /collected\s*\?\s*\{\s*upsert:\s*true\s*\}\s*:\s*\{\s*\}/, "an un-collect never upserts");
  assert.equal(count(read(KITCHEN), "writeKotReady("), 1);
  assert.equal(count(read(TOKEN_ID), "writeKotReady("), 1, "the token route calls the same writer once");
});

// ── The real writers against a mocked KotTick.updateOne ─────────────────────────────────────────────────────────────

const FIXED_NOW = Date.parse("2026-10-06T10:15:00.000Z");
const ORDER_HEX = "a".repeat(24);

async function calls(run: () => Promise<unknown>): Promise<Array<{ filter: unknown; update: unknown; options: unknown }>> {
  const seen: Array<{ filter: unknown; update: unknown; options: unknown }> = [];
  const updateMock = mock.method(KotTick, "updateOne", ((filter: unknown, update: unknown, options: unknown) => {
    seen.push({ filter, update, options });
    return Promise.resolve({ acknowledged: true });
  }) as never);
  const nowMock = mock.method(Date, "now", () => FIXED_NOW);
  try {
    await run();
  } finally {
    nowMock.mock.restore();
    updateMock.mock.restore();
  }
  return seen;
}

test("writeKotReady(ready): one updateOne on the order's _id, $set readyAt = the seen instant and readyMarkedAt = server now, upsert", async () => {
  const seen = new Date(FIXED_NOW - 12 * 60_000);
  const [call, ...rest] = await calls(() => writeKotReady(ORDER_HEX, true, seen.toISOString()));
  assert.equal(rest.length, 0, "a single write");
  assert.deepStrictEqual(call.filter, { _id: ORDER_HEX });
  assert.deepStrictEqual(call.update, { $set: { readyAt: seen, readyMarkedAt: new Date(FIXED_NOW) } });
  assert.deepStrictEqual(call.options, { upsert: true });
});

test("writeKotReady: a future seenFiredAt is clamped to the server clock; absent means now; un-ready $unsets both keys with \"\" (upsert, as the kitchen's did)", async () => {
  const [future] = await calls(() => writeKotReady(ORDER_HEX, true, new Date(FIXED_NOW + 60 * 60_000).toISOString()));
  assert.deepStrictEqual(future.update, { $set: { readyAt: new Date(FIXED_NOW), readyMarkedAt: new Date(FIXED_NOW) } });
  const [absent] = await calls(() => writeKotReady(ORDER_HEX, true));
  assert.deepStrictEqual(absent.update, { $set: { readyAt: new Date(FIXED_NOW), readyMarkedAt: new Date(FIXED_NOW) } });
  const [undo] = await calls(() => writeKotReady(ORDER_HEX, false, new Date(FIXED_NOW - 60_000).toISOString()));
  assert.deepStrictEqual(undo.update, { $unset: { readyAt: "", readyMarkedAt: "" } });
  assert.deepStrictEqual(undo.filter, { _id: ORDER_HEX });
});

test("writeTokenCollected: collecting $sets collectedAt = now WITH upsert; un-collecting $unsets it with \"\" and NO upsert", async () => {
  const [collect] = await calls(() => writeTokenCollected(ORDER_HEX, true));
  assert.deepStrictEqual(collect.filter, { _id: ORDER_HEX });
  assert.deepStrictEqual(collect.update, { $set: { collectedAt: new Date(FIXED_NOW) } });
  assert.deepStrictEqual(collect.options, { upsert: true });
  const [undo] = await calls(() => writeTokenCollected(ORDER_HEX, false));
  assert.deepStrictEqual(undo.update, { $unset: { collectedAt: "" } });
  assert.deepStrictEqual(undo.options, {}, "no upsert on an un-collect");
  assert.equal(Object.hasOwn(undo.options as object, "upsert"), false);
});

// ── Hygiene over every file of the slice ────────────────────────────────────────────────────────────────────────────

test("hygiene: the four server files have no console call, no cafe name, no hand-rolled response (envelope helpers only), no any", () => {
  const cafeName = "Luci" + "fer";
  for (const rel of [KITCHEN, TOKENS, TOKEN_ID, SERVER]) {
    const rawSrc = raw(rel);
    const src = stripComments(rawSrc);
    assert.match(src, /export (async )?function/, `landmark: ${rel} read`);
    assert.ok(!rawSrc.includes("console" + "."), `${rel}: no console call`);
    assert.ok(!rawSrc.toLowerCase().includes(cafeName.toLowerCase()), `${rel}: no cafe name`);
    assert.ok(!/NextResponse|Response\.json\(|new Response\(/.test(src), `${rel}: responses go through the api-helpers envelope`);
    assert.ok(!/:\s*any\b|\bas any\b|<any>/.test(src), `${rel}: no any`);
  }
  for (const rel of [KITCHEN, TOKENS, TOKEN_ID]) {
    const src = read(rel);
    assert.match(src, /success\(/, `${rel}: answers with success()`);
    assert.match(src, /serverError\(/, `${rel}: errors go through serverError()`);
    assert.match(src, /await connectDB\(\)/, `${rel}: connectDB before work`);
  }
});
