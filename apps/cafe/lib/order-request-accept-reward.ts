import type { ISettings } from "@/models/Settings";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import {
  resolveRewardClaimAndLine,
  rewardSnapshotFields,
  claimRewardStamps,
  returnRewardStamps,
  type ResolvedRewardOrderItem,
  type RewardAssignment,
} from "@/lib/reward-claim";
import { buildRewardAssignment } from "@/lib/reward-assignment";

// CB-5B S8 (owner decision D4) — the accept-side half of a DINER-ORIGINATED
// reward claim. Sibling of lib/order-request-accept*.ts, its own file because
// order-request-accept.ts is at its ~300-line budget and this is one
// self-contained concern: turning a stored `requestedRewardAt` INTENT into a
// funded reward at the moment the Order is minted.
//
// Everything here routes through lib/reward-claim.ts — the ONE place a claim
// becomes funded — so the QR path can never grow its own copy of the money
// fence. What is NOT here: the add-round case. A diner add-round onto a tab
// that already carries a reward keeps the tab's existing one
// (order-request-accept-addround.ts re-derives it from the Order snapshot);
// claiming a SECOND reward onto one bill is refused there, because an Order
// carries one scalar and one kind.

// Staff-actionable copy for the one case a resolved claim still fails to
// SPEND: another device redeemed the same stamps between this diner's submit
// and staff tapping accept. The bill the diner consented to had the reward on
// it, so the honest outcome is a rejection they can re-order from — never a
// silent full-price order, and never a discounted bill funded by nothing.
export const REWARD_UNFUNDED_ERROR =
  "Those stamps were already used on another order — reject this request and ask the customer to order again";

export interface AcceptRewardResolution {
  reward: RedeemedReward;
  cost: number;
  customerId: string;
  // Present only for a kind:"item" rung — the free dish, already stamped with
  // kotRound 1 (an accept-created order is always on its first round), ready
  // to splice into the items array before pricing.
  line?: ResolvedRewardOrderItem;
  // CB-5D part 2 — present only when the claimed rung mints a promo code
  // (buildRewardAssignment returned something). Carried through unchanged to
  // claimAcceptReward so the code lands in the SAME update as the stamp
  // debit — see reward-redemption.ts's own comment on why that must be one
  // write, not two.
  assignment?: RewardAssignment;
}

/**
 * Resolve a stored reward intent WITHOUT spending anything, for the
 * create/parcel branch of the accept bridge.
 *
 * Returns `undefined` when there is nothing to claim — and, deliberately, ALSO
 * when the intent no longer RESOLVES: the owner retuned the rung away, the
 * balance was spent elsewhere, or the bill drifted below the rung's minBill.
 * A stale intent must not fail the whole accept, because at this point the
 * order is priced WITHOUT the reward anyway: the food order is still valid,
 * the bill is the full-price one, and no stamps are spent — the same outcome
 * as never having asked. Rejecting here would throw away a real order over a
 * loyalty extra.
 *
 * That is DIFFERENT from a claim that resolves and then fails to SPEND
 * (claimAcceptReward returning false). By then the bill has already been
 * priced WITH the reward, so writing it would discount a bill nothing funded —
 * the caller rejects with REWARD_UNFUNDED_ERROR instead.
 *
 * `billTotal` must be the total the bill would carry WITHOUT the reward: the
 * per-milestone minBill gate is about what the customer is spending, not about
 * what the reward is worth.
 */
