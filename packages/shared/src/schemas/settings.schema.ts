import { z } from "zod";
import {
  GST_MODES,
  IMAGE_REF_MAX_LEN,
  SETTINGS_FSSAI_MAX_LEN,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
} from "../constants";
import { SELF_ORDER_MODES } from "../public";
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
});

// PUT accepts any subset; the form sends the full object.
export const updateSettingsSchema = settingsSchema.partial().superRefine(refineLoyaltyReward);

export type SettingsInput = z.infer<typeof settingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export * from "./settings-print.schema";
export * from "./settings-loyalty.schema";
export * from "./settings-diner.schema";
