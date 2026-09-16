import {
  LOYALTY_REWARD_KIND_DEFAULT,
  LOYALTY_REWARD_VALUE_DEFAULT,
  LOYALTY_STAMPS_DEFAULT,
} from "@pos/shared/public-diner";
import {
  LOYALTY_RULES_SCHEMA_VERSION,
  LOYALTY_UNIT_LABEL_DEFAULT,
  LOYALTY_CARD_SIZE_DEFAULT,
} from "@pos/shared/loyalty-rules";
import type { LoyaltyRulesInput } from "@pos/shared/schemas";

// CB-5A S4 — the appearanceFormDefaults twin (apps/cafe/lib/appearance-form.ts):
// `settingsSchema.loyaltyRules` requires every key once present, but PUT
// /api/settings `$set`-replaces the whole nested path — a Settings document
// written before this feature has no `loyaltyRules` at all, so seeding the
// Rewards & loyalty tab's defaultValues straight off `settings` would hand
// zodResolver `undefined` for a required field (fails validation on submit)
// and, were a partial object ever sent, would clobber the sub-keys a second
// writer already stored. This file is the one sanctioned resolver the
// Rewards & loyalty section page seeds from — never a second copy of
// "absent means default" logic.

// Only the `loyaltyRules` field, never the whole Settings object — mirrors
// AppearanceSettingsSource in lib/appearance-form.ts for the same reason: the
// server reads a Mongoose document and the client reads the DTO, and binding
// this to either shape would force the other to cast.
type LoyaltyRulesSettingsSource = {
  loyaltyRules?: unknown;
};

// The CB-4 flat fields this section ALSO owns (see settings-sections.ts):
// loyaltyRules is the richer form of the same stamp-card rule those fields
// describe, so a starter ladder derived from them is what "opening the page
// and pressing Save changes nothing" requires.
type Cb4LegacyFields = {
  loyaltyStampsPerReward?: number;
  loyaltyRewardKind?: LoyaltyRulesInput["milestones"][number]["kind"];
  loyaltyRewardValue?: number;
  loyaltyRewardItem?: string;
};

/** Resolves a (possibly absent or partially-shaped) stored `loyaltyRules`
 *  into a COMPLETE `LoyaltyRulesInput` the Rewards & loyalty tab can seed
 *  `defaultValues` from. When `loyaltyRules` is absent, derives a
 *  SAFE STARTER ladder from the CB-4 flat fields — a single milestone at the
 *  cafe's existing `stampsPerReward`, carrying its existing reward — the same
 *  legacy branch `resolveLoyaltyConfig` (lib/diner-loyalty.ts) derives from,
 *  so this never re-rolls that math, only mirrors its shape as form defaults. */
// The card size an existing (pre-CB-5C) ladder is effectively already using:
// its last reward's `at`, which is exactly what ladderOf() derives when no
// cardSize is stored. Falls back to the default only for an empty ladder,
// where there is no cycle to preserve.
function cardSizeFromRows(rows: LoyaltyRulesInput["milestones"] | undefined): number {
  if (!Array.isArray(rows) || rows.length === 0) return LOYALTY_CARD_SIZE_DEFAULT;
  const highest = rows.reduce((max, row) => (typeof row?.at === "number" && row.at > max ? row.at : max), 0);
  return highest > 0 ? highest : LOYALTY_CARD_SIZE_DEFAULT;
}

export function loyaltyRulesFormDefaults(
  settings?: (LoyaltyRulesSettingsSource & Cb4LegacyFields) | null,
): LoyaltyRulesInput {
  const rules = settings?.loyaltyRules;

  if (rules === null || typeof rules !== "object") {
    return {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: LOYALTY_UNIT_LABEL_DEFAULT,
      milestones: [
        {
          at: settings?.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT,
          kind: settings?.loyaltyRewardKind ?? LOYALTY_REWARD_KIND_DEFAULT,
          value: settings?.loyaltyRewardValue ?? LOYALTY_REWARD_VALUE_DEFAULT,
          item: settings?.loyaltyRewardItem ?? "",
        },
      ],
      // CB-5C — a brand-new card gets a real size so the grid has boxes to
      // draw. Never below the seeded reward's own `at`, or that reward would
      // sit off the end of the card.
      cardSize: Math.max(
        settings?.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT,
        LOYALTY_CARD_SIZE_DEFAULT,
      ),
    };
  }

  // Present but possibly hand-edited/legacy-shaped: fill every missing key
  // defensively rather than trusting the stored doc, same discipline as
  // resolveAppearance for the `appearance` subdoc.
  const partial = rules as Partial<LoyaltyRulesInput>;
  return {
    v: LOYALTY_RULES_SCHEMA_VERSION,
    unitLabel: partial.unitLabel ?? LOYALTY_UNIT_LABEL_DEFAULT,
    milestones: partial.milestones ?? [],
    // Absent on every doc saved before CB-5C. Derived from the rows rather
    // than defaulted to a constant, so the grid an existing cafe opens matches
    // the cycle its diners are ALREADY on (ladderOf's own fallback) instead of
    // silently resizing their card the first time settings are saved.
    cardSize: partial.cardSize ?? cardSizeFromRows(partial.milestones),
  };
}
