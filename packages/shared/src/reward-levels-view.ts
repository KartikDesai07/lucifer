// CB-7 — read-only VIEW helpers over a reward-levels config (plan §2.9 cost line, §2.10 ladder, F7/F14 odds).
// The owner's editor shows "Average ₹A, at most ₹W per card on a ₹500 bill"; the diner's forward ladder shows every
// box with its pool and chances. Both are derived from CONFIG only, never from a rolled card.
// PURE, client-safe. All money here is RUPEES, rounded to 2 decimals for display (never stored).

import type { LevelPosition, RewardLevelsConfig, RewardOption, RewardSlot } from "./reward-levels";
import { positionOf, slotAt } from "./reward-levels-engine";
import { optionLabel } from "./reward-levels-label";

const PERCENT_DIVISOR = 100;
const TOTAL_CHANCE_PERCENT = 100;
const AVERAGE_OF_TWO = 2;
// 2 decimal places: ×100, round, ÷100.
const CENTS_PER_RUPEE = 100;

export interface CostContext {
  exampleBill: number; // rupees — the editor's "on a ₹500 bill"
  priceOf?: (productId: string) => number | undefined; // one unit's price in rupees, undefined = not on the menu
}

export interface OptionCost {
  avg: number;
  worst: number;
  priceKnown: boolean; // false when a product price was needed and not found (its cost shows as ₹0, flagged)
}

const round2 = (n: number): number => Math.round(n * CENTS_PER_RUPEE) / CENTS_PER_RUPEE;
const midpoint = (min: number, max: number): number => (min + max) / AVERAGE_OF_TWO;
const capped = (amount: number, capRupees: number | undefined): number =>
  capRupees === undefined ? amount : Math.min(amount, capRupees);

// The exact mean of min(v, bill) over every whole number v in [min, max], in CLOSED FORM (a flat range can be 100 000
// wide, so no loop): above the range the bill never bites (the midpoint), below it the bill is always the cost, else
// the values up to floor(bill) count as themselves and every larger one as the bill.
function meanFlatCapped(min: number, max: number, bill: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (bill >= hi) return midpoint(lo, hi);
  if (bill <= lo) return bill;
  const k = Math.floor(bill);
  const upTo = ((lo + k) * (k - lo + 1)) / AVERAGE_OF_TWO; // lo + (lo+1) + … + k
  return (upTo + (hi - k) * bill) / (hi - lo + 1);
}

// The exact mean of min(base·v/100, cap) over every whole percent v in [min, max]. Percent is at most 100, so at most
// 101 values — a plain loop.
function meanPercentCapped(min: number, max: number, base: number, capRupees: number | undefined): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  let sum = 0;
  for (let v = lo; v <= hi; v++) sum += capped((base * v) / PERCENT_DIVISOR, capRupees);
  return sum / (hi - lo + 1);
}

export function optionCost(option: RewardOption, ctx: CostContext): OptionCost {
  const bill = ctx.exampleBill;
  switch (option.kind) {
    case "bill-percent":
      return {
        avg: round2((bill * midpoint(option.min, option.max)) / PERCENT_DIVISOR),
        worst: round2((bill * option.max) / PERCENT_DIVISOR),
        priceKnown: true,
      };
    case "bill-flat":
    case "category-flat":
      // category-flat: the whole example bill is treated as that category (the worst case), so a flat amount
      // is only ever limited by the bill itself.
      return {
        avg: round2(meanFlatCapped(option.min, option.max, bill)),
        worst: round2(Math.min(option.max, bill)),
        priceKnown: true,
      };
    case "product-percent": {
      const price = ctx.priceOf?.(option.productId);
      if (price === undefined) return { avg: 0, worst: 0, priceKnown: false };
      // ONE unit of the dish (REWARD_PRODUCT_PERCENT_UNITS), so never more than its price, and never more than the cap.
      const limit = Math.min(price, option.capRupees ?? price);
      return {
        avg: round2(meanPercentCapped(option.min, option.max, price, limit)),
        worst: round2(Math.min((price * option.max) / PERCENT_DIVISOR, limit)),
        priceKnown: true,
      };
    }
    case "category-percent":
      return {
        avg: round2(meanPercentCapped(option.min, option.max, bill, option.capRupees)),
        worst: round2(capped((bill * option.max) / PERCENT_DIVISOR, option.capRupees)),
        priceKnown: true,
      };
    case "free-item": {
      const price = ctx.priceOf?.(option.productId);
      if (price === undefined) return { avg: 0, worst: 0, priceKnown: false };
      const cost = round2(price * option.qty);
      return { avg: cost, worst: cost, priceKnown: true };
    }
    case "points":
      return { avg: round2(midpoint(option.min, option.max)), worst: round2(option.max), priceKnown: true };
    case "none":
      return { avg: 0, worst: 0, priceKnown: true };
  }
}

