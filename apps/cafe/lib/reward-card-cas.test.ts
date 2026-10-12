import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REWARD_CARD_USE_KINDS } from "@pos/shared/reward-card-use";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import {
  cardClaimFilter,
  cardClaimUpdate,
  cardReleaseFilter,
  cardReleaseUpdate,
  cardSnapshotFields,
  scopeMatchesItems,
} from "@/lib/reward-card-cas";
import { stripComments } from "@/lib/source-pin-utils";

// CB-7 S5 slice B: the exact filter / update shapes of the card claim + release, the zero-match gate and the Order
// snapshot fields. DB-free.

const NOW = new Date("2026-10-12T06:00:00.000Z");
const VALID_UNTIL = new Date("2026-10-26T06:00:00.000Z");
const CID = "64b000000000000000000001";
const CARD = "0123456789ab";
const ORDER = "A-1007";

test("claim filter: this diner, this card, revealed, validUntil $gte now (engine expiry is strict >), kind allowlist", () => {
  assert.deepEqual(cardClaimFilter(CID, CARD, NOW), {
    _id: CID,
    rewardCards: {
      $elemMatch: {
        id: CARD,
        status: "revealed",
        validUntil: { $gte: NOW },
        kind: { $in: ["bill-percent", "bill-flat", "product-percent", "category-percent", "category-flat", "free-item"] },
      },
    },
  });
  const kinds = (cardClaimFilter(CID, CARD, NOW).rewardCards as { $elemMatch: { kind: { $in: string[] } } }).$elemMatch.kind.$in;
  assert.deepEqual(kinds, [...REWARD_CARD_USE_KINDS]);
  const all: readonly string[] = kinds;
  assert.ok(!all.includes("points") && !all.includes("none"), "points lots and none cards are never claimable");
});

test("claim filter: the allowlist is a COPY (a caller cannot mutate the shared constant)", () => {
  const kinds = (cardClaimFilter(CID, CARD, NOW).rewardCards as { $elemMatch: { kind: { $in: string[] } } }).$elemMatch.kind.$in;
  assert.notEqual(kinds, REWARD_CARD_USE_KINDS as unknown);
});

test("claim update: used + usedAt + keepUntil = now + the orderId; no rewardAt / rewardStamps anywhere", () => {
  const u = cardClaimUpdate(ORDER, NOW);
  assert.deepEqual(u, {
    $set: {
      "rewardCards.$.status": "used",
      "rewardCards.$.usedAt": NOW,
      "rewardCards.$.keepUntil": NOW,
      "rewardCards.$.orderId": ORDER,
    },
  });
  assert.ok(!JSON.stringify(u).includes("rewardAt") && !JSON.stringify(u).includes("rewardStamps"));
});

test("release filter: the orderId term is part of the match (never release another order's card)", () => {
  assert.deepEqual(cardReleaseFilter(CID, CARD, ORDER), {
    _id: CID,
    rewardCards: { $elemMatch: { id: CARD, status: "used", orderId: ORDER } },
  });
  assert.notDeepEqual(cardReleaseFilter(CID, CARD, ORDER), cardReleaseFilter(CID, CARD, "A-1008"));
});

test("release update: back to revealed with keepUntil = the stored validUntil; usedAt + orderId unset (positional)", () => {
  const u = cardReleaseUpdate(VALID_UNTIL);
  assert.deepEqual(u, {
    $set: { "rewardCards.$.status": "revealed", "rewardCards.$.keepUntil": VALID_UNTIL },
    $unset: { "rewardCards.$.usedAt": "", "rewardCards.$.orderId": "" },
  });
  // Status-based: no one-way marker field is written, so a retry can claim the card again.
  assert.ok(!JSON.stringify(u).includes("rewardAt") && !JSON.stringify(u).includes("released"));
});

test("scopeMatchesItems: an eligible line is a non-reward line whose product is in scope", () => {
  const scope = { productIds: ["p1", "p2"] };
  assert.equal(scopeMatchesItems(scope, [{ productId: "p9" }, { productId: "p2" }]), true);
  assert.equal(scopeMatchesItems(scope, [{ productId: "p9" }]), false);
  assert.equal(scopeMatchesItems(scope, []), false);
  assert.equal(scopeMatchesItems(scope, [{ productId: "p1", reward: true }]), false, "a reward line is never eligible");
  assert.equal(scopeMatchesItems(scope, [{ reward: false }]), false, "a line with no product id never matches");
  assert.equal(scopeMatchesItems({ productIds: [] }, [{ productId: "p1" }]), false);
  assert.equal(scopeMatchesItems(scope, [{ productId: { toString: () => "p1" } }]), true, "an ObjectId-like id is compared as a string");
});

const BASE: RedeemedReward = { at: 0, kind: "percent", value: 15, item: "", cardId: CARD };

test("cardSnapshotFields: a bill card writes only kind/value/item/cardId — omit-empty, never rewardAt / rewardStamps", () => {
  assert.deepEqual(cardSnapshotFields(BASE), { rewardKind: "percent", rewardValue: 15, rewardItem: "", rewardCardId: CARD });
  const full: RedeemedReward = {
    ...BASE,
    kind: "flat",
    scope: { productIds: ["p1", "p2"], maxUnits: 1, label: "Cold Coffee" },
    capRupees: 100,
  };
  const out = cardSnapshotFields(full);
  assert.deepEqual(out, {
    rewardKind: "flat",
    rewardValue: 15,
    rewardItem: "",
    rewardCardId: CARD,
    rewardScopeProductIds: ["p1", "p2"],
    rewardScopeMaxUnits: 1,
    rewardScopeLabel: "Cold Coffee",
    rewardCapRupees: 100,
  });
  for (const r of [BASE, full]) {
    const keys = Object.keys(cardSnapshotFields(r));
    assert.ok(!keys.includes("rewardAt") && !keys.includes("rewardStamps"));
    assert.ok(!Object.values(cardSnapshotFields(r)).includes(undefined), "no undefined values on the ledger");
  }
});

test("cardSnapshotFields: empty scope bits are omitted; a free dish carries its product + qty", () => {
  const scoped = cardSnapshotFields({ ...BASE, scope: { productIds: ["p1"], label: "" } });
  assert.deepEqual(Object.keys(scoped).sort(), ["rewardCardId", "rewardItem", "rewardKind", "rewardScopeProductIds", "rewardValue"]);
  const item = cardSnapshotFields({ at: 0, kind: "item", value: 0, item: "Cold Coffee", cardId: CARD, itemProductId: "p1", qty: 2 });
  assert.deepEqual(item, {
    rewardKind: "item",
    rewardValue: 0,
    rewardItem: "Cold Coffee",
    rewardItemProductId: "p1",
    rewardQty: 2,
    rewardCardId: CARD,
  });
});

test("PIN: the pure builders import no Mongoose / model and never name rewardAt or rewardStamps as a written key", () => {
  const code = stripComments(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "reward-card-cas.ts"), "utf8"));
  assert.ok(!/from "mongoose"/.test(code) && !/@\/models\//.test(code));
  assert.ok(!/rewardAt\s*[:=]/.test(code) && !/rewardStamps\s*[:=]/.test(code));
  assert.ok(code.includes("$gte: now"), "landmark: the claim keeps the $gte deadline term");
});
