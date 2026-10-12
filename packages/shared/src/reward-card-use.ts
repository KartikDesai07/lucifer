// CB-7 S5 (§2.6) — using a revealed scratch card on a bill: the ONE contract the cafe server (claim, re-price), the
// staff POS (preview + picker) and the diner cart (picker) share. PURE, client-safe: no DB, no Node APIs, no
// Mongoose — same discipline as reward-redemption.ts.

import type { LoyaltyRewardKind } from "./public-diner";
import { REWARD_PRODUCT_PERCENT_UNITS, type RewardCardSnapshot, type RewardOptionKind } from "./reward-levels";
import { cardStateAt } from "./reward-levels-engine";
import type { RedeemedReward } from "./reward-redemption";

// The kinds a card may be SPENT as on a bill — an allowlist, so a future kind is unusable until it is named here.
// Points lots are spent through §2.7 (S6), never claimed as a card; a "none" card is already used at reveal.
export const REWARD_CARD_USE_KINDS = [
  "bill-percent",
  "bill-flat",
  "product-percent",
  "category-percent",
  "category-flat",
  "free-item",
] as const satisfies readonly RewardOptionKind[];
export type RewardCardUseKind = (typeof REWARD_CARD_USE_KINDS)[number];

export function isCardUseKind(kind: RewardOptionKind): kind is RewardCardUseKind {
  return (REWARD_CARD_USE_KINDS as readonly RewardOptionKind[]).includes(kind);
}

// A category card's product ids are resolved ONCE at claim and snapshotted onto the Order, so the re-pricing writers
// (add-round, settle, void, table move, QR add-round) never re-read the menu. Above this the claim is REFUSED rather
// than silently capped — a cap would bill some of the category's dishes at full price with no word to anyone.
export const REWARD_SCOPE_PRODUCTS_MAX = 200;

// `RedeemedReward.at` for a card. NEVER written to an Order: a card order stores `rewardAt` ABSENT so no rung-keyed
// reader (stamp claim / return / one-reward fence on rewardAt) ever runs for it. It only fills the required field
// of the in-memory snapshot.
export const CARD_REWARD_AT = 0;

// Each usable card kind priced as one of the shipped percent | flat | item money kinds (Order.rewardKind NOT widened).
const MONEY_KIND: Readonly<Record<RewardCardUseKind, LoyaltyRewardKind>> = {
  "bill-percent": "percent",
  "bill-flat": "flat",
  "product-percent": "percent",
  "category-percent": "percent",
  "category-flat": "flat",
  "free-item": "item",
};

export function cardMoneyKind(kind: RewardCardUseKind): LoyaltyRewardKind {
  return MONEY_KIND[kind];
}

// Spendable at `now`: a money kind AND revealed and not past its use-by. Expiry is the engine's strict `>` (the
// deadline instant itself still counts) — every claim CAS mirrors it with `validUntil: {$gte: now}`.
export function cardUsableAt(
  card: Pick<RewardCardSnapshot, "status" | "scratchBy" | "validUntil" | "kind">,
  now: Date,
): boolean {
  return isCardUseKind(card.kind) && cardStateAt(card, now) === "revealed";
}

// F8 — the card's own minimum bill, in RUPEES, against the bill BEFORE any reward (billEarnsStamp parity). A claim
// GATE evaluated once at claim time; never stored on the Order (it is not money).
export function cardMinBillMet(card: Pick<RewardCardSnapshot, "minBill">, billTotalBeforeReward: number): boolean {
  return card.minBill === undefined || billTotalBeforeReward >= card.minBill;
}

export type CardForReward = Pick<
  RewardCardSnapshot,
  "id" | "kind" | "value" | "productId" | "productName" | "categoryName" | "qty" | "capRupees"
>;

/**
 * The money snapshot a card prices as. `categoryProductIds` = the category's product ids resolved ONCE at claim
 * (category kinds only; ignored for every other kind). `null` = not a usable kind, or a scoped kind missing its
 * ref (fail closed: a card that cannot name what it discounts discounts nothing).
 */
