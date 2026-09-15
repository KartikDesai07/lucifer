import { LOYALTY_RULES_SCHEMA_VERSION, LOYALTY_UNIT_LABEL_DEFAULT } from "@pos/shared/loyalty-rules";
import type { LoyaltyRulesInput } from "@/schemas";

// CB-5A S5 — named starting points for the template picker. Every preset is a
// COMPLETE LoyaltyRulesInput (never a blank canvas — loyaltyRulesSchema
// requires every key once the object is present at all, same discipline as
// loyaltyRulesFormDefaults) so `setValue("loyaltyRules", preset.rules, ...)`
// can never hand the form a partially-shaped object. Numbers are kept in the
// industry-safe 6-10 stamp sweet spot — setting the target too high is the
// #1 small-owner mistake this picker exists to prevent.
//
// CB-5D — membership and levels are REMOVED (owner, 2026-09-15): no client
// uses either, and LoyaltyRulesInput no longer carries them, so the
// "membership"/"levels" presets that existed only to demonstrate those
// features are gone too — every remaining preset is a milestone ladder only.

export interface LoyaltyPreset {
  id: string;
  label: string;
  description: string;
  rules: LoyaltyRulesInput;
}

export const LOYALTY_PRESETS: readonly LoyaltyPreset[] = [
  {
    id: "coffee-card",
    label: "Coffee card",
    description: "One stamp card: 8 stamps for ₹50 off the bill. Simple and proven.",
    rules: {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: LOYALTY_UNIT_LABEL_DEFAULT,
      milestones: [{ at: 8, kind: "flat", value: 50, item: "" }],
    },
  },
  {
    id: "points-ladder",
    label: "Points ladder",
    description: "Three rewards on the way to a full card: small treats at 5 and 8 stamps, a bigger one at 10.",
    rules: {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: LOYALTY_UNIT_LABEL_DEFAULT,
      milestones: [
        { at: 5, kind: "flat", value: 20, item: "" },
        { at: 8, kind: "flat", value: 50, item: "" },
        { at: 10, kind: "percent", value: 15, item: "" },
      ],
    },
  },
  {
    id: "scratch",
    label: "Start from scratch",
    description: "A single small reward to begin with — add more once you see how diners use it.",
    rules: {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: LOYALTY_UNIT_LABEL_DEFAULT,
      milestones: [{ at: 6, kind: "flat", value: 30, item: "" }],
    },
  },
] as const;
