import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redemptionSnapshotOf,
  rewardFromOrderSnapshot,
  REWARD_REDEEMABLE_KINDS,
  isRedeemableRewardKind,
  shouldStoreDiscountKind,
  type RedeemedReward,
} from "./reward-redemption";
import { LOYALTY_REWARD_KINDS } from "./public-diner";
import type { ResolvedMilestone } from "./loyalty-rules";

// ── redemptionSnapshotOf — build the snapshot from a resolved milestone,
// dropping minBill (a GATE, never a money input) ────────────────────────────

test("redemptionSnapshotOf: carries at/kind/value/item across, DROPPING minBill", () => {
  const milestone: ResolvedMilestone = {
    at: 8,
    kind: "flat",
    value: 100,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: 200,
    promoCode: null,
    claimWithinDays: null,
  };
  const snapshot = redemptionSnapshotOf(milestone);
  assert.deepEqual(snapshot, { at: 8, kind: "flat", value: 100, item: "" });
  assert.ok(!("minBill" in snapshot), "minBill is a route-side gate, never a money input on the snapshot");
});

test("redemptionSnapshotOf: an 'item' milestone still snapshots faithfully (the redeemability gate lives elsewhere)", () => {
  const milestone: ResolvedMilestone = {
    at: 5,
    kind: "item",
    value: 0,
    item: "Cold Coffee",
    itemProductId: "60a1b2c3d4e5f60718293a4b",
    qty: 2,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
  assert.deepEqual(redemptionSnapshotOf(milestone), {
    at: 5,
    kind: "item",
    value: 0,
    item: "Cold Coffee",
    itemProductId: "60a1b2c3d4e5f60718293a4b",
    qty: 2,
  });
});

// ── rewardFromOrderSnapshot — rebuild from the five Order fields ────────────

test("rewardFromOrderSnapshot: rebuilds a RedeemedReward when all three required fields are present", () => {
  const rebuilt = rewardFromOrderSnapshot({
    rewardAt: 8,
    rewardKind: "percent",
    rewardValue: 10,
    rewardItem: "",
  });
  assert.deepEqual(rebuilt, { at: 8, kind: "percent", value: 10, item: "" });
});

test("rewardFromOrderSnapshot: rewardItem defaults to '' when the order carries no rewardItem key", () => {
  const rebuilt = rewardFromOrderSnapshot({ rewardAt: 8, rewardKind: "flat", rewardValue: 100 });
  assert.equal(rebuilt?.item, "");
});

test("rewardFromOrderSnapshot: returns undefined when the order carries no reward at all", () => {
  assert.equal(rewardFromOrderSnapshot({}), undefined);
});

test("rewardFromOrderSnapshot: returns undefined when only SOME of the required fields are present", () => {
  assert.equal(rewardFromOrderSnapshot({ rewardAt: 8 }), undefined);
  assert.equal(rewardFromOrderSnapshot({ rewardAt: 8, rewardKind: "flat" }), undefined);
});

// ── REWARD_REDEEMABLE_KINDS / isRedeemableRewardKind — D5 REVERSED
// 2026-09-13: the owner reversed D5/A1, so `kind:"item"` IS now redeemable
// through this path (a free dish becomes a priced-but-untotalled bill line,
// CB-5B S12) — ALL THREE kinds redeem, still derived FROM
// LOYALTY_REWARD_KINDS (never re-typed as separate string literals) so the
// two enums cannot silently drift apart. `isRedeemableRewardKind` is kept
// (CB-7 needs a NARROWER redeemability axis again for product/category-
// scoped rewards) ─────────────────────────────────────────────────────────

test("REWARD_REDEEMABLE_KINDS: contains all three kinds, INCLUDING item (D5 REVERSED 2026-09-13)", () => {
  assert.deepEqual([...REWARD_REDEEMABLE_KINDS].sort(), ["flat", "item", "percent"]);
  assert.ok(REWARD_REDEEMABLE_KINDS.includes("item"), "item must be redeemable through this route after the D5 reversal");
});

test("REWARD_REDEEMABLE_KINDS: is derived FROM LOYALTY_REWARD_KINDS exactly (all kinds, no filtering)", () => {
  assert.deepEqual([...REWARD_REDEEMABLE_KINDS].sort(), [...LOYALTY_REWARD_KINDS].sort());
});

test("isRedeemableRewardKind: true for flat/percent/item (D5 REVERSED — item is no longer excluded)", () => {
  assert.equal(isRedeemableRewardKind("flat"), true);
  assert.equal(isRedeemableRewardKind("percent"), true);
  assert.equal(isRedeemableRewardKind("item"), true);
});

test("a redeemable-kind reward round-trips through snapshot -> order fields -> rebuilt, unchanged", () => {
  const milestone: ResolvedMilestone = {
    at: 12,
    kind: "flat",
    value: 50,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
  const snapshot: RedeemedReward = redemptionSnapshotOf(milestone);
  const rebuilt = rewardFromOrderSnapshot({
    rewardAt: snapshot.at,
    rewardKind: snapshot.kind,
    rewardValue: snapshot.value,
    rewardItem: snapshot.item,
  });
  assert.deepEqual(rebuilt, snapshot);
});

// ── P-NEW-13 — shouldStoreDiscountKind: the ONE documented exception to the
// repo-wide "amount gates the kind" rule (codec.ts). "reward" always stores
// regardless of amount (an item reward's amount is 0 by construction); every
// other kind keeps the amount-gates-kind rule verbatim ──────────────────────

test("shouldStoreDiscountKind: 'reward' at amount 0 still stores (the D5-reversal exception)", () => {
  assert.equal(shouldStoreDiscountKind(0, "reward"), true);
});

test("shouldStoreDiscountKind: 'gst' at amount 0 does NOT store (amount gates the kind, unchanged)", () => {
  assert.equal(shouldStoreDiscountKind(0, "gst"), false);
});

test("shouldStoreDiscountKind: amount 0 with no kind at all does NOT store", () => {
  assert.equal(shouldStoreDiscountKind(0, undefined), false);
});

test("shouldStoreDiscountKind: 'gst' at a positive amount stores (the ordinary case)", () => {
  assert.equal(shouldStoreDiscountKind(100, "gst"), true);
});

// ── CB-5B D8/D11 — the free dish is a PRODUCT REFERENCE + a QTY ─────────────
// The snapshot is what a reprint rebuilds a free-dish line from years later,
// so what it carries (and refuses to carry) is a money-adjacent contract.

test("D8: a flat rung carrying a STALE itemProductId does not snapshot it", () => {
  // The owner switched an existing item rung to "percent" without clearing the
  // picker. The ref is still on the row, but the reward is now rupees off —
  // snapshotting the ref would resurrect a free dish on a reprint.
  const stale: ResolvedMilestone = {
    at: 8,
    kind: "percent",
    value: 10,
    item: "Cold Coffee",
    itemProductId: "60a1b2c3d4e5f60718293a4b",
    qty: 3,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
  const snapshot = redemptionSnapshotOf(stale);
  assert.ok(!("itemProductId" in snapshot), "a non-item rung must not carry a product ref");
  assert.ok(!("qty" in snapshot), "a non-item rung must not carry a dish count");
});

test("D8: an item rung with NO product ref snapshots neither ref nor qty", () => {
  // A pre-D8 row read off a live cafe: a name, no reference. It must present
  // as NOT resolvable rather than silently falling back to the name.
  const preD8: ResolvedMilestone = {
    at: 5,
    kind: "item",
    value: 0,
    item: "Masala Chai",
    itemProductId: null,
    qty: 1,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
  const snapshot = redemptionSnapshotOf(preD8);
  assert.equal(snapshot.item, "Masala Chai", "the display name still travels");
  assert.ok(!("itemProductId" in snapshot), "no ref means not resolvable, never a name fallback");
});

test("D8/D11: ref + qty survive the order-snapshot round trip, absence survives as absence", () => {
  const withDish: ResolvedMilestone = {
    at: 6,
    kind: "item",
    value: 0,
    item: "Veg Sandwich",
    itemProductId: "0123456789abcdef01234567",
    qty: 2,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
  const snapshot = redemptionSnapshotOf(withDish);
  const rebuilt = rewardFromOrderSnapshot({
    rewardAt: snapshot.at,
    rewardKind: snapshot.kind,
    rewardValue: snapshot.value,
    rewardItem: snapshot.item,
    rewardItemProductId: snapshot.itemProductId,
    rewardQty: snapshot.qty,
  });
  assert.deepEqual(rebuilt, snapshot, "a free-dish reward must rebuild byte-identical");

  // A pre-D8 order stored only the four original fields.
  const old = rewardFromOrderSnapshot({ rewardAt: 5, rewardKind: "item", rewardValue: 0, rewardItem: "Chai" });
  assert.ok(old, "a pre-D8 reward still rebuilds");
  assert.ok(!("itemProductId" in old!), "absence must survive as absence, not as null");
  assert.ok(!("qty" in old!), "absence must survive as absence, not as a defaulted 1");
});
