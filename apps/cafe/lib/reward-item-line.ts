// CB-5B S12 — build the free-dish bill line from a claimed item reward.
//
// D5 REVERSAL (owner, 2026-09-13): a kind:"item" milestone puts the dish ON
// THE BILL AT ITS REAL PRICE — so the customer sees what they got and what it
// was worth — while that price is NOT added to the total. The untotalled part
// is NOT this module's job: it falls out of the single `i.reward ? 0 :` skip
// in the subtotal reducer (lib/receipt.ts), and because `base` derives from
// that subtotal and the GST from that base, untotalled AND untaxed follow from
// one line. This module only CREATES the line.
//
// D8 (owner, 2026-09-13): the dish is resolved from a PRODUCT REFERENCE, never
// from the milestone's display name. Resolving by name breaks the moment a
// dish is renamed, deleted, or shares a name with another — the
// closed-enum-to-free-text hazard. `RedeemedReward.item` survives only as the
// name snapshot shown on the ladder.

import { Types } from "mongoose";
import { REWARD_ITEM_LINE_NOTE, type RedeemedReward } from "@pos/shared/reward-redemption";
import { LOYALTY_REWARD_QTY_DEFAULT } from "@pos/shared/public-diner";
import { Product } from "@/models/Product";
import { derivedLinePrice } from "@/lib/public-pricing";

// The line this module produces. Structurally the OrderItem subdoc's own
// shape (models/Order.ts) minus the fields a caller owns, so a caller can
// spread it straight into an items[] write.
export interface RewardItemLine {
  productId: Types.ObjectId;
  name: string;
  price: number;
  qty: number;
  // The size this dish was comped as, when the product sells in sizes. Carried
  // for the same reason every other ordering path carries it: without it the
  // kitchen slip reads a bare name and cannot tell which size to make, and the
  // void trail cannot say what was actually given away.
  variation?: string;
  reward: true;
  note: string;
}

// Why a resolve can fail, as a CLOSED set — never a bare null. A caller has
// to render a staff-readable reason at the counter, and "the dish is gone" and
// "the reward carries no dish at all" call for different words.
export type ResolveRewardItemResult =
  | { ok: true; line: RewardItemLine }
  | { ok: false; reason: "not-an-item-reward" }
  | { ok: false; reason: "no-product-ref" }
  | { ok: false; reason: "product-missing" }
  | { ok: false; reason: "product-unavailable" }
  | { ok: false; reason: "variation-required" };

/**
 * Resolve a claimed reward's free dish into a bill line.
 *
 * Returns a VERDICT, never throws on a missing dish: the owner can delete or
 * "86" a product at any time, and a claim made against it must fail loudly at
 * the counter (staff pick another rung) rather than silently produce a line
 * with no product behind it.
 */
export async function resolveRewardItemLine(
  reward: RedeemedReward,
  variation?: string,
): Promise<ResolveRewardItemResult> {
  // Only an item reward has a dish. A flat/percent reward is money off the
  // total and is handled entirely by rewardDiscountAmount (lib/receipt.ts).
  if (reward.kind !== "item") return { ok: false, reason: "not-an-item-reward" };

  // A pre-D8 milestone stored a name and no reference. It is NOT resolvable,
  // and must not fall back to a name lookup — that is the exact ambiguity D8
  // exists to remove.
  const ref = reward.itemProductId;
  if (ref === undefined || ref.length === 0) return { ok: false, reason: "no-product-ref" };
  if (!Types.ObjectId.isValid(ref)) return { ok: false, reason: "product-missing" };

  // `discount` and `variations` are SELECTED because the price a line bills at
  // is derived from all three (lib/public-pricing.ts) — selecting only `price`
  // is what made an earlier draft comp a sized or discounted dish at the wrong
  // figure.
  const product = await Product.findById(ref)
    .select("name price discount available isActive variations modifiers")
    .lean();
  // isActive:false is an ARCHIVED (soft-deleted) product — for a claim it is
  // indistinguishable from gone, so both collapse to "product-missing".
  if (!product || product.isActive === false) return { ok: false, reason: "product-missing" };
  // `available:false` is the "86" toggle: the dish exists but the kitchen is
  // out of it. Its own reason, because staff can act on it (make it available,
  // or let the diner claim a different rung).
  if (product.available === false) return { ok: false, reason: "product-unavailable" };

  // The dish's REAL selling price — through the SAME helper every other
  // ordering path uses, so a variation's own price and the product discount are
  // both honoured. Never 0: the bill must show what the reward was worth, and
  // the void trail must record a comped dish at its true value (models/Order.ts's
  // own reasoning for keeping `price` honest).
  const price = derivedLinePrice(
    {
      _id: ref,
      name: product.name,
      price: product.price,
      discount: product.discount ?? 0,
      // Already gated above — an unavailable dish returned before this point.
      available: true,
      modifiers: product.modifiers ?? [],
      variations: product.variations,
    },
    variation,
  );
  // `null` means the named variation is not on this product. Per that helper's
  // own contract this is a REJECTION — never a fall back to the base price.
  if (price === null) return { ok: false, reason: "variation-required" };
  // A sized dish comped without naming a size would reach the kitchen as a
  // bare name, so require the caller to have picked one.
  if (!variation && product.variations && product.variations.length > 0) {
    return { ok: false, reason: "variation-required" };
  }

  return {
    ok: true,
    line: {
      productId: new Types.ObjectId(ref),
      name: product.name,
      price,
      qty: rewardItemQty(reward),
      ...(variation === undefined ? {} : { variation }),
      reward: true,
      note: REWARD_ITEM_LINE_NOTE,
    },
  };
}

/**
 * How many of the free dish this claim granted (D11).
 *
 * Reads the COUNT STORED ON THE CLAIM, never the live milestone: an owner who
 * re-tunes the ladder from 2 dishes to 1 mid-service must not retroactively
 * shrink a reward a diner already claimed (the same issued-at-a-cost contract
 * that keeps rewardStamps stored rather than re-derived).
 */
export function rewardItemQty(reward: RedeemedReward): number {
  const qty = reward.qty;
  // Absent on every pre-D11 claim, so the fallback is the IDENTITY (1), never
  // 0 — a reward that grants zero dishes is not a reward.
  if (!Number.isInteger(qty) || (qty as number) < 1) return LOYALTY_REWARD_QTY_DEFAULT;
  return qty as number;
}
