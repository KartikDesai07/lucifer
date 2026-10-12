import type { DiscountKind } from "@/lib/constants";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { resolveRewardClaimAndLine, type RewardResolution } from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import { rewardFromOrderSnapshot, type RedeemedReward } from "@pos/shared/reward-redemption";
import type { IOrder, IOrderItem } from "@/models/Order";
import type { ISettings } from "@/models/Settings";
import type { OrderItemInput } from "@/schemas";

// The add-round's reward resolution, split out of app/api/orders/[id]/items/
// route.ts (S5a, behaviour-preserving move) so the route file stops growing.

// A line on the tab being priced: one already stored, or one of this round.
type RoundLine = IOrderItem | (OrderItemInput & { kotRound: number });

export interface ResolveRoundRewardArgs {
  // The open tab as read (its customer, any reward snapshot).
  old: Pick<IOrder, "customerId"> & Parameters<typeof rewardFromOrderSnapshot>[0];
  settings: ISettings | null;
  // The claimed rung's stamp cost, absent when this round claims nothing.
  rewardAt: number | undefined;
  // The tab's stored lines plus this round's new ones.
  fullItems: RoundLine[];
  discount: number;
  // The kind AFTER resolveDiscountKind (what the tab would carry without a claim).
  discountKind: DiscountKind | undefined;
  // The charge portions computeOrderTotals takes separately.
  charge: number;
  extraCharge: number;
  cfg: GstConfig;
  // This round's KOT number; a resolved dish line is stamped with it.
  round: number;
}

export type RoundRewardResolution =
  | { ok: false; message: string; status: 400 | 409 }
  | {
      ok: true;
      fullItems: RoundLine[];
      discountKind: DiscountKind | undefined;
      resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
      rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
      rewardForTotals: RedeemedReward | undefined;
    };

export async function resolveRoundReward({
  old,
  settings,
  rewardAt,
  fullItems: tabItems,
  discount,
  discountKind: tabKind,
  charge: chargeForTab,
  extraCharge: extraChargeForTab,
  cfg: gstCfg,
  round,
}: ResolveRoundRewardArgs): Promise<RoundRewardResolution> {
  let fullItems = tabItems;
  let discountKind = tabKind;
  // CB-5B S4 — a reward claim on an add-round. Resolved against the OPEN
  // TAB's own customer (never a body customer: the tab's identity is
  // already fixed), against a billTotal priced from the FULL item set
  // WITHOUT the reward (the per-milestone minBill gate is about what the
  // customer is spending this round, not the reward's own dish).
  let resolvedClaim: Extract<RewardResolution, { ok: true }> | undefined;
  // CB-5D part 2 — captured ONCE, alongside resolvedClaim, and reused by the
  // single claimRewardStamps call below. Unlike the create route, an
  // add-round claims for an EXISTING, already-fixed orderId — there is no
  // renumber-retry here — but the assignment is still built from a single
  // `assignedAt` for the same reason: claimRewardStamps's $addToSet treats
  // the assignment as one whole element, so it must never be reconstructed
  // with a fresh Date at a second call site.
  let rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;
  if (rewardAt !== undefined) {
    // A tab already carrying a reward must refuse a second one outright:
    // Order has ONE scalar + ONE kind, so a second claim would silently
    // overwrite the first snapshot while its stamps stayed spent.
    if (old.rewardAt !== undefined) {
      return { ok: false, message: "This tab already has a reward applied", status: 409 };
    }
    const billTotal = computeOrderTotals({
      items: fullItems,
      discount,
      discountKind,
      charge: chargeForTab,
      extraCharge: extraChargeForTab,
      cfg: gstCfg,
    }).total;
    const resolved = await resolveRewardClaimAndLine(
      {
        settings,
        customerId: old.customerId ? String(old.customerId) : undefined,
        rewardAt,
        billTotal,
        // Order-taking writer (D9 permits an item reward here, same as create).
        refuseItemKind: false,
      },
      round,
    );
    if (!resolved.ok) return { ok: false, message: resolved.message, status: 400 };
    if (resolved.line) fullItems = [...fullItems, resolved.line];
    // A reward REPLACES the discountKind, same reasoning as the create route.
    discountKind = "reward";
    resolvedClaim = resolved.claim;
    // Same settings?.promoCodes source the QR accept path and the counter
    // create route resolve against — one place decides what a rung mints.
    rewardAssignment = buildRewardAssignment(resolved.claim.milestone, settings?.promoCodes, new Date());
  }

  // The reward this round must price against: a claim made RIGHT NOW, or the
  // one the tab is already carrying. Rebuilding the existing one from the
  // Order's own snapshot is load-bearing, not defensive: `discountKind`
  // carries forward as "reward" for a tab created with one, and
  // rewardDiscountAmount returns 0 for a MISSING reward (it fails closed).
  // So passing only a fresh claim here would silently re-price an existing
  // flat/percent reward to zero on every added round — the diner's stamps
  // would stay spent while the discount they bought quietly left the bill.
  // Rebuilt from the stored snapshot, never re-read from the live ladder,
  // so a rung the owner retunes mid-service cannot change an issued reward.
  const rewardForTotals = resolvedClaim?.reward ?? rewardFromOrderSnapshot(old);
  return { ok: true, fullItems, discountKind, resolvedClaim, rewardAssignment, rewardForTotals };
}
