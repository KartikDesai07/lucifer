import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  GST_MODES,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  type GstMode,
  type PaperWidth,
  type PrintFontSize,
  type PrintLogoSize,
} from "@/lib/constants";
import { SELF_ORDER_MODES, PROMO_KINDS, type SelfOrderMode, type PromoCodeConfig } from "@pos/shared/public";
import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  type AppearanceInput,
} from "@pos/shared/appearance";

// Singleton document — exactly one Settings doc exists for the cafe. Always
// read/write via findOne()/upsert; never create more than one. Holds the
// restaurant identity + receipt customization that the POS receipt and KOT
// render from (Phase 7).
export interface ISettings extends Document {
  restaurantName: string;
  tagline: string;
  mobile: string;
  address: string;
  receiptHeader: string; // extra note shown under the name on the receipt
  receiptFooter: string; // closing line on the receipt
  gstEnabled: boolean;
  gstNumber: string;
  gstRate: number; // percentage, e.g. 5
  gstMode: GstMode; // "inclusive" | "exclusive"
  logo: string; // opaque image ref — the RESTAURANT's mark (bills, KOT, sidebar)
  productLogo: string; // opaque image ref — the PRODUCT's mark (browser tab, login)
  fssai: string; // FSSAI license number, shown on the receipt when set

  // Print customization — one block per printed surface. Flat, not nested:
  // PUT /api/settings applies a partial $set, and a nested object would be
  // replaced wholesale, wiping every sibling toggle on each save. (Nested
  // subdocs ARE $set-replaced WHOLE — probed, mongoose 8.24 — so nesting is
  // only safe when the Zod layer requires every key whenever the object is
  // present at all; `appearance` below, CR2.4 decision 22.0.7, is the
  // sanctioned example that earns nesting on those terms.)
  billShowNumber: boolean;
  billNumberStart: number; // the printed number on the day's first bill
  billShowLogo: boolean;
  billLogoSize: PrintLogoSize;
  billShowAddress: boolean;
  billShowMobile: boolean;
  billShowGstNumber: boolean;
  billShowFssai: boolean;
  billPaperWidth: PaperWidth;
  billFontSize: PrintFontSize;

  kotShowPrices: boolean; // per-line amount beside each dish (pre-dates the block)
  kotShowTotal: boolean;
  kotShowNumber: boolean;
  kotNumberStart: number;
  kotNumberVoidSlips: boolean; // a void slip draws from the same ticket series
  kotShowLogo: boolean;
  kotShowRestaurantName: boolean;
  kotShowTable: boolean;
  kotShowStaff: boolean;
  kotShowTime: boolean;
  kotShowNotes: boolean;
  kotPaperWidth: PaperWidth;
  kotFontSize: PrintFontSize;

  // Self-order (QR) — CR2. See settingsSchema (packages/shared) for the field
  // semantics; the defaults below are what a NEW cafe gets and what a lean
  // read falls back to via the same `settings?.field ?? default` discipline
  // as the print block above.
  selfOrderMode: SelfOrderMode;
  allowTableChange: boolean;
  showPastOrdersToDiner: boolean;

  // Promo codes — CR2.2c. OPTIONAL, no default (omit-empty): the
  // overwhelming majority of Settings docs (and every pre-existing test
  // fixture) predate this field, and a required addition here broke
  // fixtures once before.
  promoCodes?: PromoCodeConfig[];

  // CR2.3b — Telegram integration (phase-CR2-public-ordering.md §21.6). Flat
  // (never nested: PUT /api/settings applies a partial $set — nested subdocs
  // are $set-replaced WHOLE; see `appearance` below, CR2.4, for the one case
  // where a Zod layer requiring every key makes nesting safe). All OPTIONAL
  // with NO default — every existing Settings doc and test fixture predates
  // them (promoCodes precedent above). The two *Enc fields are sealed
  // envelopes (lib/telegram/secret.ts) AND `select: false`, the Staff-
  // password discipline: no route can echo what no query returns. Only
  // lib/telegram/config.ts may ask for them with an explicit `+` projection.
  telegramBotTokenEnc?: string;
  telegramWebhookSecretEnc?: string;
  telegramBotId?: string; // from getMe — not secret
  telegramBotUsername?: string; // getMe.username is schema-optional upstream — may be absent
  telegramValidatedAt?: Date;
  telegramWebhookUrl?: string;
  telegramWebhookSetAt?: Date;
  telegramPaused?: boolean; // kill switch: absent/false = sends flow

  // CR2.4 — Appearance (Settings 4th tab: preset/accent/font pair/radius/
  // density/logo placement/hero image). OPTIONAL, no default (omit-empty,
  // same precedent as promoCodes/telegram* above): every pre-CR2.4 document
  // predates it. Read through `resolveAppearance` (@pos/shared/appearance),
  // never off this raw field — that is the ONE function that turns an absent
  // or partial value into the documented defaults.
  appearance?: AppearanceInput;

  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Settings` export below stays for the live v1 routes.
// One configured promo code — embedded, never saved independently, so
// `_id:false` (mirrors productVariationSchema/orderRequestItemSchema).
const promoCodeSchema = new Schema<PromoCodeConfig>(
  {
    code: { type: String, required: true },
    label: { type: String },
    kind: { type: String, enum: [...PROMO_KINDS], required: true },
    value: { type: Number, required: true },
    minSubtotal: { type: Number },
    active: { type: Boolean, required: true },
    // SPEC P4 — no default (omit-empty), matching every other optional field
    // on this embedded row.
    oncePerCustomer: { type: Boolean },
  },
  { _id: false },
);

// CR2.4 — Appearance. `_id:false` (mirrors promoCodeSchema above). Closed
// fields are `required: true`: appearanceSchema (packages/shared) already
// requires every key whenever the object is present at all, and the WHOLE
// subdoc is what carries `default: undefined` below — never a per-field
// default here. accentOverride/heroImage must NOT carry `required`: "" is
// their documented sentinel (22.0.7 — "use preset accent" / "no hero") and
// Mongoose's String `required` rejects "" (probed: route PUTs with
// runValidators 500'd on every default-accent save). Their presence is
// enforced by the Zod all-keys rule, like `logo`/`productLogo` above.
const appearanceMongooseSchema = new Schema<AppearanceInput>(
  {
    v: { type: Number, required: true },
    presetId: { type: String, enum: [...PRESET_IDS], required: true },
    accentOverride: { type: String, trim: true },
    fontPairKey: { type: String, enum: [...FONT_PAIR_KEYS], required: true },
    cornerRadius: { type: String, enum: [...CORNER_RADII], required: true },
    density: { type: String, enum: [...DENSITIES], required: true },
    logoPlacement: { type: String, enum: [...LOGO_PLACEMENTS], required: true },
    heroImage: { type: String, trim: true },
  },
  { _id: false },
);

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
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Settings: Model<ISettings> =
  (mongoose.models.Settings as Model<ISettings>) ??
  mongoose.model<ISettings>("Settings", settingsSchema);
