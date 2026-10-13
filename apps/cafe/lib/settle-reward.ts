import { computeOrderTotals, gstConfigFromOrder } from "@/lib/receipt";
import { resolveRewardClaim, rewardClaimMessage } from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { resolveCardClaim } from "@/lib/reward-card-claim";
import { rewardClaimRefusal } from "@/lib/order-reward-fence";
import { gstConfigOf } from "@/lib/settings";
import { settleCharges } from "@/lib/settle-charges";
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";
import { resolvePointsSpend } from "@/lib/reward-points-spend";
import { CARD_REWARD_EXCLUSIVE } from "@pos/shared/reward-card-use";
import { POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";
import type { DiscountKind } from "@/lib/constants";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import type { IOrder } from "@/models/Order";
import type { ISettings } from "@/models/Settings";

// The settle's reward resolution, split out of app/api/orders/[id]/settle/
// route.ts (S5a, behaviour-preserving move) so the route file stops growing.

// The kotRound resolveCardClaim stamps on a free-dish line; settle refuses that kind, so no line is ever stamped.
const UNUSED_KOT_ROUND = 1;

// The reward this settle claims, once resolved (never an item reward: D9).
export type SettleRewardClaim = Extract<Awaited<ReturnType<typeof resolveRewardClaim>>, { ok: true }>;

// CB-7 S5 — a scratch card resolved for this settle (never a free dish: D9); `now` is the one clock reading its claim uses.
export interface SettleCardClaim {
  id: string;
  reward: RedeemedReward;
  now: Date;
}

// CB-7 S6 — reward points resolved for this settle: `n` is exactly what the client asked for, `now` the one clock reading
// its spend uses. Never written yet.
export interface SettlePointsClaim {
  n: number;
  reward: RedeemedReward;
  now: Date;
}

export interface ResolveSettleRewardArgs {
  // The open tab as read: its lines, stored discount/charge, customer, any reward, the promo marker.
  old: Pick<
    IOrder,
    "items" | "discount" | "chargeAmount" | "charges" | "chargeLabel" | "customerId" | "rewardAt" | "rewardCardId" | "rewardPoints" | "promoCode" | "discountKind"
  > &
    Parameters<typeof gstConfigFromOrder>[0];
  settings: ISettings;
  // The claimed rung's stamp cost, absent when this settle claims nothing.
  rewardAt: number | undefined;
  // The revealed card to spend instead (exclusive with rewardAt), absent when none.
  rewardCardId?: string;
  // Whole reward points to spend instead (exclusive with both), absent when none. Spent exactly or refused, never clamped.
  rewardPoints?: number;
  // What the body SENT as its discount kind: the GST preset beside points is refused (one discount per bill).
  discountKind?: DiscountKind | null;
  // The settle body's own charge (optional: omit = unchanged).
  chargeAmount: number | undefined;
  // The settle body's extra-charge set (G2: present = replaces the stored extras, absent = unchanged).
  extraCharges?: readonly { label: string; amount: number }[];
}

export type SettleRewardResolution =
  | { ok: false; message: string; status: 400 | 409 }
  | {
      ok: true;
      claim: SettleRewardClaim | undefined;
      card: SettleCardClaim | undefined;
      points: SettlePointsClaim | undefined;
      rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
    };

export async function resolveSettleReward({
  old,
  settings,
  rewardAt,
  rewardCardId,
  rewardPoints,
  discountKind,
  chargeAmount,
  extraCharges,
}: ResolveSettleRewardArgs): Promise<SettleRewardResolution> {
  // CB-5B S5 — a reward claimed AT SETTLE TIME. refuseItemKind: TRUE (D9,
  // owner decision): a free DISH has to reach the kitchen while the order
  // is being taken, never after payment — this path may only grant a
  // flat/percent money-off. An order that already carries a reward refuses
  // a second one outright, same one-scalar-one-kind reasoning as add-round.
  let claim: SettleRewardClaim | undefined;
  let card: SettleCardClaim | undefined;
  let points: SettlePointsClaim | undefined;
  if (rewardAt !== undefined && rewardCardId !== undefined) {
    return { ok: false, message: CARD_REWARD_EXCLUSIVE, status: 400 };
  }
  if (rewardPoints !== undefined && (rewardAt !== undefined || rewardCardId !== undefined || discountKind === "gst")) {
    return { ok: false, message: POINTS_REWARD_EXCLUSIVE, status: 400 };
  }
  if (rewardAt !== undefined || rewardCardId !== undefined || rewardPoints !== undefined) {
    // One reward per bill, and never on a promo bill (P2): the same rule rides the CAS filter
    // (rewardClaimOrderFence) for a marker or reward that lands after this read.
    const refusal = rewardClaimRefusal(old);
    if (refusal) return { ok: false, message: refusal, status: 409 };
  }
  // billTotal for the minBill gate: the bill WITHOUT the reward — a settle-time charge change rides along. A claim
  // REPLACES any manual/GST discount (the POS sends the reward's own preview as `discount`), so it is priced
  // undiscounted; only a claiming request ever calls this. G2 — both charge lanes come from the SAME builder the bill
  // uses (resolveSettleMoney), so the gate reads exactly the bill the settle will charge.
  const plainTotals = () => {
    const { table, extra } = splitChargeTotals(settleCharges(chargesFromOrder(old), chargeAmount, extraCharges));
    return computeOrderTotals({
      items: old.items,
      discount: 0,
      discountKind: undefined,
      charge: table,
      extraCharge: extra,
      cfg: gstConfigFromOrder(old, gstConfigOf(settings)),
    });
  };
  const plainTotal = (): number => plainTotals().total;
  if (rewardCardId !== undefined) {
    const now = new Date();
    const resolved = await resolveCardClaim({
      settings,
      customerId: old.customerId ? String(old.customerId) : undefined,
      cardId: rewardCardId,
      billTotal: plainTotal(),
      items: old.items,
      // A free-dish card is refused here (CARD_ITEM_NOT_AT_SETTLE): the dish has to reach the kitchen at order-taking.
      refuseItemKind: true,
      kotRound: UNUSED_KOT_ROUND,
      now,
    });
    if (!resolved.ok) return { ok: false, message: resolved.message, status: 400 };
    card = { id: rewardCardId, reward: resolved.reward, now };
  }
  if (rewardPoints !== undefined) {
    // Points come off the FOOD total (the bill before any reward, GST and charges excluded). A missing customer is
    // refused inside the resolve (400), a short balance is a 409; nothing is read for a request refused above.
    const now = new Date();
    const resolved = await resolvePointsSpend({
      settings,
      customerId: old.customerId ? String(old.customerId) : undefined,
      points: rewardPoints,
      subtotal: plainTotals().subtotal,
      now,
    });
    if (!resolved.ok) return { ok: false, message: resolved.message, status: resolved.status };
    points = { n: resolved.n, reward: resolved.reward, now: resolved.now };
  }
  if (rewardAt !== undefined) {
    const billTotal = plainTotal();
    const resolved = await resolveRewardClaim({
      settings,
      customerId: old.customerId ? String(old.customerId) : undefined,
      rewardAt,
      billTotal,
      refuseItemKind: true,
    });
    if (!resolved.ok) return { ok: false, message: rewardClaimMessage(resolved.reason), status: 400 };
    claim = resolved;
  }
  // CB-5D part 2 — captured ONCE, alongside `claim`, and reused by the single
  // claimRewardStamps call below. Settle claims for an already-fixed
  // orderId (no renumber-retry), but the assignment is still built here
  // rather than inline in the call so `assignedAt` is pinned to one Date
  // even if a future change adds a retry path — claimRewardStamps's
  // $addToSet treats the assignment as one whole element, and a
  // reconstructed Date at a second call site would duplicate the reward.
  // Same settings?.promoCodes source every other reward-minting writer uses.
  const rewardAssignment = claim
    ? buildRewardAssignment(claim.milestone, settings?.promoCodes, new Date())
    : undefined;
  return { ok: true, claim, card, points, rewardAssignment };
}
