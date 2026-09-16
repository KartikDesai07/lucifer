import { z } from "zod";
import {
  IMAGE_REF_MAX_LEN,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
} from "../constants";
import { PROMO_CODE_MAX, PROMO_CODE_PATTERN, PROMO_KINDS, normalizePromoCode } from "../public";
import {
  LOYALTY_REWARD_ITEM_MAX_LEN,
  LOYALTY_REWARD_PRODUCT_ID_RE,
  LOYALTY_REWARD_QTY_MIN,
  LOYALTY_REWARD_QTY_MAX,
} from "../public-diner";
import { LOYALTY_CLAIM_WITHIN_DAYS_MIN, LOYALTY_CLAIM_WITHIN_DAYS_MAX } from "../loyalty-rules";
import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  APPEARANCE_SCHEMA_VERSION,
} from "../appearance";
import { HEX_COLOR_PATTERN, checkAccent } from "../appearance-contrast";

// Split out of settings.schema.ts (S1, CB-5A) to keep that file under the
// ~300-line budget — this file carries the PRINT (bill/kot slip numbering)
// and promo-code contracts, plus the CR2.4 Appearance subdoc. Re-exported
// wholesale from settings.schema.ts so every existing import specifier
// (`@pos/shared/schemas`, `./settings.schema`) keeps working unchanged.

// Where a day's slip numbering begins. A whole number: a fractional or negative
// "start" would print as a fraction on every slip that day.
export const numberStartSchema = z
  .number()
  .int("Use a whole number")
  .min(PRINT_NUMBER_START_MIN, `Start at ${PRINT_NUMBER_START_MIN} or higher`)
  .max(PRINT_NUMBER_START_MAX, `Keep it under ${PRINT_NUMBER_START_MAX}`);

// One configured promo code — normalized to UPPERCASE on the way in (so
// "save10"/"SAVE10" land as the same stored code), then shape-checked against
// PROMO_CODE_PATTERN. `kind:"percent"` is additionally bounded to 1..100 by
// the superRefine below; a base `.positive()` on `value` covers "flat must be
// a money amount > 0" for both kinds.
const promoCodeConfigSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform(normalizePromoCode)
      .refine((v) => PROMO_CODE_PATTERN.test(v), "Use 3-16 letters or numbers"),
    label: z.string().trim().max(40).optional(),
    kind: z.enum(PROMO_KINDS),
    // WHOLE numbers only. computeOrderTotals stores Math.round(discount), so
    // a fractional flat value (49.5 -> stored 50) makes the accept bridge's
    // strict quoted-vs-recomputed compare fail forever: the request could
    // never be accepted and nothing would point at the decimal (review
    // 2026-08-20). Integer minSubtotal also keeps the shortfall message a
    // plain "Add ₹N more", which the diner client matches on.
    value: z.number().int("Use a whole number").positive("Enter a value greater than 0"),
    minSubtotal: z.number().int("Use a whole number").min(0, "Cannot be negative").optional(),
    active: z.boolean(),
    // SPEC P4 — OPTIONAL, absent/false = unlimited (today's behavior). See
    // PromoCodeConfig's own comment (@pos/shared/public) for the full rule.
    oncePerCustomer: z.boolean().optional(),
    // CB-5D — a kind:"item" code's free dish. Same D8 shape as the loyalty
    // milestone's own item rung (settings-loyalty.schema.ts's
    // loyaltyMilestoneSchema): `item` is a display-only name snapshot,
    // `itemProductId` is the REAL reference the server resolves the free
    // line from. Both OPTIONAL — every stored code predates them, and the
    // superRefine below is what makes itemProductId required for kind:"item".
    item: z.string().trim().max(LOYALTY_REWARD_ITEM_MAX_LEN).optional(),
    itemProductId: z
      .string()
      .trim()
      .regex(LOYALTY_REWARD_PRODUCT_ID_RE, "Pick the free item from the menu")
      .optional(),
    // CB-5D — how many of that dish one use of the code grants. ABSENT = 1,
    // mirroring the milestone's own qty default.
    qty: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_REWARD_QTY_MIN, `Use at least ${LOYALTY_REWARD_QTY_MIN}`)
      .max(LOYALTY_REWARD_QTY_MAX, `Keep it under ${LOYALTY_REWARD_QTY_MAX}`)
      .optional(),
    // CB-5D — how many days an ASSIGNED (claimed) code stays usable, counted
    // from assignment, never from configuration. Distinct from the loyalty
    // milestone's own `claimWithinDays` (how long after EARNING a rung it may
    // still be claimed) — reuses the same whole-day bound.
    validDays: z
      .number()
      .int("Use a whole number")
      .min(LOYALTY_CLAIM_WITHIN_DAYS_MIN, `Use at least ${LOYALTY_CLAIM_WITHIN_DAYS_MIN}`)
      .max(LOYALTY_CLAIM_WITHIN_DAYS_MAX, `Keep it under ${LOYALTY_CLAIM_WITHIN_DAYS_MAX}`)
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "percent" && data.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Percent cannot exceed 100" });
    }
    if (data.kind === "item") {
      // Same D8 reasoning as the milestone schema: the PRODUCT REFERENCE is
      // required, not just the display name — the server resolves the free
      // line by id.
      if (data.itemProductId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["itemProductId"],
          message: "Pick the free item from the menu",
        });
      }
    } else if (data.itemProductId !== undefined) {
      // A NON-item code must not carry a dish reference — same stale-ref
      // guard as the milestone schema (switching kind away and back must not
      // silently keep a dish the owner never re-picked for this kind).
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemProductId"],
        message: "Only a free item promo can have an item",
      });
    }
  });

