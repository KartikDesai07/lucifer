import type { DiscountKind } from "@pos/shared/constants";

// The add-round discount-kind resolver, split out of order-request-accept-
// addround.ts (S5a, behaviour-preserving move) so that file stops growing.
// order-request-accept-addround.ts re-exports every symbol here.

// CB-5B A2 (owner decision D6) — REWARD AND PROMO ARE MUTUALLY EXCLUSIVE. A
// bill carries one or the other, never both, because an Order has exactly ONE
// scalar `discount` and ONE `discountKind`: composing them would spend the
// diner's stamps into a line the receipt then labels with the other reason.
// The refusal is staff-actionable — the request is rejected and the diner
// re-orders without the code — never a silent merge.
export const REWARD_PROMO_CONFLICT_ERROR =
  "This tab already has a stamp reward applied — reject this request and ask the customer to order again without the promo code";

/**
 * Which `discountKind` an add-round must price and store, from the kind the
 * TAB already carries and the promo this round resolved.
 *
 * Replaces the shipped `keepGstKind` boolean (`openTab.discountKind === "gst"
 * && promo.discount === 0`), which knew only one kind. A `"reward"` tab fell
 * through it to `undefined`, so a public QR add-round `$unset` the kind and
 * re-priced the whole bill at FULL price while the diner's stamps stayed
 * spent — the customer lost the money AND the stamps. That is the same
 * defect class session 34 fixed on all three STAFF re-pricing writers; this
 * is its QR-path twin.
 *
 * - `"reward"` + no promo -> keep `"reward"`; the server re-derives the amount
 *   from the Order's own stored snapshot (never the live ladder).
 * - `"reward"` + a promo -> `"conflict"`. A2/D6: the promo is REFUSED at the
 *   promo-resolution step, not merged. The caller rejects the request.
 * - `"gst"` + no promo -> keep `"gst"` (the shipped C5 meaning, unchanged).
 * - `"gst"` + a promo -> `undefined`: the GST part and the promo collapse into
 *   one plain manual discount, which the receipt honestly labels "Discount"
 *   (the shipped gst+promo precedent — unchanged by S7).
 * - no stored kind -> `undefined`, promo or not (a diner add-round never
 *   ORIGINATES a staff kind).
 */
export type AddRoundKind = DiscountKind | undefined | "conflict";

export function resolveAddRoundKind(
  storedKind: DiscountKind | undefined,
  promoDiscount: number,
  // CB-5D — whether a promo code is PRESENT at all, independent of what it is
  // worth. Load-bearing since PROMO_KINDS gained "item": a free-item promo's
  // money value is 0 BY CONSTRUCTION (its benefit is the free LINE, the same
  // single-skip discipline a reward item uses), so the amount-keyed test below
  // read it as "no promo" and let it compose onto a reward-carrying tab — the
  // exact pair D6 exists to keep apart. The repo's own rule, paid for once
  // already: a fence for a kind whose amount can legitimately be 0 must key on
  // PRESENCE, never on the amount.
  hasPromoCode: boolean,
): AddRoundKind {
  if (storedKind === "reward") return promoDiscount > 0 || hasPromoCode ? "conflict" : "reward";
  // The gst arm stays keyed on AMOUNT only, deliberately: a gst tab and a
  // 0-value item promo COMPOSE (they are not a mutually exclusive pair), so
  // widening this arm would start refusing a combination that is legal today.
  if (storedKind === "gst" && promoDiscount === 0) return "gst";
  return undefined;
}