export async function resolveAcceptReward(
  requestedRewardAt: number | undefined,
  customerId: string | undefined,
  settings: ISettings | null,
  billTotal: number,
): Promise<AcceptRewardResolution | undefined> {
  if (requestedRewardAt === undefined) return undefined;
  // Stamps live on a Customer row. The accept bridge only attaches a customer
  // when one already exists for this mobile, or when ctx.createCustomer mints
  // one — a brand-new row has no stamps, so it simply resolves to nothing
  // below. No customer at all means there is no balance to spend, full stop.
  if (!customerId) return undefined;

  // DEFENCE IN DEPTH on the identity binding. The submit gate
  // (lib/order-request-reward.ts) already refuses a claim whose submitted
  // mobile is not the signed-in diner's own, so the customer resolved here
  // from `request.mobile` IS that diner. This second resolution is the one
  // that actually spends, though, and it reaches the balance by a DIFFERENT
  // route (a mobile lookup, not a session), so it re-derives the decision
  // from the customer's own row rather than inheriting the gate's verdict: a
  // stored intent is data, and by accept time it may be hours old, the row
  // may have been merged, or the balance spent elsewhere. resolveRewardClaim
  // below re-reads the balance and the ladder from live state and refuses on
  // its own if anything no longer holds.

  const resolved = await resolveRewardClaimAndLine(
    {
      settings,
      customerId,
      rewardAt: requestedRewardAt,
      billTotal,
      // Order-taking writer: an item reward IS allowed here (D9 — the free
      // dish must reach the kitchen while the order is being taken, which is
      // exactly what an accept is). The settle path is the one that refuses.
      refuseItemKind: false,
    },
    // An accept-created order is always on its first KOT round, so a free dish
    // fires on the same ticket as the rest of the order.
    1,
  );
  if (!resolved.ok) return undefined;

  // CAPTURED ONCE, here, and never again for this resolution: the accept
  // bridge's create path can retry this same claim against a RE-NUMBERED
  // orderId (recoverOrderCreate), and claimRewardStamps's $addToSet treats the
  // assignment as one whole element — a fresh Date on a retry would make that
  // retry's element unequal to the first attempt's and append a SECOND reward.
  const assignedAt = new Date();
  const assignment = buildRewardAssignment(resolved.claim.milestone, settings?.promoCodes, assignedAt);

  return {
    reward: resolved.claim.reward,
    cost: resolved.claim.cost,
    customerId,
    ...(resolved.line ? { line: resolved.line } : {}),
    ...(assignment ? { assignment } : {}),
  };
}

/**
 * Spend the stamps for `orderId`, or report that they could not be spent.
 *
 * THE CLAIM IS KEYED ON THE ORDER ID, and that is load-bearing: the marker
 * `claimRewardStamps` writes into `redeemedOrders` is what the cancel path
 * (S6) looks the refund up by, and what fences a second redemption against the
 * same order. The accept bridge's create path can RE-NUMBER an order when the
 * daily counter collides (recoverOrderCreate), so a claim made once against
 * the first orderId would sit on an id no order carries: the stamps could
 * never be returned, and the real order would no longer be fenced. Each
 * attempt therefore claims for its OWN orderId and hands back what it claimed
 * before the next one begins — the same discipline POST /api/orders uses.
 */
export async function claimAcceptReward(
  resolution: AcceptRewardResolution,
  orderId: string,
): Promise<boolean> {
  return claimRewardStamps(resolution.customerId, orderId, resolution.cost, resolution.assignment);
}

/**
 * Hand back stamps claimed for `orderId`.
 *
 * ONLY ever called on a DEFINITE no-write outcome — a duplicate-key rejection,
 * which is a SERVER RESPONSE proving the insert was received and refused.
 * never-revert-on-write-throw is DIRECTIONAL: before the write lands, only a
 * definite no-write may reverse a claim; a bare throw (socket timeout, primary
 * step-down) may well accompany an insert that COMMITTED, and returning stamps
 * there would credit a diner for a reward the landed order still carries.
 */
export async function returnAcceptReward(
  resolution: AcceptRewardResolution,
  orderId: string,
): Promise<void> {
  await returnRewardStamps(resolution.customerId, orderId, resolution.cost, resolution.assignment);
}

/** The five-plus snapshot fields for the Order doc, or nothing. */
export function acceptRewardSnapshot(
  resolution: AcceptRewardResolution | undefined,
): Record<string, unknown> {
  return resolution ? rewardSnapshotFields(resolution.reward, resolution.cost) : {};
}
