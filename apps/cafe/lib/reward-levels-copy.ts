// CB-7 S3 — the plain-English copy of the scratch-card settings editor, in ONE place so every component, the
// form lib and its tests read the same sentences. PURE, client-safe, no imports beyond a type.
// Owner rule: never a Zod path, never a code word — these are the sentences the owner reads.

import type { RewardOptionKind } from "@pos/shared/reward-levels";

// The kind picker lists every kind, all visible at once (owner rule: a pick-one field is a dropdown).
export const REWARD_KIND_LABELS: Record<RewardOptionKind, string> = {
  "bill-percent": "% off the bill",
  "bill-flat": "₹ off the bill",
  "product-percent": "% off one item",
  "category-percent": "% off a category",
  "category-flat": "₹ off a category",
  "free-item": "Free item",
  points: "Points (1 point = ₹1)",
  none: "No reward",
};

// The cost line's example bill; the owner can edit it on screen, it is never saved.
export const REWARD_COST_EXAMPLE_BILL_DEFAULT = 500;

export const SWITCH_LABEL = "Scratch cards";
export const SWITCH_EFFECT =
  "When this is on, diners stop collecting stamps. Stamps and codes they already have still work.";
export const SWITCH_LOCKED = "Scratch cards are not available yet. You can set them up now and switch them on later.";
export const SWITCH_NEEDS_SIGN_IN = "Turn on customer sign-in first. Diners need an account to collect scratch cards.";

// Shown when a level gets more or fewer boxes (or a level is added or removed) while a card may be in progress.
export const POSITION_SHIFT =
  "Changing the number of boxes or levels moves where diners are on their card. Some may land on a different box than they expect.";

// Q7 (owner answer, 2026-10-11): shown under a "No reward" option.
export const NONE_WARNING =
  "Some diners will get nothing. Expect complaints, and a prize where some people win nothing can count as a lottery in some states. Check with a lawyer before you use this.";

export const BLOCKED_TN =
  "Scratch cards are not allowed for cafes in Tamil Nadu (your GST number starts with 33), so they stay switched off.";
export const BLOCKED_PLATFORM = "Scratch cards are switched off for your account. Ask your provider if you think this is a mistake.";

// A stored blob this build cannot read (an unreadable one stays OFF, so the owner must be told).
export const UNREADABLE_NOTICE =
  "The scratch-card setup saved earlier could not be read. Start over to set it up again.";

// Generic fallbacks for a rule the editor could not have broken through its own controls.
export const PROBLEM_FALLBACK_GENERIC = "Check this box. Something in it is not filled in correctly.";
export const PROBLEM_FALLBACK_FIELD: Record<string, string> = {
  min: "Enter the lowest value",
  max: "Enter the highest value",
  weight: "Enter the chance as a whole number",
  qty: "Enter how many",
  capRupees: "Enter the limit in rupees",
  minBill: "Enter the bill amount in rupees",
  productId: "Pick the item from the list",
  productName: "Pick the item from the list",
  categoryId: "Pick the category from the list",
  categoryName: "Pick the category from the list",
  scratchDays: "Enter the days to scratch the card",
  useDays: "Enter the days to use the reward",
  size: "Enter the number of boxes",
  step: "Choose a box number",
  id: "Check this reward",
};
