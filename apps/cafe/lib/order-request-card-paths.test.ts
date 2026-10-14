import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { REWARD_PROMO_CONFLICT_ERROR } from "@/lib/order-request-addround-kind";
import {
  REWARD_UNFUNDED_ERROR,
  acceptOrderItems,
  acceptRewardSnapshot,
  resolveAcceptReward,
  type CardAcceptResolution,
  type StampAcceptResolution,
} from "@/lib/order-request-accept-reward";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// CB-7 S5 slice D — the diner QR path of a scratch card: submit gate -> stored INTENT -> accept claim, plus the P2 promo
// marker on both accept branches. Source pins (the files are Mongoose / cookie bound) plus the pure parts as
// behaviour. Pin discipline: every absence is paired with a positive landmark; orderings carry an occurrence COUNT.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => stripComments(readFileSync(path.join(HERE, "..", rel), "utf8"));

const CARD_GATE = "lib/order-request-card.ts";
const ROUTE = "app/api/public/order-request/route.ts";
const CREATE = "lib/order-request-create.ts";
const ACCEPT = "lib/order-request-accept.ts";
const ACCEPT_REWARD = "lib/order-request-accept-reward.ts";
const ADDROUND = "lib/order-request-accept-addround.ts";
const INTAKE = "lib/order-request-intake.ts";
const MODEL = "models/OrderRequest.ts";

function at(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}
const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

const MARKER_CALL =
  "...promoMarkerFields(promoIsClaimable(promo.discount, request.promoCode, promo.kind) ? request.promoCode : undefined)";

// ── submit ──────────────────────────────────────────────────────────────────

test("submit: resolveRequestCard's gates run in the stated order, each once", () => {
  const src = read(CARD_GATE);
  assert.match(src, /export async function resolveRequestCard/, "landmark");
  const order = [
    ["if (cardId === undefined) return {};", "nothing asked"],
    ["if (data.promoCode) return { error: PROMO_BLOCKS_REWARD };", "promo first"],
    ["if (data.requestedRewardAt !== undefined) return { error: CARD_REWARD_EXCLUSIVE };", "stamp rung also asked"],
    ["await readDinerSession()", "session read"],
    ["canonicalPromoMobile(data.mobile) !== canonicalPromoMobile(session.mobile)", "canonical mobile compare"],
    ["await hasOpenTabNow(table.tableNo)", "open tab"],
    ["await resolveCardClaim({", "the read-only claim resolution"],
  ] as const;
  let prev = -1;
  for (const [needle, label] of order) {
    const idx = at(src, needle, label);
    assert.ok(idx > prev, `gate "${label}" is out of order`);
    assert.equal(src.split(needle).length - 1, 1, `gate "${label}" must appear exactly once`);
    prev = idx;
  }
  // The session gate and the mobile gate answer the SAME copy; the open-tab gate the stamp path's own constant.
  assert.equal(count(src, /error: CARD_NEEDS_SIGN_IN/g), 2, "no session + mobile mismatch both refuse with sign-in copy");
  assert.match(src, /return \{ error: REWARD_ON_OPEN_TAB \}/, "an open tab is refused at submit");
  // Identity is the SESSION's customer, never anything the body typed; the quote is the pre-reward bill.
  assert.match(src, /customerId: session\.customerId,/);
  assert.match(src, /billTotal: quotedTotal,/);
  assert.match(src, /items: lines,/, "scope is judged against the request's own lines");
  assert.match(src, /refuseItemKind: false,/, "a free-dish card IS allowed while an order is being taken");
  // Success stores the intent only.
  assert.match(src, /return \{ requestedCardId: cardId \};/);
});

