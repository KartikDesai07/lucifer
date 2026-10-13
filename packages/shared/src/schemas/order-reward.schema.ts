import { z } from "zod";
import { LOYALTY_MILESTONE_AT_MIN, LOYALTY_MILESTONE_AT_MAX } from "../loyalty-rules";
import { PROMO_CODE_PATTERN } from "../public-promo";
import { REWARD_CARD_ID_RE } from "../reward-levels";
import { POINTS_SPEND_MAX } from "../reward-points";

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

// CB-7 S5 (§2.6) — a revealed scratch card, as INTENT ONLY: the card's id on
// the customer's own row. The server reads the card, gates it, resolves its
// money and claims it (lib/reward-card-claim.ts); a client can never send a
// card's value. Sending this AND rewardAt is refused by the writer (one
// reward per bill), not here — the create schema is a superRefine'd object.
export const rewardCardIdSchema = z.string().regex(REWARD_CARD_ID_RE).optional();

// CB-7 S6 (§2.7) — reward points to spend, as INTENT ONLY: a whole number of points (1 point = ₹1). The server spends
// EXACTLY this many off the customer's lots or refuses (409) — it never clamps; a client can never send a rupee amount.
export const rewardPointsSchema = z.number().int().min(1).max(POINTS_SPEND_MAX).optional();

// Spread into createOrderSchema; the add-round schema takes rewardAtSchema + rewardCardIdSchema, the settle schema
// takes settleRewardIntentShape (a promo code only exists at create; points only at create and settle).
export const orderRewardIntentShape = {
  rewardAt: rewardAtSchema,
  rewardCardId: rewardCardIdSchema,
  rewardPoints: rewardPointsSchema,
  promoCode: counterPromoCodeSchema,
};

// The settle's reward INTENT: a stamp rung, a scratch card, or points — the writer refuses more than one.
export const settleRewardIntentShape = {
  rewardAt: rewardAtSchema,
  rewardCardId: rewardCardIdSchema,
  rewardPoints: rewardPointsSchema,
};
