import type { DiscountKind } from "@/lib/constants";
import {
  resolveRewardClaimAndLine,
  type RewardResolution,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { resolveCardClaim } from "@/lib/reward-card-claim";
import type { ISettings } from "@/models/Settings";
import type { OrderItemInput } from "@/schemas";
import { CARD_REWARD_EXCLUSIVE } from "@pos/shared/reward-card-use";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// The counter create's reward resolution, split out of app/api/orders/route.ts
// (S5a, behaviour-preserving move). Resolved BEFORE totals (CB-5B S4) so a
// reward claim can be validated against the plain bill (no reward yet) and, if
// it resolves, folded into the SAME totals computation the route already
// trusts — there is no second money path for a redeemed order.

// CB-7 S5 — a scratch card resolved for this create (never written yet). `now` is the ONE clock reading the claim, and
// the renumber retry's re-claim, both use.
export interface CreateCardClaim {
  id: string;
  reward: RedeemedReward;
  now: Date;
}

export interface ResolveCreateRewardArgs {
  settings: ISettings | null;
  customerId: string | undefined;
  // The parsed request lines; a resolved item reward's dish line is appended.
  items: OrderItemInput[];
  // What the request SENT (`data.discountKind ?? undefined`).
  discountKind: DiscountKind | undefined;
  // The claimed rung's stamp cost, absent when no reward was requested.
  rewardAt: number | undefined;
  // The revealed card to spend instead (exclusive with rewardAt), absent when none.
  rewardCardId?: string;
  // The plain bill (no reward yet), in RUPEES — gates the rung's own minBill.
  billTotal: number;
}

export type CreateRewardResolution =
  | { ok: false; message: string }
  | {
      ok: true;
      rewardItems: OrderItemInput[];
      effectiveDiscountKind: DiscountKind | undefined;
      resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
      resolvedCard: CreateCardClaim | undefined;
      rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
    };

export async function resolveCreateReward({
  settings,
  customerId,
  items,
  discountKind,
  rewardAt,
  rewardCardId,
  billTotal,
}: ResolveCreateRewardArgs): Promise<CreateRewardResolution> {
  let rewardItems = items;
  let effectiveDiscountKind = discountKind;
  let resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
  // CB-5D part 2 — the promo-code assignment a claimed rung mints (or
  // undefined, the overwhelmingly common case). Built ONCE here, alongside
  // resolvedClaim, and reused by every claim attempt below (including the
  // duplicate-key retry's re-claim against the renumbered orderId):
  // claimRewardStamps de-dupes a retry via $addToSet, whose element equality
  // is WHOLE-DOCUMENT, so a fresh `new Date()` on a retry would make that
  // retry's element unequal to the first attempt's and append the reward a
  // SECOND time. Capturing assignedAt once and passing the SAME assignment
  // object into both claimFor(orderId) and claimFor(retryOrderId) is what
  // prevents that duplicate.
  let rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
  let resolvedCard: CreateCardClaim | undefined;
  // One order carries ONE reward: a stamp rung and a card together is refused before anything is read or claimed.
  if (rewardAt !== undefined && rewardCardId !== undefined) return { ok: false, message: CARD_REWARD_EXCLUSIVE };
  if (rewardCardId !== undefined) {
    const now = new Date();
    // Same plain bill (no reward yet) the stamp gate reads; the free-dish line, if any, is stamped round 1.
    const card = await resolveCardClaim({
      settings, customerId, cardId: rewardCardId, billTotal, items, refuseItemKind: false, kotRound: 1, now,
    });
    if (!card.ok) return { ok: false, message: card.message };
    if (card.line) rewardItems = [...items, { ...card.line, productId: String(card.line.productId) }];
    effectiveDiscountKind = "reward";
    resolvedCard = { id: rewardCardId, reward: card.reward, now };
  }
  if (rewardAt !== undefined) {
    // KOT_ROUND_OPENING (1) — the opening items are always round 1, so a
    // resolved item-reward's dish line is stamped the same way.
    const resolved = await resolveRewardClaimAndLine(
      {
        settings,
        customerId,
        rewardAt,
        billTotal,
        // Order-taking writer — an item reward IS allowed here (D9: the
        // free dish must reach the kitchen at order-taking time, so this is
        // exactly the writer that is allowed to grant one).
        refuseItemKind: false,
      },
      1,
    );
    // Rejected BEFORE anything is written or a slip number is burned (the
    // KOT number is taken only after every refusal, the bill number only by
    // the insert that won) — a bad claim must cost the till nothing.
    if (!resolved.ok) return { ok: false, message: resolved.message };

    // Appended to the priced items so it reaches BOTH computeOrderTotals
    // (untotalled/untaxed via the reward skip) and the stored doc. productId
    // is re-stringified: resolveRewardItemLine resolves a real ObjectId
    // (it queried Product by it), but every OTHER element in this array is
    // the Zod-parsed `data.items` shape, whose productId is a plain string
    // (Order.create casts either spelling the same way).
    if (resolved.line) {
      rewardItems = [...items, { ...resolved.line, productId: String(resolved.line.productId) }];
    }
    // A reward REPLACES the discountKind — Order carries one scalar + one
    // kind, so a reward and a gst preset can never both be the stored kind.
    effectiveDiscountKind = "reward";
    resolvedClaim = resolved.claim;
    // Same settings?.promoCodes source the QR accept path resolves against
    // (order-request-accept-reward.ts) — one place decides what a rung
    // mints, so the two surfaces can never disagree about a code.
    rewardAssignment = buildRewardAssignment(resolved.claim.milestone, settings?.promoCodes, new Date());
  }
  return { ok: true, rewardItems, effectiveDiscountKind, resolvedClaim, resolvedCard, rewardAssignment };
}
