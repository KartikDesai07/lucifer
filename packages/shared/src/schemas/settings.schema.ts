import { z } from "zod";
import {
  GST_MODES,
  IMAGE_REF_MAX_LEN,
  SETTINGS_FSSAI_MAX_LEN,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  POS_LAYOUTS,
  TABLE_LONG_STAY_MIN_MINUTES,
  TABLE_LONG_STAY_MAX_MINUTES,
} from "../constants";
import {
  PAY_QR_MODES,
  UPI_ID_MAX_LEN,
  UPI_RULES_MAX,
  UPI_RULE_UPTO_MAX,
  isPayQrMinutes,
  isValidUpiId,
} from "../print-qr";
import { SELF_ORDER_MODES } from "../public";
import {
  NUMBER_RESET_MINUTES_MAX,
  NUMBER_RESET_MINUTES_MIN,
  TOKEN_READY_CLEAR_MINUTES_MAX,
  TOKEN_READY_CLEAR_MINUTES_MIN,
} from "../slip-day";
import {
  LOYALTY_STAMPS_MIN,
  LOYALTY_STAMPS_MAX,
  LOYALTY_MIN_BILL_MIN,
  LOYALTY_MIN_BILL_MAX,
  LOYALTY_REWARD_KINDS,
  LOYALTY_REWARD_ITEM_MAX_LEN,
} from "../public-diner";
import { numberStartSchema, promoCodesSchema, appearanceSchema } from "./settings-print.schema";
import { loyaltyRulesSchema, refineLoyaltyReward } from "./settings-loyalty.schema";
import { dinerBannersSchema } from "./settings-diner.schema";
import { billTemplateSchema, kotTemplateSchema, tokenTemplateSchema } from "./print-template.schema";
import { rewardLevelsWriteSchema } from "./reward-levels.schema";

