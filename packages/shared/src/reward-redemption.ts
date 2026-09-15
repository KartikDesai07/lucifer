// CB-5B — the reward-redemption CONTRACT: a diner's loyalty milestone claim
// as a money-adjacent snapshot. Kept OUT of loyalty-rules.ts (165 lines) and
// constants.ts (383, already over the ~300 cap — R3 debt) as its own module.
// PURE, client-safe: no DB, no Node APIs, no Mongoose — same discipline as
// codec.ts (F2c §6).

import { LOYALTY_REWARD_KINDS, type LoyaltyRewardKind } from "./public-diner";
import type { ResolvedMilestone } from "./loyalty-rules";
import type { DiscountKind } from "./constants";

// A resolved milestone, minus `minBill`. `minBill` is a GATE the route
// evaluates ONCE, at claim time, to decide whether the milestone may be
// redeemed at all (CB-5A per-milestone minimum bill) — it is never a money
// INPUT, so it has no business riding along on the snapshot that
// `rewardDiscountAmount` (lib/receipt.ts, S2) reads back out of an Order.
export interface RedeemedReward {
  at: number;
  kind: LoyaltyRewardKind;
  value: number;
  item: string;
  // CB-5B D8/D11 — a kind:"item" reward's free dish, captured AT CLAIM TIME.
  // These ride on the snapshot for the same reason `value` does: the issued
  // row must stay rebuildable years later without consulting the live ladder.
  // `itemProductId` is what the server resolves the dish from (the display
  // `item` name above is never resolved against); `qty` is how many the claim
  // granted. Both OPTIONAL: only an item reward has them, and every
  // pre-D8 stored order has neither.
  itemProductId?: string;
  qty?: number;
}

/** Build the redemption snapshot from a resolved milestone at claim time. */
export function redemptionSnapshotOf(milestone: ResolvedMilestone): RedeemedReward {
  return {
    at: milestone.at,
    kind: milestone.kind,
    value: milestone.value,
    item: milestone.item,
    // Omit-empty, never `undefined` keys on the stored snapshot: a non-item
    // rung has no dish and no count, and writing explicit undefineds would
    // put dead keys in the ledger (F2c omit-empty discipline).
    //
    // BOTH fields gate on kind === "item", not on the value being present. A
    // flat/percent rung that still carries a stale itemProductId (the owner
    // switched an existing rung's kind from item to percent without clearing
    // the picker) must NOT snapshot it — the snapshot is what a reprint
    // rebuilds a free-dish line from, so a stray ref there would resurrect a
    // dish on a bill whose reward is rupees off.
    ...(milestone.kind === "item" && milestone.itemProductId !== null
      ? { itemProductId: milestone.itemProductId, qty: milestone.qty }
      : {}),
  };
}

// The five Order snapshot fields (CB-5B §3b), typed structurally so this
// module never imports a cafe Mongoose model — same reasoning as
// `StoredOrder` in codec.ts staying a plain interface.
interface OrderRewardSnapshot {
  rewardAt?: number;
  rewardKind?: LoyaltyRewardKind;
  rewardValue?: number;
  rewardItem?: string;
  // CB-5B D8/D11 — the two new Order snapshot fields behind a free dish.
  rewardItemProductId?: string;
  rewardQty?: number;
}

/**
 * Rebuild a `RedeemedReward` from the five snapshot fields stored on an
 * Order, or `undefined` when the order carries no reward. The years-later
 * reprint contract (CB-5A `public-diner.ts`): a reward is issued at a cost,
 * and that cost is STORED on the issued row — this rebuilds the redemption
 * from THOSE fields, never from the live (possibly re-tuned) ladder setting.
 */
export function rewardFromOrderSnapshot(order: OrderRewardSnapshot): RedeemedReward | undefined {
  if (
    order.rewardAt === undefined ||
    order.rewardKind === undefined ||
    order.rewardValue === undefined
  ) {
    return undefined;
  }
  return {
    at: order.rewardAt,
    kind: order.rewardKind,
    value: order.rewardValue,
    item: order.rewardItem ?? "",
    // Rebuilt only when stored. A pre-D8 order legitimately has neither, and
    // the ABSENCE must survive the round-trip as absence — a caller deciding
    // whether it can rebuild a free-dish line reads exactly this.
    ...(order.rewardItemProductId === undefined ? {} : { itemProductId: order.rewardItemProductId }),
    ...(order.rewardQty === undefined ? {} : { qty: order.rewardQty }),
  };
}

// D5 REVERSAL (2026-09-13) — the owner reversed D5/A1: `kind:"item"` IS
// redeemable after all. All three kinds may now be spent through this path,
// so REDEEMABLE is simply every LOYALTY_REWARD_KIND — kept as its OWN export
// (not an inline re-export of LOYALTY_REWARD_KINDS) because CB-7 is already
// scoped to reintroduce a NARROWER redeemability axis (product/category-scoped
// rewards will not all qualify), and `isRedeemableRewardKind` stays for that
// future caller. An item reward's money VALUE is 0 by design — the benefit is
// a free dish placed on the bill (S12's priced-but-untotalled line), never
// rupees off the total — so "redeemable" here means "may be claimed", not
// "is worth something".
export const REWARD_REDEEMABLE_KINDS = LOYALTY_REWARD_KINDS;

export function isRedeemableRewardKind(kind: LoyaltyRewardKind): boolean {
  return (REWARD_REDEEMABLE_KINDS as readonly LoyaltyRewardKind[]).includes(kind);
}

// The repo-wide "amount gates the kind" rule (codec.ts, ~12 call sites) needs
// exactly ONE exception: a "reward" kind must store its kind + 5-field
// snapshot even when the derived amount is 0, because an item reward's
// amount is ALWAYS 0 by construction — if amount gated it like every other
// kind, the snapshot (and the stamps-spent provenance it carries) would be
// silently $unset on exactly the orders that spent stamps for a free dish.
// Written as a PER-KIND ternary, not `amount > 0 || kind === "reward"`,
// so a FUTURE kind added to DISCOUNT_KINDS cannot accidentally inherit this
// escape hatch just by being compared with `||` — it must explicitly opt in
// by name, the same way "reward" does here.
export function shouldStoreDiscountKind(discountAmount: number, kind: DiscountKind | undefined): boolean {
  return kind === "reward" ? true : discountAmount > 0 && kind !== undefined;
}

// Marker text for the free-dish bill/KOT line (S12+). Plain English per this
// repo's UI-copy rule (Hinglish is chat-only, never a product string) — short
// enough to fit an 80mm thermal slip.
export const REWARD_ITEM_LINE_NOTE = "Reward — free";
