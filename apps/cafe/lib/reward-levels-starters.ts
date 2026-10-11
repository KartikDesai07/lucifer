// CB-7 S3 — the ready-made setups an owner can start from (owner answer Q4) and the "Copy my stamp rewards" helper.
// A starter is a plain config the owner then edits like any other; none is ever saved by itself, and none is ever
// switched on (enabled stays false). PURE, client-safe: no Mongoose, no node:crypto, never reward-levels-config.

import {
  LOYALTY_CARD_SIZE_DEFAULT,
  ladderOf,
  type LoyaltyMilestoneLike,
  type ResolvedMilestone,
} from "@pos/shared/loyalty-rules";
import { LOYALTY_REWARD_PRODUCT_ID_RE } from "@pos/shared/public-diner";
import {
  REWARD_FLAT_MAX,
  REWARD_FLAT_MIN,
  REWARD_LEVELS_SCHEMA_VERSION,
  REWARD_LEVEL_SIZE_MAX,
  REWARD_NAME_MAX_LEN,
  REWARD_PERCENT_MAX,
  REWARD_PERCENT_MIN,
  REWARD_QTY_MAX,
  REWARD_QTY_MIN,
  type RewardLevel,
  type RewardLevelsConfig,
  type RewardOption,
  type RewardSlot,
} from "@pos/shared/reward-levels";
import {
  REWARD_SCRATCH_DAYS_DEFAULT,
  REWARD_USE_DAYS_DEFAULT,
  minBillValue,
} from "@/lib/reward-levels-edit";

export type RewardStarterId = "quick-5" | "classic-8" | "three-levels";

export interface RewardStarter {
  id: RewardStarterId;
  label: string;
  description: string;
}

export const REWARD_STARTERS: readonly RewardStarter[] = [
  { id: "quick-5", label: "Quick 5", description: "5 boxes. A surprise discount on the 5th bill." },
  { id: "classic-8", label: "Classic 8", description: "8 boxes. A ₹ discount on the 4th bill and a bigger % on the 8th." },
  { id: "three-levels", label: "Three levels", description: "5, then 8, then 10 boxes, with bigger rewards at each step up." },
];

// ── Builders ─────────────────────────────────────────────────────────────────

const percentOption = (min: number, max: number): RewardOption => ({ id: "o1", kind: "bill-percent", weight: 1, min, max });
const flatOption = (min: number, max: number): RewardOption => ({ id: "o1", kind: "bill-flat", weight: 1, min, max });

const boxOf = (step: number, option: RewardOption): RewardSlot => ({
  step,
  scratchDays: REWARD_SCRATCH_DAYS_DEFAULT,
  useDays: REWARD_USE_DAYS_DEFAULT,
  options: [option],
});

const STARTER_LEVELS: Record<RewardStarterId, () => RewardLevel[]> = {
  "quick-5": () => [{ size: 5, slots: [boxOf(5, percentOption(5, 15))] }],
  "classic-8": () => [
    { size: LOYALTY_CARD_SIZE_DEFAULT, slots: [boxOf(4, flatOption(20, 50)), boxOf(8, percentOption(10, 20))] },
  ],
  "three-levels": () => [
    { size: 5, slots: [boxOf(5, percentOption(5, 10))] },
    { size: 8, slots: [boxOf(4, flatOption(20, 40)), boxOf(8, percentOption(10, 15))] },
    { size: 10, slots: [boxOf(10, percentOption(15, 20))] },
  ],
};

// `minBill` is the cafe-wide "bills of at least ₹X count" the owner already set (0 / NaN / blank = every bill counts).
export function starterConfig(id: RewardStarterId, minBill: number | undefined): RewardLevelsConfig {
  const bill = minBillValue(minBill);
  return {
    v: REWARD_LEVELS_SCHEMA_VERSION,
    enabled: false,
    ...(bill !== undefined ? { minBill: bill } : {}),
    levels: STARTER_LEVELS[id](),
  };
}

// ── Copy my stamp rewards ────────────────────────────────────────────────────

