import { z } from "zod";
import { LOYALTY_MILESTONE_AT_MIN, LOYALTY_MILESTONE_AT_MAX } from "../loyalty-rules";
import { PROMO_CODE_PATTERN } from "../public-promo";

// The reward/promo INTENT fields of the order request schemas, split out of
// order.schema.ts (S5a, behaviour-preserving move). Same chains, same fences.

// CB-5B S4/S5 — the reward claim, as INTENT ONLY: the stamp COST of the rung
// the diner is redeeming, which is an identifier into the OWNER-configured
// ladder, never an amount. The server resolves the value/kind/dish from
// Settings and spends the stamps off the customer's own row
// (lib/reward-claim.ts). This is the same MONEY FENCE the item schema above
// states: a client that could send a reward AMOUNT could grant itself an
// unfunded discount. Bounded by the ladder's own limits so a nonsense value
// is rejected at the edge rather than scanned for.
export const rewardAtSchema = z
  .number()
  .int()
  .min(LOYALTY_MILESTONE_AT_MIN)
  .max(LOYALTY_MILESTONE_AT_MAX)
  .optional();

// CB-5D part 2 — the COUNTER's promo code, INTENT ONLY, exactly like
// `rewardAt` above: the staff type a code, never an amount. The server
// re-resolves it against the cafe's own promo list and computes the
// discount itself (lib/order-request-accept-promo.ts's resolveAcceptPromo),
// so a client that lies about the value cannot grant an unfunded discount.
// Normalised here (trim+uppercase) so the route compares one spelling, the
// same transform the milestone's own promoCode field uses.
export const counterPromoCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => PROMO_CODE_PATTERN.test(v), "Use 3-16 letters or numbers")
  .optional();

// Spread into createOrderSchema; the add-round and settle schemas take
// rewardAtSchema alone (a promo code only exists at create).
export const orderRewardIntentShape = {
  rewardAt: rewardAtSchema,
  promoCode: counterPromoCodeSchema,
};
