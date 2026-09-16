import { z } from "zod";
import {
  LOYALTY_MIN_BILL_MIN,
  LOYALTY_MIN_BILL_MAX,
  LOYALTY_REWARD_KINDS,
  LOYALTY_REWARD_PERCENT_MAX,
  LOYALTY_REWARD_FLAT_MAX,
  LOYALTY_REWARD_ITEM_MAX_LEN,
  LOYALTY_REWARD_PRODUCT_ID_RE,
  LOYALTY_REWARD_QTY_MIN,
  LOYALTY_REWARD_QTY_MAX,
  type LoyaltyRewardKind,
} from "../public-diner";
import {
  LOYALTY_RULES_SCHEMA_VERSION,
  LOYALTY_MILESTONES_MAX,
  LOYALTY_MILESTONE_AT_MIN,
  LOYALTY_MILESTONE_AT_MAX,
  LOYALTY_CARD_SIZE_MIN,
  LOYALTY_CARD_SIZE_MAX,
  LOYALTY_UNIT_LABEL_MAX_LEN,
  LOYALTY_CLAIM_WITHIN_DAYS_MIN,
  LOYALTY_CLAIM_WITHIN_DAYS_MAX,
} from "../loyalty-rules";
// CB-5D — the milestone's promoCode reuses the SAME pattern a Settings promo
// code is validated against; re-rolling the regex here would let the two
// definitions drift.
import { PROMO_CODE_PATTERN } from "../public-promo";

// CB-5A S1 — the loyaltyRules Zod contract. Split out of settings.schema.ts
// (that file's own ~300-line budget) alongside `refineLoyaltyReward`, which
// this file also owns (moved verbatim) since both are "the loyalty reward's
// bound depends on its kind" logic — one for the flat CB-4 fields, one
// per-milestone below.

// One milestone reward on the ladder. Mirrors refineLoyaltyReward's own
// kind-dependent bound: "item" requires a non-empty `item` name; otherwise
// `value` must be a positive whole number capped by the percent/flat ceiling.
// `minBill` is OPTIONAL (the promoCodes precedent: an array ITEM may carry
// optional fields even though the CONTAINER below requires every key) — RUPEES,
// never paise, same discipline as settings.schema.ts's own loyaltyMinBill.
const loyaltyMilestoneSchema = z
  .object({
    at: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_MILESTONE_AT_MIN, `Use at least ${LOYALTY_MILESTONE_AT_MIN}`)
      .max(LOYALTY_MILESTONE_AT_MAX, `Keep it under ${LOYALTY_MILESTONE_AT_MAX}`),
    kind: z.enum(LOYALTY_REWARD_KINDS),
    value: z.number().int("Use a whole number").min(0, "Cannot be negative"),
    // Display-only NAME SNAPSHOT of the referenced product, taken when the
    // owner picked it. Kept so a ladder still READS correctly (settings list,
    // diner card) without a menu lookup — but it is never what the server
    // resolves a free dish from. See CB-5B D8 in public-diner.ts.
    item: z.string().trim().max(LOYALTY_REWARD_ITEM_MAX_LEN),
    // CB-5B D8 — the REAL reference. OPTIONAL at the schema level so every
    // pre-D8 row on a live cafe still parses (they carry a name only); the
    // superRefine below is what makes it REQUIRED for kind:"item" going
    // forward, which is the boundary a new/edited row actually crosses.
    itemProductId: z
      .string()
      .trim()
      .regex(LOYALTY_REWARD_PRODUCT_ID_RE, "Pick the free item from the menu")
      .optional(),
    // CB-5B D11 — how many of that dish one claim grants. ABSENT = 1.
    qty: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_REWARD_QTY_MIN, `Use at least ${LOYALTY_REWARD_QTY_MIN}`)
      .max(LOYALTY_REWARD_QTY_MAX, `Keep it under ${LOYALTY_REWARD_QTY_MAX}`)
      .optional(),
    minBill: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_MIN_BILL_MIN, "Cannot be negative")
      .max(LOYALTY_MIN_BILL_MAX, `Keep it under ${LOYALTY_MIN_BILL_MAX}`)
      .optional(),
    // CB-5D — the promo code MINTED for this rung, config-time not
    // claim-time (owner decision): the code itself lives in Settings' own
    // promo list, one place for every code in the cafe. Reuses
    // PROMO_CODE_PATTERN rather than re-rolling it, so a milestone's code and
    // a promo list's code are judged by the exact same shape. OPTIONAL —
    // every stored ladder predates this field.
    promoCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => PROMO_CODE_PATTERN.test(v), "Use 3-16 letters or numbers")
      .optional(),
    // CB-5D — how long after EARNING this rung a diner may still claim it,
    // in whole days. Distinct from the promo code's own `validDays` (how
    // long the ASSIGNED code lives once claimed) — two independent TTLs.
    claimWithinDays: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_CLAIM_WITHIN_DAYS_MIN, `Use at least ${LOYALTY_CLAIM_WITHIN_DAYS_MIN}`)
      .max(LOYALTY_CLAIM_WITHIN_DAYS_MAX, `Keep it under ${LOYALTY_CLAIM_WITHIN_DAYS_MAX}`)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "item") {
      // CB-5B D8 — the PRODUCT REFERENCE is the required half now, not the
      // name. A row that carries a name but no ref is a pre-D8 row being
      // re-saved through the picker, and it must not pass: the server
      // resolves the dish by id, so saving a name-only row would configure a
      // reward that cannot be put on a bill.
      if (data.itemProductId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["itemProductId"],
          message: "Pick the free item from the menu",
        });
      }
      return;
    }
    // A NON-item rung must not carry a dish. Without this, switching a rung
    // from "item" to "flat" leaves a dead itemProductId/qty in the stored doc
    // (the form keeps hidden values — RHF's shouldUnregister defaults false),
    // and switching it BACK re-validates against that stale ref without the
    // owner ever re-picking, so the reference and the display name silently
    // diverge. Rejecting here makes the form clear them on the way out.
    if (data.itemProductId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemProductId"],
        message: "Only a free item reward can have an item",
      });
    }
    if (data.value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Enter a value greater than 0",
      });
      return;
    }
    const max = data.kind === "percent" ? LOYALTY_REWARD_PERCENT_MAX : LOYALTY_REWARD_FLAT_MAX;
    if (data.value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: data.kind === "percent" ? "Percent cannot exceed 100" : `Keep it under ${max}`,
      });
    }
  });

