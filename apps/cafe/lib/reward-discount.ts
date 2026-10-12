import type { DiscountKind } from "@/lib/constants";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

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
export function rewardDiscountAmount(
  subtotal: number,
  reward: RedeemedReward | undefined,
): number {
  if (!reward || subtotal <= 0) return 0;
  const s = Math.max(0, Math.round(subtotal));
  if (reward.kind === "percent") {
    const pct = Math.min(Math.max(0, reward.value), PERCENT);
    return Math.round((s * pct) / PERCENT);
  }
  if (reward.kind === "flat") return Math.max(0, Math.round(reward.value));
  return 0;
}
