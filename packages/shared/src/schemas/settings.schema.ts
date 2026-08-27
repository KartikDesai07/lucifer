import { z } from "zod";
import {
  GST_MODES,
  IMAGE_REF_MAX_LEN,
  SETTINGS_FSSAI_MAX_LEN,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
} from "../constants";
import {
  SELF_ORDER_MODES,
  PROMO_CODE_MAX,
  PROMO_CODE_PATTERN,
  PROMO_KINDS,
  normalizePromoCode,
} from "../public";
import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  APPEARANCE_SCHEMA_VERSION,
} from "../appearance";
import { HEX_COLOR_PATTERN, checkAccent } from "../appearance-contrast";

// Where a day's slip numbering begins. A whole number: a fractional or negative
// "start" would print as a fraction on every slip that day.
const numberStartSchema = z
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
  })
  .superRefine((data, ctx) => {
    if (data.kind === "percent" && data.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Percent cannot exceed 100" });
    }
  });

// The array itself: bounded to PROMO_CODE_MAX codes per cafe, and a
// superRefine that rejects a duplicate code (case-insensitively — the item
// schema above has already uppercased every entry by the time this runs).
// OPTIONAL, no `required`, no default: an existing Settings doc (and every
// test fixture) has never carried this field, and a required addition here
// broke fixtures once before (see the field's own comment on settingsSchema).
const promoCodesSchema = z
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
const appearanceSchema = z
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

// Restaurant + receipt settings (singleton). No `.default()` here so input ===
// output and the settings form can type useForm<z.infer<...>> directly; the
// stored defaults live in models/Settings.ts and the GET endpoint.
export const settingsSchema = z.object({
  restaurantName: z.string().trim().min(1, "Restaurant name is required").max(60),
  tagline: z.string().trim().max(80),
  mobile: z.string().trim().max(20),
  address: z.string().trim().max(200),
  receiptHeader: z.string().trim().max(200),
  receiptFooter: z.string().trim().max(120),
  gstEnabled: z.boolean(),
  gstNumber: z.string().trim().max(20),
  gstRate: z.number().min(0, "Rate cannot be negative").max(100, "Rate cannot exceed 100%"),
  gstMode: z.enum(GST_MODES),
  logo: z.string().trim().max(IMAGE_REF_MAX_LEN),
  // The PRODUCT's own mark (browser tab, login screen) as opposed to `logo`,
  // which is the RESTAURANT's mark (bills, kitchen tickets, sidebar). Two
  // separate slots because they are different images with different audiences —
  // a customer's receipt carries the cafe's brand, the tab carries the app's.
  // Same opaque-ref discipline as `logo`: length-bounded here, interpreted only
  // by lib/images.ts.
  productLogo: z.string().trim().max(IMAGE_REF_MAX_LEN),
  fssai: z.string().trim().max(SETTINGS_FSSAI_MAX_LEN),

  // ── Bill (the customer's slip) ──────────────────────────────────────────
  billShowNumber: z.boolean(),
  billNumberStart: numberStartSchema,
  billShowLogo: z.boolean(),
  billLogoSize: z.enum(PRINT_LOGO_SIZES),
  billShowAddress: z.boolean(),
  billShowMobile: z.boolean(),
  billShowGstNumber: z.boolean(),
  billShowFssai: z.boolean(),
  billPaperWidth: z.enum(PAPER_WIDTHS),
  billFontSize: z.enum(PRINT_FONT_SIZES),

  // ── Kitchen ticket ──────────────────────────────────────────────────────
  // kotShowPrices predates the rest of this block (it is the per-line amount
  // beside each dish); it stays under its original name so no cafe's stored
  // setting is orphaned by the rename.
  kotShowPrices: z.boolean(),
  kotShowTotal: z.boolean(),
  kotShowNumber: z.boolean(),
  kotNumberStart: numberStartSchema,
  kotNumberVoidSlips: z.boolean(),
  kotShowLogo: z.boolean(),
  kotShowRestaurantName: z.boolean(),
  kotShowTable: z.boolean(),
  kotShowStaff: z.boolean(),
  kotShowTime: z.boolean(),
  kotShowNotes: z.boolean(),
  kotPaperWidth: z.enum(PAPER_WIDTHS),
  kotFontSize: z.enum(PRINT_FONT_SIZES),

  // ── Self-order (QR) — CR2 ────────────────────────────────────────────────
  // "approve": a diner-placed order lands as a pending request the staff must
  // accept before it reaches the kitchen. "auto": it fires straight through.
  selfOrderMode: z.enum(SELF_ORDER_MODES),
  // Whether a diner mid-order can switch which table they're ordering for.
  allowTableChange: z.boolean(),
  // Whether the diner's status page shows their earlier orders at this table,
  // not just the one they just placed.
  showPastOrdersToDiner: z.boolean(),

  // ── Promo codes — CR2.2c ─────────────────────────────────────────────────
  // OPTIONAL, no `required`, default absent — see promoCodesSchema's own
  // comment above.
  promoCodes: promoCodesSchema,

  // CR2.3b — Telegram kill switch (§21.6): sends stop, connections stay.
  telegramPaused: z.boolean().optional(),

  // CR2.4 — Appearance. OPTIONAL, no `required`, default absent — same
  // omit-empty precedent as promoCodes above: the overwhelming majority of
  // Settings documents predate this field, and a required addition here
  // would break every one of them (and every fixture) on the next read.
  appearance: appearanceSchema.optional(),
});

// PUT accepts any subset; the form sends the full object.
export const updateSettingsSchema = settingsSchema.partial();

export type SettingsInput = z.infer<typeof settingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
