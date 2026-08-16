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
  logo: string; // opaque image ref ("r2:<key>" or a legacy Cloudinary public_id)
  fssai: string; // FSSAI license number, shown on the receipt when set

  // Print customization — one block per printed surface. Flat, not nested:
  // PUT /api/settings applies a partial $set, and a nested object would be
  // replaced wholesale, wiping every sibling toggle on each save.
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

  createdAt: Date;
  updatedAt: Date;
}

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Settings` export below stays for the live v1 routes.
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
  },
  { timestamps: true },
);

// Reuse the compiled model across hot reloads / serverless invocations.
export const Settings: Model<ISettings> =
  (mongoose.models.Settings as Model<ISettings>) ??
  mongoose.model<ISettings>("Settings", settingsSchema);
