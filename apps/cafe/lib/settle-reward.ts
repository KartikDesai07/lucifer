import type { DiscountKind } from "@/lib/constants";
import { computeOrderTotals, gstConfigFromOrder, resolveDiscountKind } from "@/lib/receipt";
import { resolveRewardClaim, rewardClaimMessage } from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { gstConfigOf } from "@/lib/settings";
import type { IOrder } from "@/models/Order";
import type { ISettings } from "@/models/Settings";

// The settle's reward resolution, split out of app/api/orders/[id]/settle/
// route.ts (S5a, behaviour-preserving move) so the route file stops growing.

// The reward this settle claims, once resolved (never an item reward: D9).
export type SettleRewardClaim = Extract<Awaited<ReturnType<typeof resolveRewardClaim>>, { ok: true }>;

export interface ResolveSettleRewardArgs {
  // The open tab as read: its lines, stored discount/charge, customer, any reward.
  old: Pick<IOrder, "items" | "discount" | "chargeAmount" | "customerId" | "rewardAt" | "discountKind"> &
    Parameters<typeof gstConfigFromOrder>[0];
  settings: ISettings;
  // The claimed rung's stamp cost, absent when this settle claims nothing.
  rewardAt: number | undefined;
  // The settle body's own discount / kind / charge (all optional: omit = unchanged).
  discount: number | undefined;
  discountKind: DiscountKind | null | undefined;
  chargeAmount: number | undefined;
}

export type SettleRewardResolution =
  | { ok: false; message: string; status: 400 | 409 }
  | {
      ok: true;
      claim: SettleRewardClaim | undefined;
      rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
    };

export async function resolveSettleReward({
  old,
  settings,
  rewardAt,
  discount,
  discountKind,
  chargeAmount,
}: ResolveSettleRewardArgs): Promise<SettleRewardResolution> {
  // CB-5B S5 — a reward claimed AT SETTLE TIME. refuseItemKind: TRUE (D9,
  // owner decision): a free DISH has to reach the kitchen while the order
  // is being taken, never after payment — this path may only grant a
  // flat/percent money-off. An order that already carries a reward refuses
  // a second one outright, same one-scalar-one-kind reasoning as add-round.
  let claim: SettleRewardClaim | undefined;
  if (rewardAt !== undefined) {
    if (old.rewardAt !== undefined) {
      return { ok: false, message: "This tab already has a reward applied", status: 409 };
    }
    // billTotal for the minBill gate: the bill WITHOUT the reward — any
    // settle-time discount/charge change rides along, mirroring what
    // resolveSettleMoney would price without a reward.
    const plainKind = resolveDiscountKind(discountKind, old.discountKind);
    const billTotal = computeOrderTotals({
      items: old.items,
      discount: discount ?? old.discount,
      discountKind: plainKind,
      charge: chargeAmount ?? old.chargeAmount ?? 0,
      cfg: gstConfigFromOrder(old, gstConfigOf(settings)),
    }).total;
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
  return { ok: true, claim, rewardAssignment };
}
