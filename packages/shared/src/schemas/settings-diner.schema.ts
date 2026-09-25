import { z } from "zod";
import { DINER_BANNER_MAX, DINER_BANNER_TITLE_MAX_LEN, DINER_BANNER_BODY_MAX_LEN } from "../public-diner";

// CB-6C S1 — owner-written banners on the diner Home tab (/m). Split out of
// settings.schema.ts (that file's own ~300-line budget), same one-section
// split precedent as settings-print.schema.ts/settings-loyalty.schema.ts.
// Re-exported wholesale from settings.schema.ts so every existing import
// specifier (`@pos/shared/schemas`, `./settings.schema`) keeps working
// unchanged.

// One banner: a title (required — an empty row is not a real banner) and a
// one-line body (OPTIONAL — a banner may be title-only, e.g. "Diwali special").
// `body` must NOT carry `.min(1)`: the Mongoose side stores it as a plain
// (non-required) trimmed String, and "" is its documented empty state — same
// accentOverride/heroImage precedent as appearanceSchema.
export const dinerBannerSchema = z.object({
  title: z.string().trim().min(1, "Give the banner a title").max(DINER_BANNER_TITLE_MAX_LEN),
  body: z.string().trim().max(DINER_BANNER_BODY_MAX_LEN),
});

// The array itself: bounded to DINER_BANNER_MAX banners. OPTIONAL, no
// `.default()` — the promoCodes precedent (settings-print.schema.ts): every
// existing Settings document and test fixture predates this field, and a
// required/defaulted addition here has broken fixtures before.
export const dinerBannersSchema = z
  .array(dinerBannerSchema)
  .max(DINER_BANNER_MAX, `Keep it under ${DINER_BANNER_MAX} banners`)
  .optional();

export type DinerBannerInput = z.infer<typeof dinerBannerSchema>;
