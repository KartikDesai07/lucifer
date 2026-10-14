import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import type { ISettings } from "@/models/Settings";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { readDinerSession } from "@/lib/diner-session";
import { dinerAccountsOn } from "@/lib/diner-route-guard";
import { hasOpenTabNow } from "@/lib/order-request-intake";
import { readPointsStateOf } from "@/lib/reward-cards-read";
import { canonicalPromoMobile } from "@pos/shared/public";
import { POINTS_NEED_SIGN_IN, POINTS_NONE_TO_USE } from "@pos/shared/public-diner-cards";
import { PROMO_BLOCKS_REWARD, REWARD_ON_OPEN_TAB } from "@pos/shared/public-promo";
import { pointsBalance } from "@pos/shared/reward-levels-engine";
import { POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";

// CB-7 S6 session 2 (owner O2(a)) — the DINER-ORIGINATED "Use my points" ASK's quote-time gate. Sibling of
// lib/order-request-card.ts (same identity rules, restated: a points ask is a different spend).
//
// WHAT THIS IS NOT: it is NOT the spend and it carries no amount. The order stores only the ASK (a hint); the counter's
// payment popup pre-ticks points and staff confirm and spend at payment. This gate only spares a diner from being told
// "your points will apply" when they cannot. It never writes, and it deliberately does NOT consult the Reward Levels
// earning gate or the scratch-card block: points already held stay usable while levels are off.

export type PointsIntentResult = { requestedPoints?: true } | { error: string };

/**
 * Decide whether this submission may CARRY a points ask. Gates, in this order (each is a thing the diner can act on):
 *  1. Nothing asked -> nothing to check.
 *  2. A promo code is also present -> PROMO_BLOCKS_REWARD (one reward per bill).
 *  3. A stamp rung or a scratch card is also requested -> POINTS_REWARD_EXCLUSIVE (a bill carries ONE reward).
 *  4. A DINER SESSION IS REQUIRED: points live on a Customer row and the body's `mobile` is typed text, never identity.
 *  5. IDENTITY BINDING: the session's mobile and the body's mobile must be one number (canonical compare), AND the
 *     customer that number finds (the accept's own lookup) must be the session's row.
 *  6. A table with a bill already running is refused (the add-round branch never carries the ask).
 *  7. Diner accounts off -> nothing to use.
 *  8. A zero (or unreadable) balance -> nothing to use. Identity is the SESSION's customerId only.
 */
export async function resolveRequestPoints(
  data: CreatePublicOrderRequestInput,
  settings: ISettings | null,
): Promise<PointsIntentResult> {
  if (data.requestedPoints !== true) return {};

  if (data.promoCode) return { error: PROMO_BLOCKS_REWARD };
  if (data.requestedRewardAt !== undefined || data.requestedCardId !== undefined) {
    return { error: POINTS_REWARD_EXCLUSIVE };
  }

  const session = await readDinerSession();
  if (!session) return { error: POINTS_NEED_SIGN_IN };
  // BOTH sides canonicalised, exactly like the card gate.
  if (canonicalPromoMobile(data.mobile) !== canonicalPromoMobile(session.mobile)) {
    return { error: POINTS_NEED_SIGN_IN };
  }
  // The accept attaches the order's customer by THIS number (the same lookup), so it must still be the session's own
  // row: a session left over from an admin number change would otherwise pre-tick another customer's points.
  const owner = await Customer.findOne({ mobile: data.mobile }).select("_id").lean();
  if (!owner || String(owner._id) !== session.customerId) return { error: POINTS_NEED_SIGN_IN };

  if (data.target.kind === "table") {
    const table = await Table.findOne({ publicToken: data.target.token }).select("tableNo").lean();
    // No table resolves only for a bad token, which the route rejects before this gate runs.
    if (table && (await hasOpenTabNow(table.tableNo))) return { error: REWARD_ON_OPEN_TAB };
  }

  if (!dinerAccountsOn(settings)) return { error: POINTS_NONE_TO_USE };
  const state = await readPointsStateOf(session.customerId);
  if (!state || pointsBalance(state.rewardCards, new Date()) <= 0) return { error: POINTS_NONE_TO_USE };
  return { requestedPoints: true };
}
