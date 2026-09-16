import mongoose, { Schema, type Model } from "mongoose";
import {
  GST_MODES,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
} from "@/lib/constants";
import { SELF_ORDER_MODES } from "@pos/shared/public";
import { LOYALTY_REWARD_KINDS } from "@pos/shared/public-diner";
import type { ISettings } from "./settings.types";
import { promoCodeSchema, appearanceMongooseSchema, loyaltyRulesMongooseSchema } from "./settings.subschemas";

// CB-5A S2 — split into settings.types.ts (the ISettings interface) and
// settings.subschemas.ts (the embedded sub-schemas), both re-exported below
// so every existing `@/models/Settings` import keeps resolving unchanged.
// This file keeps the top-level Mongoose schema body + the model export.

export const settingsSchema = new Schema<ISettings>(
  {
    restaurantName: { type: String, default: "", trim: true },
    tagline: { type: String, default: "", trim: true },
    mobile: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    receiptHeader: { type: String, default: "", trim: true },
    receiptFooter: { type: String, default: "", trim: true },
    gstEnabled: { type: Boolean, default: false },
    gstNumber: { type: String, default: "", trim: true },
    gstRate: { type: Number, default: 5, min: 0, max: 100 },
    gstMode: { type: String, enum: [...GST_MODES], default: "inclusive" },
    logo: { type: String, default: "", trim: true },
    // Empty until an admin uploads one; the branding route then serves the
    // product's built-in default mark, so the tab is never blank.
    productLogo: { type: String, default: "", trim: true },
    fssai: { type: String, default: "", trim: true },

    // Bill defaults reproduce exactly what the receipt printed before these
    // toggles existed, so an upgrade changes nothing until someone opts in.
    billShowNumber: { type: Boolean, default: true },
    billNumberStart: { type: Number, default: PRINT_NUMBER_START_MIN, min: PRINT_NUMBER_START_MIN },
    billShowLogo: { type: Boolean, default: true },
    billLogoSize: { type: String, enum: [...PRINT_LOGO_SIZES], default: "medium" },
    billShowAddress: { type: Boolean, default: true },
    billShowMobile: { type: Boolean, default: true },
    billShowGstNumber: { type: Boolean, default: true },
    billShowFssai: { type: Boolean, default: true },
    billPaperWidth: { type: String, enum: [...PAPER_WIDTHS], default: "80mm" },
    // "small" = 12px, the size the bill has always printed at (the KOT's has
    // always been 14px, hence its different default below). Must match the
    // resolver's fallback in lib/print.ts or a newly provisioned cafe and an
    // existing one would print at different sizes.
    billFontSize: { type: String, enum: [...PRINT_FONT_SIZES], default: "small" },

    // Amounts on the kitchen ticket default ON (owner decision 2026-08-16).
    // Only NEW cafes are affected: an existing Settings document already has
    // this field written, and `setDefaultsOnInsert` does not revisit it.
    kotShowPrices: { type: Boolean, default: true },
    kotShowTotal: { type: Boolean, default: true },
    kotShowNumber: { type: Boolean, default: true },
    kotNumberStart: { type: Number, default: PRINT_NUMBER_START_MIN, min: PRINT_NUMBER_START_MIN },
    kotNumberVoidSlips: { type: Boolean, default: true },
    // A kitchen does not need branding, and every printed line costs paper on
    // a ticket that is read once and binned — off unless a cafe asks for it.
    kotShowLogo: { type: Boolean, default: false },
    kotShowRestaurantName: { type: Boolean, default: false },
    kotShowTable: { type: Boolean, default: true },
    kotShowStaff: { type: Boolean, default: true },
    kotShowTime: { type: Boolean, default: true },
    kotShowNotes: { type: Boolean, default: true },
    kotPaperWidth: { type: String, enum: [...PAPER_WIDTHS], default: "80mm" },
    kotFontSize: { type: String, enum: [...PRINT_FONT_SIZES], default: "normal" },

    // Self-order (QR) — CR2. "approve" is the safer default: a cafe that
    // never touches this still has staff accept every order before the
    // kitchen sees it.
    selfOrderMode: { type: String, enum: [...SELF_ORDER_MODES], default: "approve" },
    allowTableChange: { type: Boolean, default: true },
    showPastOrdersToDiner: { type: Boolean, default: true },

    // No `default:` (`default: undefined` suppresses Mongoose's automatic
    // empty-`[]` materialization — see models/Order.ts's sourceRequestIds for
    // the same discipline): an existing Settings doc must keep validating
    // untouched with this key entirely absent.
    promoCodes: { type: [promoCodeSchema], default: undefined },

    // Diner accounts + stamp loyalty — CB-4. FLAT (never nested: see the
    // telegram block's own comment on partial-$set clobbering) and NO
    // `default:` on any of them: absent means "off / use the documented
    // constant", which is what every pre-CB-4 Settings doc and fixture
    // already says by carrying none of these keys. The defaults a NEW cafe
    // sees are supplied by the settings FORM (lib/settings-form-defaults.ts),
    // never by materializing them onto every existing document here.
    dinerAccountsEnabled: { type: Boolean },
    loyaltyEnabled: { type: Boolean },
    loyaltyStampsPerReward: { type: Number },
    // RUPEES — compared against the v1 models/Order.ts total (a plain Number),
    // NOT the Int32 paise order.ledger shape. Do not "convert" this.
    loyaltyMinBill: { type: Number },
    loyaltyRewardKind: { type: String, enum: [...LOYALTY_REWARD_KINDS] },
    loyaltyRewardValue: { type: Number },
    loyaltyRewardItem: { type: String },

    // CR2.3b — Telegram integration (§21.6). No `default:` on any of the 8
    // fields below — omit-empty, mirrors promoCodes above. The two *Enc
    // fields are `select: false` so no plain query (including getSettings()/
    // readSettings()) ever returns them; lib/telegram/config.ts is the only
    // reader, via an explicit `+telegramBotTokenEnc +telegramWebhookSecretEnc`
    // projection.
    telegramBotTokenEnc: { type: String, select: false },
    telegramWebhookSecretEnc: { type: String, select: false },
    telegramBotId: { type: String },
    telegramBotUsername: { type: String },
    telegramValidatedAt: { type: Date },
    telegramWebhookUrl: { type: String },
    telegramWebhookSetAt: { type: Date },
    telegramPaused: { type: Boolean },

    // CR2.4 — Appearance. No `default:` (omit-empty, promoCodes precedent
    // above): an existing Settings doc must keep validating untouched with
    // this key entirely absent.
    appearance: { type: appearanceMongooseSchema, default: undefined },

    // CB-5A — the richer milestone-ladder loyalty contract. No `default:`
    // (omit-empty, promoCodes/appearance precedent above): an existing
    // Settings doc must keep validating untouched with this key entirely
    // absent.
    loyaltyRules: { type: loyaltyRulesMongooseSchema, default: undefined },
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Settings: Model<ISettings> =
  (mongoose.models.Settings as Model<ISettings>) ??
  mongoose.model<ISettings>("Settings", settingsSchema);

export type { ISettings } from "./settings.types";
export * from "./settings.subschemas";
