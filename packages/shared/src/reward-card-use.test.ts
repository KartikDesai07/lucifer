import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_REWARD_AT,
  REWARD_CARD_USE_KINDS,
  STAFF_REWARD_CARD_KEYS,
  cardMinBillMet,
  cardRedeemedReward,
  cardUsableAt,
  staffCardReward,
  type CardForReward,
  type StaffRewardCard,
} from "./reward-card-use";
import { REWARD_OPTION_KINDS, REWARD_PRODUCT_PERCENT_UNITS, type RewardCardSnapshot, type RewardOptionKind } from "./reward-levels";
import { ORDER_REWARD_SNAPSHOT_KEYS } from "./reward-redemption";

// CB-7 S5 SEAM — the shared card-use contract (green unit tests; the money bugs are pinned elsewhere).

const NOW = new Date("2026-10-12T10:00:00.000Z");
const DEADLINE = new Date("2026-10-20T10:00:00.000Z");
const CARD_ID = "a1b2c3d4e5f6";
const PRODUCT_ID = "60a1b2c3d4e5f60718293a4b";
const CATEGORY_IDS = ["60a1b2c3d4e5f60718293a4b", "60a1b2c3d4e5f60718293a4c"];

type UsableCard = Pick<RewardCardSnapshot, "status" | "scratchBy" | "validUntil" | "kind">;
const card = (over: Partial<UsableCard> = {}): UsableCard => ({
  status: "revealed",
  scratchBy: new Date("2026-10-01T00:00:00.000Z"),
  validUntil: DEADLINE,
  kind: "bill-percent",
  ...over,
});
const forReward = (over: Partial<CardForReward> & { kind: RewardOptionKind }): CardForReward => ({
  id: CARD_ID,
  value: 10,
  ...over,
});

// ── REWARD_CARD_USE_KINDS ───────────────────────────────────────────────────────────────────────────────────────

test("REWARD_CARD_USE_KINDS: the six money kinds, never points or none, every member a real option kind", () => {
  assert.deepEqual(
    [...REWARD_CARD_USE_KINDS],
    ["bill-percent", "bill-flat", "product-percent", "category-percent", "category-flat", "free-item"],
    "landmark: the allowlist is the six money kinds",
  );
  const kinds: readonly string[] = REWARD_CARD_USE_KINDS;
  assert.ok(!kinds.includes("points"), "points lots are spent through the points path, never claimed as a card");
  assert.ok(!kinds.includes("none"), "a none card is already used at reveal");
  const optionKinds: readonly string[] = REWARD_OPTION_KINDS;
  for (const kind of REWARD_CARD_USE_KINDS) assert.ok(optionKinds.includes(kind), `${kind} must be a REWARD_OPTION_KIND`);
  assert.equal(new Set(REWARD_CARD_USE_KINDS).size, REWARD_CARD_USE_KINDS.length, "no duplicates");
});

// ── cardUsableAt ────────────────────────────────────────────────────────────────────────────────────────────────

test("cardUsableAt: revealed + money kind + before the deadline is usable", () => {
  assert.equal(cardUsableAt(card(), NOW), true);
  for (const kind of REWARD_CARD_USE_KINDS) assert.equal(cardUsableAt(card({ kind }), NOW), true, `${kind} is usable`);
});

test("cardUsableAt: the deadline instant is INCLUSIVE and +1 ms is expired", () => {
  assert.equal(cardUsableAt(card(), DEADLINE), true, "the deadline instant itself still counts (strict > expiry)");
  assert.equal(cardUsableAt(card(), new Date(DEADLINE.getTime() + 1)), false, "one millisecond later is expired");
  assert.equal(cardUsableAt(card(), new Date(DEADLINE.getTime() - 1)), true, "one millisecond before is usable");
});

test("cardUsableAt: ready, used and expired-by-clock cards are not usable", () => {
  assert.equal(cardUsableAt(card({ status: "ready", validUntil: undefined }), NOW), false, "a ready card is not scratched yet");
  assert.equal(cardUsableAt(card({ status: "used" }), NOW), false, "a used card is spent");
  assert.equal(cardUsableAt(card({ validUntil: new Date(NOW.getTime() - 1) }), NOW), false, "past its use-by");
  assert.equal(cardUsableAt(card({ validUntil: undefined }), NOW), false, "a revealed card with no use-by is treated as expired");
});

test("cardUsableAt: points and none kinds are never usable even when revealed and in date", () => {
  assert.equal(cardUsableAt(card({ kind: "points" }), NOW), false);
  assert.equal(cardUsableAt(card({ kind: "none" }), NOW), false);
});

// ── cardMinBillMet ──────────────────────────────────────────────────────────────────────────────────────────────

