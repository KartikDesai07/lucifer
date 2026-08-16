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

// Where a day's slip numbering begins. A whole number: a fractional or negative
// "start" would print as a fraction on every slip that day.
const numberStartSchema = z
  .number()
  .int("Use a whole number")
  .min(PRINT_NUMBER_START_MIN, `Start at ${PRINT_NUMBER_START_MIN} or higher`)
  .max(PRINT_NUMBER_START_MAX, `Keep it under ${PRINT_NUMBER_START_MAX}`);

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
});

// PUT accepts any subset; the form sends the full object.
export const updateSettingsSchema = settingsSchema.partial();

export type SettingsInput = z.infer<typeof settingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
