import { z } from "zod";
import { GST_MODES } from "@/lib/constants";

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
  kotShowPrices: z.boolean(),
});

// PUT accepts any subset; the form sends the full object.
export const updateSettingsSchema = settingsSchema.partial();

export type SettingsInput = z.infer<typeof settingsSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