// The slice of the stamp card's rules the copy reads (the form's `loyaltyRules` value, or the stored one).
export interface StampRulesLike {
  milestones?: readonly LoyaltyMilestoneLike[] | null;
  cardSize?: number | null;
}

export interface CopyResult {
  /** The copied setup (one level), or null when nothing could be copied — the first note then says why. */
  config: RewardLevelsConfig | null;
  /** Plain sentences about what was left out or could not be done. */
  notes: string[];
}

const wholeInRange = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

// One stamp reward as a scratch-card reward: % → % off the bill, ₹ → ₹ off the bill, a menu item → a free item.
// Returns the reward, or a note saying why that box is left out.
function optionFromMilestone(m: ResolvedMilestone): { option: RewardOption } | { skip: string } {
  const billPart = minBillValue(m.minBill ?? undefined);
  const withBill = billPart !== undefined ? { minBill: billPart } : {};
  if (m.kind === "percent" || m.kind === "flat") {
    const percent = m.kind === "percent";
    const [min, max] = percent ? [REWARD_PERCENT_MIN, REWARD_PERCENT_MAX] : [REWARD_FLAT_MIN, REWARD_FLAT_MAX];
    if (!wholeInRange(m.value, min, max)) return { skip: `Box ${m.at}: its reward was left out because its value does not fit a scratch card.` };
    return { option: { id: "o1", kind: percent ? "bill-percent" : "bill-flat", weight: 1, min: m.value, max: m.value, ...withBill } };
  }
  const productId = (m.itemProductId ?? "").trim().toLowerCase();
  if (!LOYALTY_REWARD_PRODUCT_ID_RE.test(productId)) {
    return { skip: `Box ${m.at}: the free item was left out because it is not picked from your menu. Pick it from the menu to add it.` };
  }
  const qty = m.qty;
  if (!wholeInRange(qty, REWARD_QTY_MIN, REWARD_QTY_MAX)) return { skip: `Box ${m.at}: the free item was left out because its quantity does not fit a scratch card.` };
  const productName = m.item.trim().slice(0, REWARD_NAME_MAX_LEN) || "Item";
  return { option: { id: "o1", kind: "free-item", weight: 1, productId, productName, qty, ...withBill } };
}

// The stamp card is one cycle of N boxes with rewards on some; that is exactly one level. A box's promo code and a
// name-only free item have no scratch-card equivalent, so they are named in a note instead of being dropped silently.
export function copyStampRewards(rules: StampRulesLike | null | undefined, minBill: number | undefined): CopyResult {
  const ladder = ladderOf(rules?.milestones ?? [], rules?.cardSize);
  if (ladder.milestones.length === 0) {
    return { config: null, notes: ["Your stamp card has no rewards yet, so there is nothing to copy."] };
  }
  if (ladder.cycleLength > REWARD_LEVEL_SIZE_MAX) {
    return {
      config: null,
      notes: [
        `Your stamp card has ${ladder.cycleLength} boxes, and a scratch-card level can have at most ${REWARD_LEVEL_SIZE_MAX}. Start from a ready-made setup instead.`,
      ],
    };
  }
  const notes: string[] = [];
  const slots: RewardSlot[] = [];
  for (const m of ladder.milestones) {
    const made = optionFromMilestone(m);
    if ("skip" in made) notes.push(made.skip);
    else {
      const days = m.claimWithinDays ?? REWARD_USE_DAYS_DEFAULT;
      slots.push({ step: m.at, scratchDays: REWARD_SCRATCH_DAYS_DEFAULT, useDays: days, options: [made.option] });
    }
    if (m.promoCode) notes.push(`Box ${m.at}: its promo code was not copied. Scratch cards cannot hand out promo codes.`);
  }
  const bill = minBillValue(minBill);
  const config: RewardLevelsConfig = {
    v: REWARD_LEVELS_SCHEMA_VERSION,
    enabled: false,
    ...(bill !== undefined ? { minBill: bill } : {}),
    levels: [{ size: ladder.cycleLength, slots }],
  };
  return { config, notes };
}
