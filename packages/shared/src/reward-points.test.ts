import { test } from "node:test";
import assert from "node:assert/strict";
import { LOYALTY_STAMP_ORDERS_MAX } from "./public-diner";
import { CARD_REWARD_AT } from "./reward-card-use";
import { REWARD_CARDS_KEEP, REWARD_POINTS_MAX } from "./reward-levels";
import {
  maxPointsSpend,
  pointsRedeemedReward,
  POINTS_AT_PAYMENT,
  POINTS_CHANGED,
  POINTS_EXPIRE_RULE,
  POINTS_NEED_CUSTOMER,
  POINTS_NOT_ENOUGH,
  POINTS_OVER_BILL,
  POINTS_REWARD_EXCLUSIVE,
  POINTS_SPEND_MAX,
  POINTS_SPENDS_KEEP,
} from "./reward-points";
import { ORDER_REWARD_SNAPSHOT_KEYS } from "./reward-redemption";

// CB-7 S6 SEAM-1 — the points contract: constants derive from their named sources, the spend ceiling, the snapshot.

test("constants derive from their named sources (never a second literal)", () => {
  assert.equal(POINTS_SPENDS_KEEP, LOYALTY_STAMP_ORDERS_MAX);
  assert.equal(POINTS_SPEND_MAX, REWARD_POINTS_MAX * REWARD_CARDS_KEEP);
  assert.equal(POINTS_SPEND_MAX, 600_000, "landmark: the derived ceiling");
});

test("maxPointsSpend: the smaller of balance and subtotal, whole points", () => {
  assert.equal(maxPointsSpend(50, 200), 50);
  assert.equal(maxPointsSpend(500, 120), 120);
  assert.equal(maxPointsSpend(80, 80), 80);
});

test("maxPointsSpend: fractions floor, never round up", () => {
  assert.equal(maxPointsSpend(49.9, 200), 49);
  assert.equal(maxPointsSpend(500, 119.99), 119);
  assert.equal(maxPointsSpend(0.9, 10), 0);
});

test("maxPointsSpend: zero and negatives clamp to 0", () => {
  assert.equal(maxPointsSpend(0, 100), 0);
  assert.equal(maxPointsSpend(100, 0), 0);
  assert.equal(maxPointsSpend(-5, 100), 0);
  assert.equal(maxPointsSpend(100, -5), 0);
  assert.equal(maxPointsSpend(-3, -3), 0);
});

test("pointsRedeemedReward: n points = n rupees flat off, no dish, no card id", () => {
  const r = pointsRedeemedReward(75);
  assert.deepEqual(r, { at: CARD_REWARD_AT, kind: "flat", value: 75, item: "", points: 75 });
  assert.ok(!("cardId" in r) && !("scope" in r), "not a card");
});

test("the snapshot key list carries rewardPoints (the table-move projection follows from it)", () => {
  assert.ok((ORDER_REWARD_SNAPSHOT_KEYS as string[]).includes("rewardPoints"));
});

test("copy: seven plain-English, non-empty lines, all different", () => {
  const copy = [
    POINTS_NOT_ENOUGH,
    POINTS_OVER_BILL,
    POINTS_CHANGED,
    POINTS_AT_PAYMENT,
    POINTS_NEED_CUSTOMER,
    POINTS_REWARD_EXCLUSIVE,
    POINTS_EXPIRE_RULE,
  ];
  assert.equal(new Set(copy).size, 7);
  for (const line of copy) assert.ok(line.length > 0 && line.length <= 80, line);
  assert.equal(POINTS_CHANGED, "Your points changed — try again");
});
