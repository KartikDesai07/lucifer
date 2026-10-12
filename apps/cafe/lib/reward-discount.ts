import type { DiscountKind } from "@/lib/constants";
import type { RedeemedReward, RewardScope } from "@pos/shared/reward-redemption";

// Reward-aware discount rules split out of receipt.ts (S5a, behaviour-preserving
// move). receipt.ts re-exports every symbol here, so no import path changed.
const PERCENT = 100;

// Resolves the discount kind a re-pricing writer should use from what the client
// SENT and what the order STORES: `undefined` (key absent) = leave the stored
// kind alone, `null` = the operator cleared the preset (a manual discount now
// applies), "gst" = the preset. The explicit-null sentinel exists because
// `undefined` cannot clear a field over JSON (JSON.stringify drops the key).
export function resolveDiscountKind(
  supplied: DiscountKind | null | undefined,
  stored: DiscountKind | undefined,
): DiscountKind | undefined {
  if (supplied === undefined) return stored;
  // CB-5B — a stored "reward" is SERVER-OWNED and STICKY against a client
  // null. `null` means "the operator cleared the preset", which is a thing an
  // operator may do to a GST preset they applied; it is NOT a thing a client
  // may do to a redemption, because the diner's stamps are ALREADY SPENT and
  // no client request can un-spend them. Without this, a request carrying
  // `discountKind: null` plus a manual `discount` would swap a stamp-funded
  // reward for an arbitrary operator-chosen figure — the reward's money value
  // reinstated (or inflated) with no stamp check at all, while the order's own
  // reward snapshot still claimed the redemption. A reward is removed only by
  // cancelling the order (S6), which RETURNS the stamps as it goes.
  // P4 (s87) — sticky against EVERY supplied value, not just null: a supplied
  // "gst" swapped the kind too, so the reward's money vanished while its
  // stamps stayed spent. The staff writers 409 that request first (see
  // rewardBlocksDiscountKind); this is the backstop for any other caller.
  if (stored === "reward") return stored;
  return supplied ?? undefined;
}

// P4 (s87) — the one plain answer every writer gives a request that would put
// a different discount kind on a bill whose reward is already spent. Shared by
// the items + settle routes (409) and the POS cart's GST-button hint.
export const REWARD_BLOCKS_GST_DISCOUNT_MESSAGE =
  "This bill already has a reward, so the GST discount can't be added to it";

// True when the client SENT a kind ("gst") that a stored "reward" must refuse.
// Absent and null are not refused: absent leaves the kind alone, and null is
// already ignored above (it never meant "remove the reward").
export function rewardBlocksDiscountKind(
  supplied: DiscountKind | null | undefined,
  stored: DiscountKind | undefined,
): boolean {
  return stored === "reward" && supplied != null && supplied !== "reward";
}

// CB-7 S5 (O2, s91) — the same plain answer for a bill that carries a PROMO CODE marker: the promo's discount is
// already the bill's money, and a supplied "gst" (or "reward") would replace it while the promo stays burned.
// Sibling of the reward message above; the items + settle routes 409 with it.
export const PROMO_BLOCKS_GST_DISCOUNT_MESSAGE =
  "This bill used a promo code, so the GST discount can't be added to it";

// True when the client SENT a kind the promo bill does not already carry. Absent and null are not refused: absent
// leaves the kind alone, and null only ever cleared a preset (it cannot touch the promo's manual discount). Re-sending the
// kind the tab ALREADY stores is no switch (a resumed POS echoes it on every add-round and settle) - the same let-the-stored-
// kind-back rule as rewardBlocksDiscountKind above.
export function promoBlocksDiscountKind(
  supplied: DiscountKind | null | undefined,
  storedPromoCode: string | undefined,
  storedKind: DiscountKind | undefined,
): boolean {
  return storedPromoCode !== undefined && supplied != null && supplied !== storedKind;
}

// CB-7 S5 — a bill line as the scoped-card base reads it: the subtotal reducer's own fields + the product ref.
export interface RewardBaseLine {
  price: number;
  qty: number;
  reward?: boolean;
  // `unknown` on purpose: a Mongoose ObjectId, a string and a loosely-typed seed line all arrive here; only a present,
  // non-null id can match a scope id (by its string form), anything else is simply not eligible.
  productId?: unknown;
}

function eligibleBase(scope: RewardScope, items: ReadonlyArray<RewardBaseLine>): number {
  const ids = new Set(scope.productIds);
  const eligible = items.filter(
    (line) => !line.reward && line.productId != null && ids.has(String(line.productId)),
  );
  if (scope.maxUnits === undefined) return eligible.reduce((sum, line) => sum + line.price * line.qty, 0);
  let remaining = Math.max(0, Math.floor(scope.maxUnits));
  let base = 0;
  for (const line of [...eligible].sort((a, b) => b.price - a.price)) {
    const units = Math.min(remaining, Math.max(0, line.qty));
    base += units * line.price;
    remaining -= units;
    if (remaining <= 0) break;
  }
  return base;
}

// CB-5B — the money a claimed milestone is worth on THIS subtotal. The reward
// twin of `gstEquivalentDiscount` above, and the reason `discountKind` is an
// enum rather than a free label: for BOTH presets the server re-derives the
// amount and the client's number is ignored.
//
// `item` rewards derive 0 DELIBERATELY, and this branch IS reached on every
// item reward in production (D5 was REVERSED 2026-09-13: `kind:"item"` is now
// a normal, redeemable rung — REWARD_REDEEMABLE_KINDS includes it). Returning
// 0 is the DESIGNED answer, not a fallback for an unreachable case: the free
// dish is given as its own line on the bill at full price (S12's
// priced-but-untotalled `OrderItem.reward` line), not as rupees off the
// total, so this function's job for an item reward is to contribute NOTHING
// to the discount — the money benefit lives entirely in the subtotal reducer
// skipping that one line, not here.
//
// CB-7 S5 (§2.6) — a scratch CARD rides the same function. `reward.scope` narrows the base from the whole subtotal to
// the ELIGIBLE lines (a non-reward line whose productId is in scope; a line with no productId is NOT eligible — fail
// closed). With `scope.maxUnits` only the DEAREST units count (owner O1, s91), taken across lines by unit price, so the
// answer never depends on line order. `capRupees` ("up to ₹X") bounds a percent card whether scoped or not. A scoped
// flat can never exceed its base; an UNSCOPED flat is untouched (the clamp in computeOrderTotals stays its only clamp).
// The per-line amount is price × qty with reward lines skipped, exactly the subtotal reducer's, so the eligible base
// can never exceed the subtotal it is taken from.
export function rewardDiscountAmount(
  subtotal: number,
  reward: RedeemedReward | undefined,
  items: ReadonlyArray<RewardBaseLine> = [],
): number {
  if (!reward || subtotal <= 0) return 0;
  const s = Math.max(0, Math.round(subtotal));
  // Scoped: the eligible base, never above the subtotal. Unscoped: the whole subtotal, exactly as before.
  const base = reward.scope ? Math.min(Math.max(0, Math.round(eligibleBase(reward.scope, items))), s) : s;
  if (reward.kind === "percent") {
    const pct = Math.min(Math.max(0, reward.value), PERCENT);
    const off = Math.round((base * pct) / PERCENT);
    return reward.capRupees === undefined ? off : Math.min(off, Math.max(0, Math.round(reward.capRupees)));
  }
  if (reward.kind === "flat") {
    const flat = Math.max(0, Math.round(reward.value));
    return reward.scope ? Math.min(flat, base) : flat;
  }
  return 0;
}