// The array itself: bounded to PROMO_CODE_MAX codes per cafe, and a
// superRefine that rejects a duplicate code (case-insensitively — the item
// schema above has already uppercased every entry by the time this runs).
// OPTIONAL, no `required`, no default: an existing Settings doc (and every
// test fixture) has never carried this field, and a required addition here
// broke fixtures once before (see the field's own comment on settingsSchema).
export const promoCodesSchema = z
  .array(promoCodeConfigSchema)
  .max(PROMO_CODE_MAX, `Keep it under ${PROMO_CODE_MAX} codes`)
  .superRefine((codes, ctx) => {
    const seen = new Set<string>();
    codes.forEach((entry, index) => {
      if (seen.has(entry.code)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "code"], message: "Duplicate promo code" });
      }
      seen.add(entry.code);
    });
  })
  .optional();

// CR2.4 — Appearance (Settings 4th tab: preset, accent, font pair, radius,
// density, logo placement, hero image). Nested (unlike the flat print block
// above) because it is ALWAYS saved as one whole unit from one form panel —
// see models/Settings.ts's file-top comment for why that makes it the
// sanctioned nested subdoc: Mongoose $set-replaces a nested path WHOLE, so
// this schema requires every key once the object is present at all, the same
// way appearanceFormDefaults (apps/cafe/lib/appearance-form.ts) always seeds
// a complete draft rather than a partial one.
export const appearanceSchema = z
  .object({
    // Pinned to the CURRENT version only (A21): a stale cached admin bundle
    // built against a future store shape 400s here rather than silently
    // stamping a v1 document with a shape this version never validated.
    v: z.literal(APPEARANCE_SCHEMA_VERSION),
    presetId: z.enum(PRESET_IDS),
    // "" = use the preset's own accent (Decision 7's empty-string sentinel,
    // never null/undefined). Lowercased so "#ABCDEF"/"#abcdef" store
    // identically — HEX_COLOR_PATTERN itself is lowercase-only.
    accentOverride: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || HEX_COLOR_PATTERN.test(v), "Enter a 6-digit hex color, e.g. #8a4a24"),
    fontPairKey: z.enum(FONT_PAIR_KEYS),
    cornerRadius: z.enum(CORNER_RADII),
    density: z.enum(DENSITIES),
    logoPlacement: z.enum(LOGO_PLACEMENTS),
    // Same opaque-ref length bound as logo/productLogo below — heroImage is
    // another BrandingAsset ref (CR2.4 S4), not free text.
    heroImage: z.string().trim().max(IMAGE_REF_MAX_LEN),
  })
  .superRefine((data, ctx) => {
    if (data.accentOverride === "") return; // "use preset accent" — nothing to gate
    const result = checkAccent(data.accentOverride, data.presetId);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accentOverride"], message: result.failing });
    }
  });