// The array: bounded to LOYALTY_MILESTONES_MAX rows, and a superRefine that
// rejects a duplicate `at` — two rewards can't both sit at the same stamp
// count, since ladderProgress in loyalty-rules.ts can only reach one of them.
const loyaltyMilestonesSchema = z
  .array(loyaltyMilestoneSchema)
  .max(LOYALTY_MILESTONES_MAX, `Keep it under ${LOYALTY_MILESTONES_MAX} rewards`)
  .superRefine((rows, ctx) => {
    const seen = new Set<number>();
    rows.forEach((row, index) => {
      if (seen.has(row.at)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "at"],
          message: "Two rewards cannot sit at the same number of stamps",
        });
      }
      seen.add(row.at);
    });
  });

// loyaltyRules — a NESTED container, same reasoning as appearanceSchema
// (settings-print.schema.ts): it is saved as one whole unit from one form
// panel, and Mongoose $set-replaces a nested path WHOLE, so this schema
// requires EVERY key once the object is present at all.
export const loyaltyRulesSchema = z.object({
  // Pinned to the CURRENT version only — a stale cached admin bundle built
  // against a future store shape must 400, never silently stamp an unknown
  // shape (the appearanceSchema `v` precedent).
  v: z.literal(LOYALTY_RULES_SCHEMA_VERSION),
  unitLabel: z.string().trim().min(1, "Name the unit diners earn").max(LOYALTY_UNIT_LABEL_MAX_LEN),
  milestones: loyaltyMilestonesSchema,
  // CB-5C — the number of boxes on the stamp card. OPTIONAL at the schema
  // level because every doc saved before this field existed carries no
  // `cardSize` at all, and loyaltyRulesSchema otherwise requires every key —
  // making it required would 400 every existing cafe's next save. When absent,
  // ladderOf() falls back to the last reward's `at`, which is exactly the
  // behaviour those docs already have.
  cardSize: z
    .number()
    .int("Use a whole number")
    .min(LOYALTY_CARD_SIZE_MIN, `Use at least ${LOYALTY_CARD_SIZE_MIN}`)
    .max(LOYALTY_CARD_SIZE_MAX, `Keep it under ${LOYALTY_CARD_SIZE_MAX}`)
    .optional(),
});

export type LoyaltyMilestoneInput = z.infer<typeof loyaltyMilestoneSchema>;
export type LoyaltyRulesInput = z.infer<typeof loyaltyRulesSchema>;

// CB-4 — the loyalty reward's BOUND depends on its KIND, and the two are flat
// sibling fields (see their comment above for why flat). A `.superRefine` on
// `settingsSchema` would be DISCARDED by `.partial()` below — ZodEffects does
// not carry refinements through `.partial()` — so the check is applied to the
// partial schema, which is what PUT /api/settings actually validates.
//
// Both fields are optional and independently editable, so the rule only fires
// when a request carries enough to judge: a kind WITH a value. A PUT that
// sends only the value (kind unchanged on the stored doc) cannot be bound-
// checked here, so the reward RESOLVER in the cafe app clamps at use time
// too — the schema is the first fence, never the only one.
export function refineLoyaltyReward(
  data: { loyaltyRewardKind?: LoyaltyRewardKind; loyaltyRewardValue?: number; loyaltyRewardItem?: string },
  ctx: z.RefinementCtx,
): void {
  const { loyaltyRewardKind: kind, loyaltyRewardValue: value } = data;
  if (kind === undefined) return;
  if (kind === "item") {
    if (!data.loyaltyRewardItem || data.loyaltyRewardItem.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loyaltyRewardItem"],
        message: "Name the free item diners get",
      });
    }
    return;
  }
  if (value === undefined) return;
  if (value <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["loyaltyRewardValue"],
      message: "Enter a value greater than 0",
    });
    return;
  }
  const max = kind === "percent" ? LOYALTY_REWARD_PERCENT_MAX : LOYALTY_REWARD_FLAT_MAX;
  if (value > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["loyaltyRewardValue"],
      message: kind === "percent" ? "Percent cannot exceed 100" : `Keep it under ${max}`,
    });
  }
}