// The whole box: average weighted by chance, worst = the dearest single option.
export function slotCost(slot: Pick<RewardSlot, "options">, ctx: CostContext): OptionCost {
  const totalWeight = slot.options.reduce((sum, o) => sum + o.weight, 0);
  let weighted = 0;
  let worst = 0;
  let priceKnown = true;
  for (const option of slot.options) {
    const cost = optionCost(option, ctx);
    weighted += cost.avg * option.weight;
    worst = Math.max(worst, cost.worst);
    priceKnown = priceKnown && cost.priceKnown;
  }
  return { avg: totalWeight > 0 ? round2(weighted / totalWeight) : 0, worst: round2(worst), priceKnown };
}

// Whole-number chances in option order that ALWAYS add up to exactly 100 (largest remainder; a tie goes to the
// earlier option) — "34% / 33% / 33%", never "33% / 33% / 33%".
export function optionChances(slot: Pick<RewardSlot, "options">): number[] {
  const weights = slot.options.map((o) => o.weight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  const floors = weights.map((w) => Math.floor((w * TOTAL_CHANCE_PERCENT) / total));
  const leftover = TOTAL_CHANCE_PERCENT - floors.reduce((sum, f) => sum + f, 0);
  // Integer remainder (w·100 mod total) — no float ties to misjudge.
  const byRemainder = weights
    .map((w, index) => ({ index, remainder: (w * TOTAL_CHANCE_PERCENT) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < leftover; i++) floors[byRemainder[i].index] += 1;
  return floors;
}

export interface LadderSlotView {
  step: number;
  labels: string[];
  chances: number[];
}
export interface LadderLevelView {
  levelIndex: number;
  size: number;
  slots: LadderSlotView[];
}
export interface LadderView {
  position: LevelPosition | null;
  filled: number; // boxes already filled in the current level
  levels: LadderLevelView[];
  stepsToNextCard: number | null;
}

// The diner's forward ladder: every level and box with its pool, where they stand, and how many more bills until a
// box that holds a card. `completedSteps` = counted bills so far.
export function ladderView(cfg: Pick<RewardLevelsConfig, "levels">, completedSteps: number): LadderView {
  const position = positionOf(completedSteps + 1, cfg.levels);
  const levels = cfg.levels.map((level, levelIndex) => ({
    levelIndex,
    size: level.size,
    slots: [...level.slots]
      .sort((a, b) => a.step - b.step)
      .map((slot) => ({ step: slot.step, labels: slot.options.map(optionLabel), chances: optionChances(slot) })),
  }));
  return { position, filled: position ? position.step - 1 : 0, levels, stepsToNextCard: stepsToNextCard(cfg, completedSteps) };
}

// The smallest k ≥ 1 whose step number (completedSteps + k) lands on a box. Bounded: past every level once and one
// more lap of the repeating last level covers every box, so no box found by then means there is none.
function stepsToNextCard(cfg: Pick<RewardLevelsConfig, "levels">, completedSteps: number): number | null {
  const { levels } = cfg;
  if (levels.length === 0) return null;
  const bound = levels.reduce((sum, l) => sum + l.size, 0) + levels[levels.length - 1].size;
  for (let k = 1; k <= bound; k++) {
    const pos = positionOf(completedSteps + k, levels);
    if (pos && slotAt(levels, pos)) return k;
  }
  return null;
}