test("submit: the refusal copy is a closed set the diner client reverts on — nothing staff-facing leaks", () => {
  const src = read(CARD_GATE);
  assert.match(src, /DINER_CARD_REFUSALS\.has\(resolved\.message\) \? resolved\.message : CARD_NOT_USABLE/);
  const pins = read("components/public/public-submit.ts");
  for (const name of ["CARD_NOT_USABLE", "CARD_BILL_TOO_SMALL", "CARD_NOTHING_TO_DISCOUNT", "CARD_CATEGORY_TOO_BIG"]) {
    assert.ok(new RegExp(`message === ${name}`).test(pins), `${name} must be a copy string the client reverts on`);
    assert.ok(new RegExp(`\\b${name}\\b`).test(src), `${name} must be in the gate's closed set`);
  }
});

test("submit: the route and the honeypot BOTH run resolveRequestCard, and answer a refusal the same way", () => {
  const route = read(ROUTE);
  const rewardIdx = at(route, "const reward = await resolveRequestReward(", "the stamp gate");
  const cardIdx = at(route, "const card = await resolveRequestCard(data, settings, rewardQuote.quotedTotal, priced.lines);", "the card gate");
  const docIdx = at(route, "const doc = buildRequestDoc(", "the doc builder");
  assert.ok(rewardIdx < cardIdx && cardIdx < docIdx, "card gate sits after the stamp gate and BEFORE the doc is built");
  assert.equal(count(route, /resolveRequestCard\(/g), 1);
  assert.match(
    route,
    /if \("error" in card\) \{\s*\n?\s*await refundRateLimit\(bucket, now\);\s*\n?\s*return noStore\(failure\(card\.error, 422\)\);/,
    "a card refusal refunds the slot and answers 422 (the caller's own fact, not an oracle)",
  );
  assert.match(route, /OrderRequest\.create\(\{ \.\.\.doc, \.\.\.card, \.\.\.points, shortCode \}\)/, "the intent is stored, omit-empty");

  const create = read(CREATE);
  const mimic = create.slice(at(create, "export async function buildHoneypotResponse", "the mimic"));
  assert.match(mimic, /resolveRequestCard\(data, settings, rewardQuote\.quotedTotal, priced\.lines\)/);
  assert.match(
    mimic,
    /if \("error" in card\) return \{ promoError: card\.error \}/,
    "a rejected card must surface as the same 422 — otherwise a filled hp is one probe from being told apart",
  );
  assert.ok(mimic.indexOf("resolveRequestReward(") < mimic.indexOf("resolveRequestCard("), "same order as the real path");
  assert.ok(mimic.indexOf("resolveRequestCard(") < mimic.indexOf("buildRequestDoc("), "before the doc, as on the real path");
});

test("submit: NOTHING is claimed, released or written by the submit path", () => {
  const gate = read(CARD_GATE);
  assert.match(gate, /resolveCardClaim\(/, "landmark: the gate does resolve");
  assert.ok(
    !/claimRewardCard|releaseRewardCard|updateOne|findOneAndUpdate|findByIdAndUpdate|\$set|\.create\(|\.save\(/.test(gate),
    "the submit gate must never WRITE — a request is pre-money and a rejected one must cost no card",
  );
  const route = read(ROUTE);
  const create = read(CREATE);
  for (const src of [route, create]) {
    assert.ok(!/claimRewardCard|releaseRewardCard/.test(src), "neither the route nor the honeypot may touch the claim");
  }
});

test("submit: the intent is stored as a bare id, never an amount, and never enters the quote", () => {
  const model = read(MODEL);
  assert.match(model, /requestedCardId\?: string;/);
  assert.match(model, /requestedCardId: \{ type: String \}/, "the schema path must exist (strict:true drops it otherwise)");
  const intake = read(INTAKE);
  assert.ok(!/requestedCardId/.test(intake), "the draft builder is untouched: the route spreads the intent itself");
});

// ── accept: create / parcel branch ──────────────────────────────────────────

test("accept: the card is resolved from the request's intent and the accepted lines, claimed keyed on the landing orderId", () => {
  const src = read(ACCEPT);
  assert.match(
    src,
    /resolveAcceptReward\(\s*\{ rewardAt: request\.requestedRewardAt, cardId: request\.requestedCardId, promoCode: request\.promoCode \},/,
    "the call site passes both intents and the request's promo",
  );
  assert.match(
    src,
    /discountKind: undefined, charge: tableResolved\.charge\.amount, cfg: gstCfg,\s*\}\)\.total,\s*items,\s*\);/,
    "the pre-reward total, then the accepted lines",
  );
  // CLAIM keyed on the id that lands, the result CHECKED, before the write; the re-key moves it with the number.
  const claimIdx = at(src, "!(await claimAcceptReward(rewardResolution, firstOrderId))", "the checked claim");
  const createIdx = at(src, "Order.create({ ...doc, orderId: firstOrderId })", "the create");
  assert.ok(claimIdx < createIdx, "the card is claimed BEFORE the order is written");
  assert.match(src, /return guardedReject\(requestId, ctx\.actor, REWARD_UNFUNDED_ERROR\)/, "a miss after it resolved rejects");
  assert.match(src, /return claimAcceptReward\(rewardResolution, retryOrderId\)/, "re-claimed on the RE-NUMBERED id");
  assert.equal(count(src, /claimAcceptReward\(/g), 2);
  // A free-item card's dish joins the bill the way a stamp item's does.
  assert.match(src, /const orderItems = acceptOrderItems\(items, rewardResolution\);/);
});

test("accept: the claim and the release of a card are the reward-lib's, keyed on the orderId they are handed", () => {
  const src = read(ACCEPT_REWARD);
  assert.match(
    src,
    /if \(resolution\.kind === "card"\) return claimRewardCard\(resolution\.customerId, resolution\.cardId, orderId, new Date\(\)\);/,
    "the CAS result is RETURNED, so the caller's `!(await ...)` check sees a miss",
  );
  assert.equal(count(src, /claimRewardCard\(/g), 1);
  assert.equal(count(src, /releaseRewardCard\(resolution\.customerId, resolution\.cardId, orderId\)/g), 1);
  assert.equal(count(src, /releaseRewardCard\(/g), 1, "the one release call is the one in returnAcceptReward");
  // The resolve step never writes.
  const resolveFn = src.slice(at(src, "async function resolveAcceptCard", "resolveAcceptCard"), at(src, "export async function claimAcceptReward", "claimAcceptReward"));
  assert.ok(!/claimRewardCard|releaseRewardCard|updateOne|\$set/.test(resolveFn), "resolution is read-only");
  assert.match(resolveFn, /refuseItemKind: false,/);
  assert.match(resolveFn, /kotRound: 1,/);
  assert.match(resolveFn, /if \(!resolved\.ok\) return undefined;/, "an unresolvable card leaves the order at FULL price");
});

test("accept: a card is released only on a DEFINITE no-write, keyed on the id the claim CURRENTLY sits on", () => {
  const src = read(ACCEPT);
  // Exactly three points, no fourth: onRekey (a server-proved dup-key), the replay arm (the insert lost on the unique
  // sourceRequestIds - another accept's order holds the request) and the ambiguous-throw arm that releases only after
  // findByRequestId found no order, or one under a DIFFERENT id.
  assert.equal(count(src, /returnAcceptReward\(/g), 3);
  assert.match(src, /let claimedFor = firstOrderId;/, "the claim's current id is tracked");
  assert.match(
    src,
    /if \(!landed \|\| landed\.orderId !== claimedFor\) await returnAcceptReward\(rewardResolution, claimedFor\)/,
    "the fatal arm releases the CURRENT id unless an order under that very id landed",
  );
  assert.match(
    src,
    /await returnAcceptReward\(rewardResolution, claimedFor\);\s*\n?\s*claimedFor = retryOrderId;\s*\n?\s*return claimAcceptReward\(rewardResolution, retryOrderId\)/,
    "the re-key hands back the current claim, tracks the retry id, then re-claims on it",
  );
  assert.match(
    src,
    /if \(rewardResolution && recovered\.order\.orderId !== claimedFor\) \{\s*\n?\s*await returnAcceptReward\(rewardResolution, claimedFor\)\.catch\(\(\) => undefined\);/,
    "the replay arm hands the claim back, best-effort (a failed release never masks the replay answer)",
  );
  assert.ok(!/returnAcceptReward\(rewardResolution, firstOrderId\)/.test(src), "no release is keyed on the first id any more");
  assert.ok(!/releaseRewardCard/.test(src), "the bridge never releases a card directly");
  assert.ok(!/releaseRewardCard/.test(read(ADDROUND)), "the add-round branch never releases a card");
});

test("accept: the card branch never writes rewardAt or rewardStamps", () => {
  const src = read(ACCEPT_REWARD);
  const snapshot = src.slice(at(src, "export function acceptRewardSnapshot", "acceptRewardSnapshot"));
  assert.match(snapshot, /cardSnapshotFields\(resolution\.reward\)/);
  const cardFns =
    src.slice(at(src, "async function resolveAcceptCard", "resolveAcceptCard"), at(src, "export async function claimAcceptReward", "claim")) +
    snapshot.slice(0, snapshot.indexOf(": rewardSnapshotFields"));
  assert.ok(!/rewardAt|rewardStamps|rewardSnapshotFields/.test(cardFns), "a card order stores both ABSENT");
});

test("accept: a card alongside a stamp rung or a promo resolves to nothing, spends nothing (fail closed)", async () => {
  const items = [{ productId: "a".repeat(24) }];
  // No DB is reachable here: both refusals return BEFORE any read.
  assert.equal(await resolveAcceptReward({ cardId: "a".repeat(12), rewardAt: 5 }, "c1", null, 100, items), undefined);
  assert.equal(await resolveAcceptReward({ cardId: "a".repeat(12), promoCode: "WELCOME" }, "c1", null, 100, items), undefined);
  // No customer / accounts off: the card does not resolve, the order lands at full price.
  assert.equal(await resolveAcceptReward({ cardId: "a".repeat(12) }, undefined, null, 100, items), undefined);
  assert.equal(await resolveAcceptReward({ cardId: "a".repeat(12) }, "c1", null, 100, items), undefined);
  // And nothing asked is nothing.
  assert.equal(await resolveAcceptReward({}, "c1", null, 100, items), undefined);
});

const REWARD: RedeemedReward = {
  at: 0,
  kind: "flat",
  value: 50,
  item: "",
  cardId: "b".repeat(12),
  scope: { productIds: ["p1"], maxUnits: 1, label: "Latte" },
  capRupees: 80,
};

test("accept: the card snapshot carries the card id and scope, never the stamp rung fields", () => {
  const card: CardAcceptResolution = { kind: "card", cardId: "b".repeat(12), reward: REWARD, customerId: "c1" };
  const snap = acceptRewardSnapshot(card);
  assert.equal(snap.rewardCardId, "b".repeat(12));
  assert.equal(snap.rewardKind, "flat");
  assert.deepEqual(snap.rewardScopeProductIds, ["p1"]);
  assert.equal(snap.rewardCapRupees, 80);
  assert.ok(!("rewardAt" in snap) && !("rewardStamps" in snap), "never rewardAt / rewardStamps");
  const stamp: StampAcceptResolution = { kind: "stamp", cost: 10, reward: { ...REWARD, at: 10 }, customerId: "c1" };
  const stampSnap = acceptRewardSnapshot(stamp);
  assert.equal(stampSnap.rewardAt, 10);
  assert.equal(stampSnap.rewardStamps, 10);
  assert.ok(!("rewardCardId" in stampSnap));
  assert.deepEqual(acceptRewardSnapshot(undefined), {});
});

test("accept: a free-item card's dish line is spliced in like a stamp item's", () => {
  const base = [{ productId: "p1", name: "Latte" }];
  assert.equal(acceptOrderItems(base, undefined), base);
  const line = { productId: "p9", name: "Cookie", price: 40, qty: 1, kotRound: 1, reward: true } as never;
  const withLine = acceptOrderItems(base, { kind: "card", cardId: "b".repeat(12), reward: REWARD, customerId: "c1", line });
  assert.equal(withLine.length, 2);
  assert.equal(String(withLine[1]?.productId), "p9");
});

// ── P2 marker + add-round ───────────────────────────────────────────────────

test("P2: the promo marker is written on BOTH accept branches, through promoMarkerFields, keyed on promoIsClaimable", () => {
  const accept = read(ACCEPT);
  assert.equal(count(accept, /\.\.\.promoMarkerFields\(/g), 1);
  assert.ok(accept.includes(MARKER_CALL), "create branch: the marker rides the create doc");
  const docStart = at(accept, "const doc = {", "the create doc");
  assert.ok(accept.indexOf(MARKER_CALL) > docStart, "the marker sits INSIDE the create doc");

  const addround = read(ADDROUND);
  assert.equal(count(addround, /\.\.\.promoMarkerFields\(/g), 1);
  const setStart = at(addround, "$set: {", "the add-round $set");
  const setEnd = at(addround, "$addToSet: { sourceRequestIds: requestId }", "the $addToSet");
  const markerIdx = at(addround, MARKER_CALL, "add-round marker");
  assert.ok(markerIdx > setStart && markerIdx < setEnd, "add-round: the marker is a field of the $set (FLAG 8)");
});

test("P2: no accept writer $unsets the promo marker", () => {
  for (const rel of [ACCEPT, ADDROUND]) {
    const src = read(rel);
    assert.ok(!/unset\.promoCode|promoCode:\s*""/.test(src), `${rel} must never remove the marker`);
  }
  assert.match(read(ADDROUND), /const unset: Record<string, ""> =/, "landmark: the $unset builder exists and is checked");
});

test("add-round: NEVER reads the card intent and never claims or resolves one (a card is create-only)", () => {
  const src = read(ADDROUND);
  assert.match(src, /export async function acceptAddRoundBranch/, "landmark");
  assert.ok(!/requestedCardId/.test(src), "the add-round branch must not read requestedCardId");
  assert.ok(!/resolveAcceptReward|claimAcceptReward|claimRewardCard|resolveCardClaim|requestedRewardAt/.test(src));
  // The only card awareness: a card TAB re-prices from its stored snapshot (one rebuild, the P3 card arm), and the
  // typed tab carries the card fields that rebuild reads.
  assert.match(src, /rewardFromOrderSnapshot\(openTab\)/);
  assert.match(src, /\| "rewardCardId"/);
  // And the submit gate is what tells the diner (a request onto a running tab is refused there).
  assert.match(read(CARD_GATE), /hasOpenTabNow\(/);
});

test("accept: the two refusal messages staff read are reward-neutral (a card refusal never says stamps), yet stay actionable", () => {
  // Both are reachable for a SCRATCH CARD as well as a stamp rung (the accept's unfunded claim; the add-round's promo-vs-reward conflict).
  assert.ok(REWARD_UNFUNDED_ERROR.length > 0 && REWARD_PROMO_CONFLICT_ERROR.length > 0, "landmark: both messages exist");
  for (const message of [REWARD_UNFUNDED_ERROR, REWARD_PROMO_CONFLICT_ERROR]) {
    assert.ok(!/stamp/i.test(message), `no stamp wording in: ${message}`);
    assert.match(message, /reject this request and ask the customer to order again/, "the staff instruction stays");
  }
  assert.match(REWARD_UNFUNDED_ERROR, /reward was already used/);
  assert.match(REWARD_PROMO_CONFLICT_ERROR, /already has a reward applied/);
});
