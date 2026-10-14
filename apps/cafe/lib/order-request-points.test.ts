import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { createPublicOrderRequestSchema } from "@pos/shared/schemas/public-order.schema";
import { ORDER_REWARD_SNAPSHOT_KEYS } from "@pos/shared/reward-redemption";

// CB-7 S6 session 2 (D1) - the diner QR "Use my points" ASK: submit gate -> stored INTENT -> accept copies a HINT. Nothing
// is spent at submit or accept (staff spend at payment). Source pins (the files are Mongoose / cookie bound) plus the
// schema as behaviour. Pin discipline: every absence is paired with a positive landmark; orderings carry an occurrence COUNT.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => stripComments(readFileSync(path.join(HERE, "..", rel), "utf8"));

const GATE = "lib/order-request-points.ts";
const ROUTE = "app/api/public/order-request/route.ts";
const CREATE = "lib/order-request-create.ts";
const ACCEPT = "lib/order-request-accept.ts";
const ADDROUND = "lib/order-request-accept-addround.ts";
const MODEL = "models/OrderRequest.ts";
const ORDER_PATHS = "models/order-reward-paths.ts";

function at(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}
const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length;
const WRITES = /updateOne|findOneAndUpdate|findByIdAndUpdate|\$set|\.create\(|\.save\(|spendPoints|returnPoints|resolvePointsSpend/;

// ── the gate ────────────────────────────────────────────────────────────────

test("gate: resolveRequestPoints runs its ten steps in the stated order, each once", () => {
  const src = read(GATE);
  assert.match(src, /export async function resolveRequestPoints/, "landmark");
  const order = [
    ["if (data.requestedPoints !== true) return {};", "nothing asked"],
    ["if (data.promoCode) return { error: PROMO_BLOCKS_REWARD };", "promo first"],
    ["if (data.requestedRewardAt !== undefined || data.requestedCardId !== undefined) {", "rung or card also asked"],
    ["await readDinerSession()", "session read"],
    ["canonicalPromoMobile(data.mobile) !== canonicalPromoMobile(session.mobile)", "canonical mobile compare"],
    // Review LOW-2: the accept attaches the customer by this number, so it must still be the session's own row.
    ["await Customer.findOne({ mobile: data.mobile }).select(\"_id\").lean()", "the accept's own customer lookup"],
    ["if (!owner || String(owner._id) !== session.customerId) return { error: POINTS_NEED_SIGN_IN };", "that row is the session's"],
    ["await hasOpenTabNow(table.tableNo)", "open tab"],
    ["if (!dinerAccountsOn(settings)) return { error: POINTS_NONE_TO_USE };", "accounts off"],
    ["await readPointsStateOf(session.customerId)", "the wallet read, by the SESSION's customer"],
    ["return { requestedPoints: true };", "success carries the ask only"],
  ] as const;
  let prev = -1;
  for (const [needle, label] of order) {
    const idx = at(src, needle, label);
    assert.ok(idx > prev, `step "${label}" is out of order`);
    assert.equal(src.split(needle).length - 1, 1, `step "${label}" must appear exactly once`);
    prev = idx;
  }
  assert.equal(count(src, /error: POINTS_NEED_SIGN_IN/g), 3, "no session, a mobile mismatch and a number now on another row all refuse with sign-in copy");
  assert.equal(count(src, /error: POINTS_NONE_TO_USE/g), 2, "accounts off + no balance both refuse with nothing-to-use copy");
  assert.match(src, /return \{ error: REWARD_ON_OPEN_TAB \}/, "an open tab is refused at submit");
  assert.match(src, /error: POINTS_REWARD_EXCLUSIVE/, "a rung or a card is refused");
  assert.match(src, /!state \|\| pointsBalance\(state\.rewardCards, new Date\(\)\) <= 0/, "a zero or unreadable balance is refused");
});

test("gate: READ-ONLY - no write of any kind, and never the levels-earning or scratch-block gates (held points stay usable)", () => {
  const src = read(GATE);
  assert.match(src, /readPointsStateOf\(/, "landmark: the gate does read the wallet");
  assert.ok(!WRITES.test(src), "the points gate must never WRITE or spend - a request is pre-money");
  assert.ok(!/rewardLevelsEarning|scratchCardsBlockedFor/.test(src), "points already held stay usable while levels are off / scratch is blocked");
  assert.ok(!/readPointsStateOf\(data/.test(src), "identity is never the body's mobile");
});

// ── the route and the honeypot ──────────────────────────────────────────────

test("route: the points gate sits after the card gate and BEFORE the doc, once; a refusal refunds + 422; create spreads it", () => {
  const route = read(ROUTE);
  const cardIdx = at(route, "const card = await resolveRequestCard(", "the card gate");
  const pointsIdx = at(route, "const points = await resolveRequestPoints(data, settings);", "the points gate");
  const docIdx = at(route, "const doc = buildRequestDoc(", "the doc builder");
  assert.ok(cardIdx < pointsIdx && pointsIdx < docIdx, "card gate < points gate < doc");
  assert.equal(count(route, /resolveRequestPoints\(/g), 1);
  assert.match(
    route,
    /if \("error" in points\) \{\s*\n?\s*await refundRateLimit\(bucket, now\);\s*\n?\s*return noStore\(failure\(points\.error, 422\)\);/,
    "a points refusal refunds the slot and answers 422 (the caller's own fact)",
  );
  assert.match(route, /OrderRequest\.create\(\{ \.\.\.doc, \.\.\.card, \.\.\.points, shortCode \}\)/, "the ask is stored, omit-empty");
  assert.ok(!WRITES.test(read(GATE)) && !/spendPoints|returnPoints/.test(route), "the route never spends points");
});

test("honeypot: the mimic runs resolveRequestPoints after the card gate and before the doc, and answers a refusal the same way", () => {
  const create = read(CREATE);
  const mimic = create.slice(at(create, "export async function buildHoneypotResponse", "the mimic"));
  assert.equal(count(mimic, /resolveRequestPoints\(data, settings\)/g), 1);
  assert.match(
    mimic,
    /if \("error" in points\) return \{ promoError: points\.error \}/,
    "a refused ask must surface as the same 422 - otherwise a filled hp is one probe from being told apart",
  );
  assert.ok(mimic.indexOf("resolveRequestCard(") < mimic.indexOf("resolveRequestPoints("), "after the card gate, as on the real path");
  assert.ok(mimic.indexOf("resolveRequestPoints(") < mimic.indexOf("buildRequestDoc("), "before the doc, as on the real path");
});

// ── accept ──────────────────────────────────────────────────────────────────

test("accept: pointsRequested is only ever COPIED from the request; nothing is spent or returned; add-round never reads the ask", () => {
  const src = read(ACCEPT);
  assert.match(src, /acceptRewardSnapshot\(rewardResolution\)/, "landmark: the create doc");
  assert.equal(count(src, /pointsRequested/g), 1, "the hint is written in exactly one place");
  assert.match(src, /\.\.\.\(request\.requestedPoints \? \{ pointsRequested: true as const \} : \{\}\),/);
  assert.ok(!/spendPoints|returnPoints|resolvePointsSpend/.test(src), "the accept never spends or returns points");
  const addround = read(ADDROUND);
  assert.match(addround, /export async function acceptAddRoundBranch/, "landmark");
  assert.ok(!/requestedPoints|pointsRequested/.test(addround), "the add-round branch must not read or write the ask");
});

// ── models and the schema ───────────────────────────────────────────────────

test("models: the ask is a stored boolean on the request and a hint (never a snapshot key) on the order", () => {
  assert.match(read(MODEL), /requestedPoints\?: true;/);
  assert.match(read(MODEL), /requestedPoints: \{ type: Boolean \}/, "the schema path must exist (strict:true drops it otherwise)");
  assert.match(read(ORDER_PATHS), /pointsRequested: \{ type: Boolean \}/);
  assert.ok(ORDER_REWARD_SNAPSHOT_KEYS.length > 0, "landmark: the snapshot key list is non-empty");
  assert.ok(!(ORDER_REWARD_SNAPSHOT_KEYS as readonly string[]).includes("pointsRequested"), "a hint is not a reprint-snapshot key");
});

test("schema: requestedPoints accepts only the literal true", () => {
  const body = { target: { kind: "parcel" as const }, items: [{ productId: "prod-1", qty: 1 }], name: "Asha", mobile: "9876543210" };
  assert.equal(createPublicOrderRequestSchema.safeParse(body).success, true, "landmark: the base body parses");
  const parsed = createPublicOrderRequestSchema.safeParse({ ...body, requestedPoints: true });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.requestedPoints, true);
  for (const bad of [false, 1, "true"]) {
    assert.equal(createPublicOrderRequestSchema.safeParse({ ...body, requestedPoints: bad }).success, false, `${JSON.stringify(bad)} is rejected`);
  }
});

// Seam pin (D1 server <-> D2 diner cart): every refusal the gate can return is one the cart treats as a REWARD error,
// so the pick is dropped and the diner can simply resend; anything else would leave a doomed ask stuck in the cart.
import { isRewardErrorMessage } from "@/components/public/public-submit";
import { POINTS_NEED_SIGN_IN, POINTS_NONE_TO_USE } from "@pos/shared/public-diner-cards";
import { PROMO_BLOCKS_REWARD, REWARD_ON_OPEN_TAB } from "@pos/shared/public-promo";
import { POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";

test("seam: every refusal the points gate can return drops the cart's pick (a closed set the client knows)", () => {
  const src = read(GATE);
  const refusals = [...src.matchAll(/return \{ error: ([A-Z_]+) \}/g)].map((m) => m[1]);
  assert.ok(refusals.length >= 5, `landmark: the gate's refusals were found, got ${refusals.length}`);
  const copy: Record<string, string> = {
    PROMO_BLOCKS_REWARD,
    POINTS_REWARD_EXCLUSIVE,
    POINTS_NEED_SIGN_IN,
    REWARD_ON_OPEN_TAB,
    POINTS_NONE_TO_USE,
  };
  for (const name of new Set(refusals)) {
    assert.ok(Object.hasOwn(copy, name), `${name} is a refusal this pin does not know — add it here AND to the client`);
    assert.equal(isRewardErrorMessage(copy[name]), true, `${name} must be a reward error the cart reverts on`);
  }
});
