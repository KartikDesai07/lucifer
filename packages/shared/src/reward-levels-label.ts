// CB-7 — the plain-English line for one reward option (plan §2.2 s86 review A11/B5, S1 item 21).
// Built ONLY from the option's CONFIG (its min–max range, names, qty), never from a rolled value: it lands in the
// card's `pool` (the odds shown before the scratch, F14) and in the editor's reward list, and a rolled value
// there would leak the outcome of a card that is still hidden.
// PURE, client-safe.

import { REWARD_LABEL_MAX_LEN, type RewardOption } from "./reward-levels";
import { inr } from "./utils";

// F9: what a "No reward" box says when the owner left its label blank.
export const REWARD_NONE_LABEL_DEFAULT = "Better luck next time";

const ELLIPSIS = "…";
// An en dash, not a hyphen: "5–15%" reads as a range, "5-15%" reads like a typo.
const RANGE_DASH = "–";

// "10" when the owner fixed one value (min === max), "5–15" for a range.
function span(min: number, max: number, format: (n: number) => string): string {
  return min === max ? format(min) : `${format(min)}${RANGE_DASH}${format(max)}`;
}

const percent = (n: number): string => `${n}`;
const rupees = (n: number): string => inr(n);

function rawLabel(option: RewardOption): string {
  switch (option.kind) {
    case "bill-percent":
      return `${span(option.min, option.max, percent)}% off the bill`;
    case "bill-flat":
      return `${span(option.min, option.max, rupees)} off the bill`;
    case "product-percent":
      return `${span(option.min, option.max, percent)}% off one ${option.productName}`;
    case "category-percent":
      return `${span(option.min, option.max, percent)}% off ${option.categoryName}`;
    case "category-flat":
      return `${span(option.min, option.max, rupees)} off ${option.categoryName}`;
    case "free-item":
      return option.qty > 1 ? `${option.qty} × Free ${option.productName}` : `Free ${option.productName}`;
    case "points":
      return option.min === 1 && option.max === 1 ? "1 point" : `${span(option.min, option.max, percent)} points`;
    case "none":
      return option.label?.trim() || REWARD_NONE_LABEL_DEFAULT;
  }
}

export function optionLabel(option: RewardOption): string {
  const label = rawLabel(option);
  if (label.length <= REWARD_LABEL_MAX_LEN) return label;
  return `${label.slice(0, REWARD_LABEL_MAX_LEN - ELLIPSIS.length)}${ELLIPSIS}`;
}
