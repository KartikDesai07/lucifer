import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import type { ISettings } from "@/models/Settings";
import { Table } from "@/models/Table";
import { readDinerSession } from "@/lib/diner-session";
import { hasOpenTabNow } from "@/lib/order-request-intake";
import type { PricedLine } from "@/lib/public-pricing";
import { resolveCardClaim } from "@/lib/reward-card-claim";
import { canonicalPromoMobile } from "@pos/shared/public";
import { PROMO_BLOCKS_REWARD, REWARD_ON_OPEN_TAB } from "@pos/shared/public-promo";
import {
  CARD_BILL_TOO_SMALL,
  CARD_CATEGORY_TOO_BIG,
  CARD_NEEDS_SIGN_IN,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_NOT_USABLE,
  CARD_REWARD_EXCLUSIVE,
} from "@pos/shared/reward-card-use";

// CB-7 S5 (§2.6) — the DINER-ORIGINATED scratch-card claim's quote-time gate. Sibling of lib/order-request-reward.ts
// (the stamp rung's gate; the same identity rules, deliberately restated here because that file is not shared code and
// a card is a different spend).
//
// WHAT THIS IS NOT: it is NOT the spend. Nothing is claimed here and nothing it returns is a grant: a request is
// pre-money (it can be rejected, expire or drift), so a rejected request must cost the diner no card. The claim
// happens at ACCEPT (lib/order-request-accept-reward.ts), against the diner's own Customer row, keyed on the orderId
// that actually lands. This gate exists so a diner is not told a doomed claim "worked" and then billed full price.

export type CardIntentResult = { requestedCardId?: string } | { error: string };

// The refusal copy a diner may be shown, and nothing else: the client (components/public/public-submit.ts
// isRewardErrorMessage) reverts the card pick only for this closed set. resolveCardClaim can also answer with
// staff-facing copy (a free dish that no longer resolves); that never reaches a stranger's phone, it reads as the
// card simply not being usable.
const DINER_CARD_REFUSALS: ReadonlySet<string> = new Set([
  CARD_NOT_USABLE,
  CARD_BILL_TOO_SMALL,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_CATEGORY_TOO_BIG,
]);

/**
 * Decide whether this submission may CARRY a scratch-card intent. Gates, in this order (each is a thing the diner can
 * act on):
 *  1. Nothing asked -> nothing to check.
 *  2. A promo code is also present -> PROMO_BLOCKS_REWARD (one reward per bill; the reciprocal fence for a promo
 *     arriving onto a card tab is the add-round branch's, and the accept's own marker check).
 *  3. A stamp rung is also requested -> CARD_REWARD_EXCLUSIVE (a bill carries ONE reward).
 *  4. A DINER SESSION IS REQUIRED. Cards live on a Customer row; the body's `mobile` is diner-typed text and is never
 *     an identity, so only the session's own customerId is ever used.
 *  5. IDENTITY BINDING: the session's mobile and the body's mobile must be one number (canonical compare). The accept
 *     finds the order's customer by `request.mobile`, so without this a signed-in diner could submit a stranger's
 *     number and have the card spent from the stranger's row.
 *  6. A table with a bill already running is refused: the accept's add-round branch never claims a card, so the diner
 *     would be told "applied" and billed full price. Refused HERE, where they can still be told.
 *  7. resolveCardClaim (read-only): accounts on, the card usable and its minimum met, a scoped card with something
 *     on the bill to discount. `quotedTotal` is the bill BEFORE any reward — the same figure the stamp gate uses.
 */
export async function resolveRequestCard(
  data: CreatePublicOrderRequestInput,
  settings: ISettings | null,
  quotedTotal: number,
  lines: readonly PricedLine[],
): Promise<CardIntentResult> {
  const cardId = data.requestedCardId;
  if (cardId === undefined) return {};

  if (data.promoCode) return { error: PROMO_BLOCKS_REWARD };
  if (data.requestedRewardAt !== undefined) return { error: CARD_REWARD_EXCLUSIVE };

  const session = await readDinerSession();
  if (!session) return { error: CARD_NEEDS_SIGN_IN };
  // BOTH sides canonicalised: data.mobile has been through the schema's transform, the stored session value has not
  // necessarily been (the same comparison as the stamp gate).
  if (canonicalPromoMobile(data.mobile) !== canonicalPromoMobile(session.mobile)) {
    return { error: CARD_NEEDS_SIGN_IN };
  }

  if (data.target.kind === "table") {
    const table = await Table.findOne({ publicToken: data.target.token }).select("tableNo").lean();
    // No table resolves only for a bad token, which the route rejects before this gate runs.
    if (table && (await hasOpenTabNow(table.tableNo))) return { error: REWARD_ON_OPEN_TAB };
  }

  const resolved = await resolveCardClaim({
    settings,
    customerId: session.customerId,
    cardId,
    billTotal: quotedTotal,
    items: lines,
    refuseItemKind: false,
    kotRound: 1,
    now: new Date(),
  });
  if (!resolved.ok) {
    return { error: DINER_CARD_REFUSALS.has(resolved.message) ? resolved.message : CARD_NOT_USABLE };
  }
  return { requestedCardId: cardId };
}