// Restaurant + receipt settings (singleton) — CORE fields only. The print
// (bill/kot) block, promo codes, and Appearance moved to
// `settings-print.schema.ts`; the loyaltyRules ladder contract moved to
// `settings-loyalty.schema.ts` (CB-5A S1, splitting this file under its
// ~300-line budget). Both are re-exported below so every existing import
// specifier (`@pos/shared/schemas`, `./settings.schema`) keeps working
// unchanged.
//
// No `.default()` here so input === output and the settings form can type
// useForm<z.infer<...>> directly; the stored defaults live in
// models/Settings.ts and the GET endpoint.
export const settingsSchema = z.object({
  restaurantName: z.string().trim().min(1, "Restaurant name is required").max(60),
  tagline: z.string().trim().max(80),
  mobile: z.string().trim().max(20),
  address: z.string().trim().max(200),
  receiptHeader: z.string().trim().max(200),
  receiptFooter: z.string().trim().max(120),
  gstEnabled: z.boolean(),
  gstNumber: z.string().trim().max(20),
  // The type message covers a cleared rate box (NaN) — see tableLongStayMinutes.
  gstRate: z
    .number({ invalid_type_error: "Enter the GST rate as a number" })
    .min(0, "Rate cannot be negative")
    .max(100, "Rate cannot exceed 100%"),
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
  // The cafe's UPI ID for the "Scan to pay" QR on bills with money still to pay; "" = not set. The refine sits on
  // the FIELD (a refine on the object would break settingsSchema.partial() in the PUT schema).
  upiId: z
    .string()
    .trim()
    .max(UPI_ID_MAX_LEN)
    .refine((v) => v === "" || isValidUpiId(v), "Enter a UPI ID like yourshop@okaxis"),
  // Amount slabs for the pay QR (print-qr.ts upiRulesOf reads them). OPTIONAL like payQr*; the duplicate check
  // sits on the FIELD, for the same .partial() reason.
  upiRules: z
    .array(
      z
        .object({
          upTo: z
            .number({ invalid_type_error: "Enter the amount as a whole number" })
            .int("Use a whole number of rupees")
            .min(1, "Enter an amount of at least ₹1")
            .max(UPI_RULE_UPTO_MAX, `Keep the amount under ₹${UPI_RULE_UPTO_MAX}`),
          upiId: z
            .string()
            .trim()
            .min(1, "Enter a UPI ID")
            .max(UPI_ID_MAX_LEN)
            .refine(isValidUpiId, "Enter a UPI ID like yourshop@okaxis"),
        })
        .strict(),
    )
    .max(UPI_RULES_MAX, `Use at most ${UPI_RULES_MAX} amount slabs`)
    .refine((rules) => new Set(rules.map((r) => r.upTo)).size === rules.length, "Two slabs have the same amount")
    .optional(),
  // S3b: when a bill prints the pay QR, and for how many minutes after its first print (0 = No limit). OPTIONAL:
  // documents written before S3b have neither, and every reader goes through payQrModeOf / payQrMinutesOf
  // (print-qr.ts), which supply the defaults. The range check sits on the FIELD, for the same .partial() reason.
  payQrMode: z.enum(PAY_QR_MODES).optional(),
  payQrValidMinutes: z
    .number({ invalid_type_error: "Enter the minutes as a whole number" })
    .refine(isPayQrMinutes, "Use 5 to 1440 minutes, or No limit")
    .optional(),

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

  // ── Tokens + daily restart time (S6) ────────────────────────────────────
  // OPTIONAL like payQr*: older documents have none and printConfigOf supplies the defaults (tokens off, start 1,
  // restart at midnight). The range sits on the FIELD so settingsSchema.partial() keeps working.
  tokenEnabled: z.boolean().optional(),
  tokenNumberStart: numberStartSchema.optional(),
  numberResetMinutes: z
    .number({ invalid_type_error: "Choose a time" })
    .int()
    .min(NUMBER_RESET_MINUTES_MIN)
    .max(NUMBER_RESET_MINUTES_MAX)
    .optional(),
  // S8: how long a Ready token stays on the token list (absent = 10 minutes, tokenReadyClearMinutesOf).
  tokenReadyClearMinutes: z
    .number({ invalid_type_error: "Choose a time" })
    .int()
    .min(TOKEN_READY_CLEAR_MINUTES_MIN)
    .max(TOKEN_READY_CLEAR_MINUTES_MAX)
    .optional(),

  // ── Self-order (QR) — CR2 ────────────────────────────────────────────────
  // "approve": a diner-placed order lands as a pending request the staff must
  // accept before it reaches the kitchen. "auto": it fires straight through.
  // "menu" (CB-4): browsing only — ordering is OFF, gated server-side in the
  // public order-request route, never only in the UI.
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

  // ── Diner banners — CB-6C ────────────────────────────────────────────────
  // Owner-written marketing lines shown on the diner Home tab. OPTIONAL, no
  // `.default()` — see settings-diner.schema.ts's own comment.
  dinerBanners: dinerBannersSchema,

  // ── Diner accounts + stamp loyalty — CB-4 ────────────────────────────────
  // FLAT, never a nested `loyalty: {}` subdoc: PUT /api/settings applies a
  // partial $set and nested subdocs are $set-replaced WHOLE (probed, mongoose
  // 8.24 — see models/Settings.ts's own comment), so a nested shape would let
  // one saved card wipe a sibling field. `appearance` is nested only because
  // its schema requires EVERY key whenever it is present; these are
  // independently editable, so flat is the correct shape.
  //
  // ALL OPTIONAL with NO default — the promoCodes/telegram precedent: every
  // pre-CB-4 Settings document and every test fixture predates these, and a
  // required addition here broke fixtures once before.
  dinerAccountsEnabled: z.boolean().optional(),
  loyaltyEnabled: z.boolean().optional(),
  loyaltyStampsPerReward: z
    .number()
    .int("Use a whole number")
    .min(LOYALTY_STAMPS_MIN, `Use at least ${LOYALTY_STAMPS_MIN} stamps`)
    .max(LOYALTY_STAMPS_MAX, `Keep it under ${LOYALTY_STAMPS_MAX} stamps`)
    .optional(),
  // RUPEES, matching the v1 models/Order.ts total the earn site compares it
  // against (NOT the Int32 paise order.ledger shape, which that path never
  // reads). `.int()` deliberately: a rounding-vs-strict-compare mismatch is a
  // known local failure mode, so the value is whole rupees at the schema.
  loyaltyMinBill: z
    .number()
    .int("Use a whole number")
    .min(LOYALTY_MIN_BILL_MIN, "Cannot be negative")
    .max(LOYALTY_MIN_BILL_MAX, `Keep it under ${LOYALTY_MIN_BILL_MAX}`)
    .optional(),
  loyaltyRewardKind: z.enum(LOYALTY_REWARD_KINDS).optional(),
  // What the reward is worth. Its MEANING depends on loyaltyRewardKind, so the
  // bound that applies depends on it too — enforced by the superRefine below
  // rather than here, where the sibling field is not visible.
  loyaltyRewardValue: z.number().int("Use a whole number").min(0, "Cannot be negative").optional(),
  // Only read when loyaltyRewardKind is "item": the free item's name, honoured
  // by staff at the counter (no product link — a reward item need not be a
  // sellable menu row).
  loyaltyRewardItem: z.string().trim().max(LOYALTY_REWARD_ITEM_MAX_LEN).optional(),

  // CR2.3b — Telegram kill switch (§21.6): sends stop, connections stay.
  telegramPaused: z.boolean().optional(),

  // CR2.4 — Appearance. OPTIONAL, no `required`, default absent — same
  // omit-empty precedent as promoCodes above: the overwhelming majority of
  // Settings documents predate this field, and a required addition here
  // would break every one of them (and every fixture) on the next read.
  appearance: appearanceSchema.optional(),

  // CB-5A — the richer milestone-ladder + membership-level loyalty contract.
  // OPTIONAL, no `required`, default absent — same one-section-ownership
  // rule as `appearance`: nested because it is ALWAYS saved as one whole unit
  // from one form panel, so (Mongoose $set-replaces a nested path WHOLE)
  // loyaltyRulesSchema requires every key once the object is present at all.
  // A cafe that never opts into this ladder simply never carries the key.
  loyaltyRules: loyaltyRulesSchema.optional(),

  // UI batch 1 §H — the New Order screen's product-grid arrangement.
  // OPTIONAL, no `.default()` (same promoCodes/telegram precedent above):
  // every Settings document and fixture written before this field predates
  // it, and models/Settings.ts carries the stored "normal" default instead —
  // input === output here so the settings form can type useForm<z.infer<...>>
  // directly.
  posLayout: z.enum(POS_LAYOUTS).optional(),

  // Tables redesign (2026-09-30) — minutes before an occupied table's open bill
  // shows "Long stay" on the live floor. OPTIONAL, no `.default()` (posLayout
  // precedent): models/Settings.ts stores the default. The type message covers
  // a cleared number box (NaN), which would otherwise toast zod's own wording.
  tableLongStayMinutes: z
    .number({ invalid_type_error: "Enter the minutes as a whole number" })
    .int("Use whole minutes")
    .min(TABLE_LONG_STAY_MIN_MINUTES, `At least ${TABLE_LONG_STAY_MIN_MINUTES} minutes`)
    .max(TABLE_LONG_STAY_MAX_MINUTES, `At most ${TABLE_LONG_STAY_MAX_MINUTES} minutes`)
    .optional(),
});