export function cardRedeemedReward(
  card: CardForReward,
  categoryProductIds?: readonly string[],
): RedeemedReward | null {
  if (!isCardUseKind(card.kind)) return null;
  const base = { at: CARD_REWARD_AT, kind: MONEY_KIND[card.kind], value: card.value, item: "", cardId: card.id };
  const cap = card.capRupees === undefined ? {} : { capRupees: card.capRupees };
  switch (card.kind) {
    case "bill-percent":
    case "bill-flat":
      return base;
    case "product-percent":
      if (!card.productId) return null;
      return {
        ...base,
        scope: { productIds: [card.productId], maxUnits: REWARD_PRODUCT_PERCENT_UNITS, label: card.productName ?? "" },
        ...cap,
      };
    case "category-percent":
      if (!categoryProductIds) return null;
      return { ...base, scope: { productIds: [...categoryProductIds], label: card.categoryName ?? "" }, ...cap };
    case "category-flat":
      if (!categoryProductIds) return null;
      return { ...base, scope: { productIds: [...categoryProductIds], label: card.categoryName ?? "" } };
    case "free-item":
      if (!card.productId) return null;
      return { ...base, value: 0, item: card.productName ?? "", itemProductId: card.productId, qty: card.qty ?? 1 };
  }
}

// What the staff POS receives for one of a diner's USABLE cards (GET customers/[id]/rewards → `cards`). An
// ALLOWLIST: never a ready card, never pool / optionId / issueKey / usedAt / orderId / weights.
export interface StaffRewardCard {
  id: string;
  kind: RewardCardUseKind;
  value: number;
  label: string; // the plain-English reward, e.g. "20% off Cold Coffee" (same words the diner saw)
  condition: string | null; // the cap / minimum-bill sentence, null when none
  validUntil: number; // epoch ms
  minBill?: number;
  capRupees?: number;
  productId?: string; // product-percent + free-item
  productName?: string;
  qty?: number; // free-item
  categoryName?: string;
  // Category kinds: the category's product ids NOW, for the cart PREVIEW only — the server re-resolves at claim.
  scopeProductIds?: string[];
}

const STAFF_REWARD_CARD_KEY_SET: Readonly<Record<keyof StaffRewardCard, true>> = {
  id: true,
  kind: true,
  value: true,
  label: true,
  condition: true,
  validUntil: true,
  minBill: true,
  capRupees: true,
  productId: true,
  productName: true,
  qty: true,
  categoryName: true,
  scopeProductIds: true,
};
export const STAFF_REWARD_CARD_KEYS = Object.keys(STAFF_REWARD_CARD_KEY_SET) as (keyof StaffRewardCard)[];

/** The preview snapshot for a staff card — the SAME builder the server claims with. */
export function staffCardReward(card: StaffRewardCard): RedeemedReward | null {
  return cardRedeemedReward(card, card.scopeProductIds);
}

// ── Copy (plain English; says what the reader can DO) — shared so server refusals and client classifiers agree ──
export const CARD_NOT_USABLE = "That card can't be used — it has expired or was already used";
export const CARD_BILL_TOO_SMALL = "This bill is too small for that card";
export const CARD_NOTHING_TO_DISCOUNT = "Nothing on this bill matches that card";
export const CARD_ITEM_NOT_AT_SETTLE = "A free-dish card is used when the order is placed, not at payment";
export const CARD_CATEGORY_TOO_BIG = "That card's category has too many dishes — ask the cafe to split it";
export const CARD_NEEDS_SIGN_IN = "Sign in to use your scratch card";
export const ONE_REWARD_PER_BILL = "This bill already has a reward — one reward per bill";
export const REWARD_REASSIGN_REFUSED = "This bill used the customer's reward, so the customer can't be changed";
export const CARD_REWARD_EXCLUSIVE = "Use either a scratch card or a stamp reward on one order, not both";
// G1 — the staff POS: a resumed tab with only sent lines has no round to carry a new reward claim (D9).
export const REWARD_NEEDS_NEW_ITEMS = "Add an item to use a reward — a reward goes on with the next items you send, not at payment";