test("cardMinBillMet: absent minBill always passes; equal passes; below fails", () => {
  assert.equal(cardMinBillMet({}, 0), true, "no minimum, empty bill");
  assert.equal(cardMinBillMet({ minBill: undefined }, 1), true);
  assert.equal(cardMinBillMet({ minBill: 300 }, 300), true, "equal to the minimum counts");
  assert.equal(cardMinBillMet({ minBill: 300 }, 301), true);
  assert.equal(cardMinBillMet({ minBill: 300 }, 299), false, "below the minimum is refused");
});

// ── cardRedeemedReward ──────────────────────────────────────────────────────────────────────────────────────────

test("cardRedeemedReward: bill-percent and bill-flat are unscoped, uncapped, at CARD_REWARD_AT, carrying the card id", () => {
  assert.deepEqual(cardRedeemedReward(forReward({ kind: "bill-percent", value: 15 })), {
    at: CARD_REWARD_AT, kind: "percent", value: 15, item: "", cardId: CARD_ID,
  });
  assert.deepEqual(cardRedeemedReward(forReward({ kind: "bill-flat", value: 75 })), {
    at: CARD_REWARD_AT, kind: "flat", value: 75, item: "", cardId: CARD_ID,
  });
  assert.equal(CARD_REWARD_AT, 0, "landmark: the sentinel is 0 and never stored");
});

test("cardRedeemedReward: product-percent scopes to [productId] with maxUnits = REWARD_PRODUCT_PERCENT_UNITS, label, cap only when set", () => {
  const withCap = cardRedeemedReward(
    forReward({ kind: "product-percent", value: 20, productId: PRODUCT_ID, productName: "Cold Coffee", capRupees: 80 }),
  );
  assert.deepEqual(withCap, {
    at: CARD_REWARD_AT,
    kind: "percent",
    value: 20,
    item: "",
    cardId: CARD_ID,
    scope: { productIds: [PRODUCT_ID], maxUnits: REWARD_PRODUCT_PERCENT_UNITS, label: "Cold Coffee" },
    capRupees: 80,
  });
  const noCap = cardRedeemedReward(forReward({ kind: "product-percent", value: 20, productId: PRODUCT_ID, productName: "Cold Coffee" }));
  assert.ok(noCap, "uncapped product card resolves");
  assert.ok(!("capRupees" in noCap), "capRupees is absent (not undefined) when the card has none");
  assert.equal(cardRedeemedReward(forReward({ kind: "product-percent", value: 20 })), null, "no productId: fails closed");
});

test("cardRedeemedReward: category kinds need the ids argument (null without); percent carries the cap, flat never does", () => {
  const percent = cardRedeemedReward(
    forReward({ kind: "category-percent", value: 10, categoryName: "Beverages", capRupees: 60 }),
    CATEGORY_IDS,
  );
  assert.deepEqual(percent, {
    at: CARD_REWARD_AT,
    kind: "percent",
    value: 10,
    item: "",
    cardId: CARD_ID,
    scope: { productIds: CATEGORY_IDS, label: "Beverages" },
    capRupees: 60,
  });
  assert.ok(!("maxUnits" in percent!.scope!), "a category scope has no unit cap");
  assert.notEqual(percent!.scope!.productIds, CATEGORY_IDS, "the ids are copied, never aliased to the caller's array");

  const flat = cardRedeemedReward(
    forReward({ kind: "category-flat", value: 50, categoryName: "Beverages", capRupees: 60 }),
    CATEGORY_IDS,
  );
  assert.deepEqual(flat, {
    at: CARD_REWARD_AT,
    kind: "flat",
    value: 50,
    item: "",
    cardId: CARD_ID,
    scope: { productIds: CATEGORY_IDS, label: "Beverages" },
  });
  assert.ok(!("capRupees" in flat!), "category-flat never carries capRupees, even if the row has one");

  assert.equal(cardRedeemedReward(forReward({ kind: "category-percent", value: 10 })), null, "no ids: fails closed");
  assert.equal(cardRedeemedReward(forReward({ kind: "category-flat", value: 50 })), null, "no ids: fails closed");
});

test("cardRedeemedReward: free-item is kind item, value 0, the dish ref and qty (default 1)", () => {
  assert.deepEqual(
    cardRedeemedReward(forReward({ kind: "free-item", value: 0, productId: PRODUCT_ID, productName: "Masala Chai", qty: 2 })),
    { at: CARD_REWARD_AT, kind: "item", value: 0, item: "Masala Chai", cardId: CARD_ID, itemProductId: PRODUCT_ID, qty: 2 },
  );
  const defaulted = cardRedeemedReward(forReward({ kind: "free-item", value: 0, productId: PRODUCT_ID, productName: "Masala Chai" }));
  assert.equal(defaulted?.qty, 1, "an absent qty is one dish");
  assert.equal(cardRedeemedReward(forReward({ kind: "free-item", value: 0 })), null, "no productId: fails closed");
  const stray = cardRedeemedReward(forReward({ kind: "free-item", value: 40, productId: PRODUCT_ID }));
  assert.equal(stray?.value, 0, "a free dish is never rupees off, whatever value the row carries");
});

