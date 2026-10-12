import {
  REWARD_SCOPE_PRODUCTS_MAX,
  cardUsableAt,
  isCardUseKind,
  type StaffRewardCard,
} from "@pos/shared/reward-card-use";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { outcomeOf } from "@/lib/reward-cards-view";

// CB-7 S5 — the STAFF-side card list: the ALLOWLIST builder behind GET /api/customers/[id]/rewards `cards`. PURE (no
// model, no DB): the route reads the wallet and the category membership, this decides what the counter may see.
//
// Only revealed cards of a SPENDABLE kind reach the counter (cardUsableAt: revealed, money kind, not past its
// use-by). A ready card, a used card, a points lot and a "none" card are never listed. Every output key is named
// below, one by one, from STAFF_REWARD_CARD_KEYS' set — pool / optionId / issueKey / usedAt / orderId / weights are
// not on this path at all, so a future field on the stored card can never leak by spreading it.

/** The category ids of the wallet's usable category cards — what the route resolves with ONE product query. */
export function staffCardCategoryIds(cards: readonly RewardCardSnapshot[], now: Date): string[] {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!cardUsableAt(card, now)) continue;
    if ((card.kind === "category-percent" || card.kind === "category-flat") && card.categoryId) ids.add(card.categoryId);
  }
  return [...ids];
}

function staffCardOf(card: RewardCardSnapshot, scope: readonly string[] | undefined): StaffRewardCard | null {
  if (!isCardUseKind(card.kind) || !card.validUntil) return null;
  const { label, condition } = outcomeOf(card);
  const isCategory = card.kind === "category-percent" || card.kind === "category-flat";
  // Preview-only scope; the server re-resolves at claim. A category past the claim's own ceiling is REFUSED there
  // (CARD_CATEGORY_TOO_BIG), so listing it would offer a card the counter can never spend.
  if (isCategory && scope && scope.length > REWARD_SCOPE_PRODUCTS_MAX) return null;
  return {
    id: card.id,
    kind: card.kind,
    value: card.value,
    label,
    condition,
    validUntil: card.validUntil.getTime(),
    ...(card.minBill !== undefined ? { minBill: card.minBill } : {}),
    ...(card.capRupees !== undefined ? { capRupees: card.capRupees } : {}),
    ...(card.productId ? { productId: card.productId } : {}),
    ...(card.productName ? { productName: card.productName } : {}),
    ...(card.qty !== undefined ? { qty: card.qty } : {}),
    ...(card.categoryName ? { categoryName: card.categoryName } : {}),
    ...(isCategory ? { scopeProductIds: [...(scope ?? [])] } : {}),
  };
}

/**
 * The counter's list: usable cards only, soonest use-by first (the one about to lapse is the one to offer). `scopeByCategory`
 * maps a category id to its product ids NOW; a category card whose id is missing from it gets an empty scope (the
 * picker then reads "nothing on this bill matches").
 */
export function staffCardsOf(
  cards: readonly RewardCardSnapshot[],
  scopeByCategory: ReadonlyMap<string, readonly string[]>,
  now: Date,
): StaffRewardCard[] {
  const out: StaffRewardCard[] = [];
  for (const card of cards) {
    if (!cardUsableAt(card, now)) continue;
    const built = staffCardOf(card, card.categoryId ? scopeByCategory.get(card.categoryId) : undefined);
    if (built) out.push(built);
  }
  return out.sort((a, b) => a.validUntil - b.validUntil || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