// PUT accepts any subset; the form sends the full object.
//
// Print customization S2: the slip templates are PUT-only keys, deliberately NOT in settingsSchema. A section
// form validates against settingsSchema and sends its section's keys on every save, so a template there would
// either be re-sent through the write gate on each toggle save (a stored template that a later, stricter gate
// rejects would block the page) or, defaulted to null, wipe the design. Each is saved whole and strictly
// (the WRITE schema); null clears it (the route turns null into $unset — undefined never clears over JSON).
//
// CB-7: `rewardLevels` (the scratch-card ladder) is a PUT-only blob for the same reason as the templates: it is
// never in settingsSchema, so the loyalty section form can neither resend it through the write gate nor wipe it
// with a default. It is written whole by the levels editor, strictly; null clears it.
export const updateSettingsSchema = settingsSchema
  .partial()
  .extend({
    billTemplate: billTemplateSchema.nullable().optional(),
    kotTemplate: kotTemplateSchema.nullable().optional(),
    tokenTemplate: tokenTemplateSchema.nullable().optional(),
    rewardLevels: rewardLevelsWriteSchema.nullable().optional(),
  })
  .superRefine(refineLoyaltyReward);

export type SettingsInput = z.infer<typeof settingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export * from "./settings-print.schema";
export * from "./settings-loyalty.schema";
export * from "./settings-diner.schema";