test("cardRedeemedReward: points and none are not spendable as a card (null)", () => {
  assert.equal(cardRedeemedReward(forReward({ kind: "points", value: 100 })), null);
  assert.equal(cardRedeemedReward(forReward({ kind: "none", value: 0 })), null);
  assert.equal(cardRedeemedReward(forReward({ kind: "points", value: 100 }), CATEGORY_IDS), null, "ids do not rescue a non-use kind");
});

test("cardRedeemedReward: every usable kind carries the card id and at = CARD_REWARD_AT", () => {
  for (const kind of REWARD_CARD_USE_KINDS) {
    const reward = cardRedeemedReward(forReward({ kind, value: 10, productId: PRODUCT_ID }), CATEGORY_IDS);
    assert.ok(reward, `${kind} must resolve with a product ref and category ids`);
    assert.equal(reward.cardId, CARD_ID, `${kind} carries the card id`);
    assert.equal(reward.at, CARD_REWARD_AT, `${kind} never takes a rung's stamp cost`);
  }
});

// ── StaffRewardCard allowlist ───────────────────────────────────────────────────────────────────────────────────

// Independent compile-time mirror of the interface: a key added to / removed from StaffRewardCard fails tsc HERE
// as well as in the module, so the staff payload allowlist can never drift silently.
const EXPECTED_STAFF_KEYS: Readonly<Record<keyof StaffRewardCard, true>> = {
  id: true,
  kind: true,
  value: true,
  label: true,
  condition: true,
  validUntil: true,
  minBill: true,
  capRupees: true,
  productId: true,
  productName: true,
  qty: true,
  categoryName: true,
  scopeProductIds: true,
};

test("STAFF_REWARD_CARD_KEYS: equals the interface keys exactly and leaks none of the private card fields", () => {
  assert.deepEqual([...STAFF_REWARD_CARD_KEYS].sort(), Object.keys(EXPECTED_STAFF_KEYS).sort());
  assert.equal(new Set(STAFF_REWARD_CARD_KEYS).size, STAFF_REWARD_CARD_KEYS.length, "no duplicates");
  assert.ok(STAFF_REWARD_CARD_KEYS.includes("id") && STAFF_REWARD_CARD_KEYS.includes("validUntil"), "landmark: the list is not empty");
  const keys: readonly string[] = STAFF_REWARD_CARD_KEYS;
  for (const banned of ["pool", "optionId", "issueKey", "usedAt", "orderId", "weight"]) {
    assert.ok(!keys.includes(banned), `the staff payload must never carry ${banned}`);
  }
});

test("staffCardReward: is cardRedeemedReward(card, card.scopeProductIds) for every usable kind", () => {
  for (const kind of REWARD_CARD_USE_KINDS) {
    const dto: StaffRewardCard = {
      id: CARD_ID,
      kind,
      value: 10,
      label: "x",
      condition: null,
      validUntil: DEADLINE.getTime(),
      productId: PRODUCT_ID,
      productName: "Cold Coffee",
      categoryName: "Beverages",
      capRupees: 40,
      qty: 2,
      scopeProductIds: CATEGORY_IDS,
    };
    assert.deepEqual(staffCardReward(dto), cardRedeemedReward(dto, dto.scopeProductIds), `${kind} agrees`);
    assert.ok(staffCardReward(dto), `${kind} resolves (landmark: not comparing null to null)`);
  }
  const noIds: StaffRewardCard = { id: CARD_ID, kind: "category-flat", value: 50, label: "x", condition: null, validUntil: 1 };
  assert.equal(staffCardReward(noIds), null, "a category card with no ids previews as nothing, same as the server");
});

// ── ORDER_REWARD_SNAPSHOT_KEYS (shared/reward-redemption) ───────────────────────────────────────────────────────

test("ORDER_REWARD_SNAPSHOT_KEYS: the eleven snapshot keys, no duplicates", () => {
  assert.deepEqual([...ORDER_REWARD_SNAPSHOT_KEYS].sort(), [
    "rewardAt",
    "rewardCapRupees",
    "rewardCardId",
    "rewardItem",
    "rewardItemProductId",
    "rewardKind",
    "rewardQty",
    "rewardScopeLabel",
    "rewardScopeMaxUnits",
    "rewardScopeProductIds",
    "rewardValue",
  ]);
  assert.equal(ORDER_REWARD_SNAPSHOT_KEYS.length, 11);
});
