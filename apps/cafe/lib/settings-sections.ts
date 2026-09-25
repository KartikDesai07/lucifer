// Single source of truth for the Settings redesign (CB-UI1): the 7 form
// sections + Printer setup, their registered fields, and the helpers that
// route/split/attribute values against them. NO React/lucide import here —
// this file is imported by node:test suites directly (lib/settings-sections.test.ts)
// as well as every settings page/hook. Icons live one layer up, in
// components/settings/settings-section-icons.tsx.
import type { SettingsInput, UpdateSettingsInput } from "@/schemas";

export const SETTINGS_BASE_PATH = "/settings";

export type SettingsSectionSlug =
  | "business"
  | "taxes"
  | "bill-print"
  | "kitchen-ticket"
  | "qr-ordering"
  | "loyalty"
  | "appearance"
  | "notifications"
  | "printing";

export interface SettingsSection {
  slug: SettingsSectionSlug;
  title: string;
  description: string;
  fields: readonly (keyof SettingsInput)[];
}

// Order here is also the hub card order and the sidebar sub-menu order
// (design contract's routes table, copied verbatim). `printing` is the
// existing Printer-setup page — it owns no settingsSchema fields of its own.
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    slug: "business",
    title: "Business details",
    description: "Name, logo, contact details and licence number shown on bills.",
    fields: ["logo", "restaurantName", "tagline", "mobile", "address", "productLogo", "fssai"],
  },
  {
    slug: "taxes",
    title: "GST & taxes",
    description: "How GST is calculated and shown on bills.",
    fields: ["gstEnabled", "gstMode", "gstRate", "gstNumber"],
  },
  {
    slug: "bill-print",
    title: "Bill print",
    description: "What the customer's printed bill shows, and the paper it prints on.",
    fields: [
      "receiptHeader",
      "receiptFooter",
      "billShowNumber",
      "billNumberStart",
      "billShowLogo",
      "billLogoSize",
      "billShowAddress",
      "billShowMobile",
      "billShowGstNumber",
      "billShowFssai",
      "billPaperWidth",
      "billFontSize",
    ],
  },
  {
    slug: "kitchen-ticket",
    title: "Kitchen ticket",
    description: "What the kitchen slip (KOT) shows, and the paper it prints on.",
    fields: [
      "kotShowPrices",
      "kotShowTotal",
      "kotShowNumber",
      "kotNumberStart",
      "kotNumberVoidSlips",
      "kotShowLogo",
      "kotShowRestaurantName",
      "kotShowTable",
      "kotShowStaff",
      "kotShowTime",
      "kotShowNotes",
      "kotPaperWidth",
      "kotFontSize",
    ],
  },
  {
    slug: "qr-ordering",
    title: "QR ordering",
    description: "How orders from the QR menu reach the kitchen, and promo codes diners can use.",
    fields: ["selfOrderMode", "allowTableChange", "showPastOrdersToDiner", "promoCodes", "dinerBanners"],
  },
  {
    slug: "loyalty",
    title: "Rewards & loyalty",
    description: "Stamp cards and rewards for diners.",
    // CB-5A — the 7 CB-4 flat fields MOVED here off qr-ordering (they used to
    // share that screen). Both `loyaltyRules` and the flat fields describe
    // the SAME stamp-card rule: the flat fields are its LEGACY FORM, and
    // lib/diner-loyalty.ts's resolveLoyaltyConfig derives a one-milestone
    // ladder from them whenever loyaltyRules is absent. One section must own
    // both, or two pages could each save half of one rule set — and since
    // loyaltyRules is a nested subdoc that PUT $set-replaces WHOLE, a page
    // that only knew the flat half would silently clobber the other half's
    // stored ladder on every save.
    fields: [
      "dinerAccountsEnabled",
      "loyaltyEnabled",
      "loyaltyStampsPerReward",
      "loyaltyMinBill",
      "loyaltyRewardKind",
      "loyaltyRewardValue",
      "loyaltyRewardItem",
      "loyaltyRules",
    ],
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Colours, fonts and layout of the QR menu diners see.",
    fields: ["appearance"],
  },
  {
    slug: "notifications",
    title: "Notifications",
    description: "Telegram alerts for new QR orders.",
    fields: ["telegramPaused"],
  },
  {
    slug: "printing",
    title: "Printer setup",
    description: "Make this PC the print host and install the POS Printer shortcut.",
    fields: [],
  },
];

export function settingsSectionPath(slug: SettingsSectionSlug): string {
  return `${SETTINGS_BASE_PATH}/${slug}`;
}

// First (only) section whose `fields` list carries this key — every
// settingsSchema field belongs to exactly one section (parity-pinned in
// settings-sections.test.ts), so a matching section is a real bug elsewhere
// if it's ever missing at a call site that expects one.
export function settingsSectionBySlug(slug: SettingsSectionSlug): SettingsSection {
  const section = SETTINGS_SECTIONS.find((s) => s.slug === slug);
  if (!section) throw new Error(`Unknown settings section: ${slug}`);
  return section;
}

export function sectionForField(name: keyof SettingsInput): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.fields.includes(name));
}

// Picks only this section's own keys off a full form-values object — used to
// build the PUT body a section page sends (`updateSettingsSchema.partial()`
// accepts any subset). `Object.hasOwn` rather than a plain `values[f]`
// truthiness/`in` check: a bare `in`/index read walks the prototype chain,
// so an inherited key (e.g. `constructor`) could slip into the picked object
// if `fields` ever named one (memory: object-literal allow-lists leak
// prototype keys).
export function pickSectionValues(values: SettingsInput, section: SettingsSection): UpdateSettingsInput {
  const picked: UpdateSettingsInput = {};
  for (const field of section.fields) {
    if (Object.hasOwn(values, field)) {
      (picked as Record<string, unknown>)[field] = values[field];
    }
  }
  return picked;
}
