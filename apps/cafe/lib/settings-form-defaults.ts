import { type SettingsInput } from "@/schemas";
import { printConfigOf } from "@/lib/print";
import { appearanceFormDefaults } from "@/lib/appearance-form";
import { loyaltyRulesFormDefaults } from "@/lib/loyalty-rules-form";
import {
  LOYALTY_STAMPS_DEFAULT,
  LOYALTY_MIN_BILL_DEFAULT,
  LOYALTY_REWARD_KIND_DEFAULT,
  LOYALTY_REWARD_VALUE_DEFAULT,
} from "@pos/shared/public-diner";
import type { Settings } from "@/types";

// The single `defaultValues` builder every settings section form seeds from
// (moved verbatim off components/settings/SettingsForm.tsx, CB-UI1 S1) — one
// react-hook-form instance is created per section page, but every one of
// them validates against the FULL settingsSchema (zodResolver), so every
// field, rendered on this page or not, needs a real seed value or Save fails
// validation silently for a field the operator never touched.

// CB-4's flat diner/loyalty keys, as they exist on a real Settings document
// but not yet on @pos/shared's `Settings` client type (the same lag
// `promoCodes` hit — the storage/validation contract landed without the client
// type). Declared ONCE here so the reads below stay plain property accesses.
type Cb4SettingsKeys = Pick<
  SettingsInput,
  | "dinerAccountsEnabled"
  | "loyaltyEnabled"
  | "loyaltyStampsPerReward"
  | "loyaltyMinBill"
  | "loyaltyRewardKind"
  | "loyaltyRewardValue"
  | "loyaltyRewardItem"
>;

export function settingsFormDefaults(settings: Settings): SettingsInput {
  const cb4 = settings as Settings & Partial<Cb4SettingsKeys>;
  // The 23 print fields are REQUIRED by settingsSchema, but a Settings
  // document written before this feature has none of them — getSettings()
  // reads with `.lean()`, so Mongoose's schema defaults never apply, and the
  // fetched object genuinely lacks those keys. Seeding defaultValues straight
  // off `settings` would hand zodResolver `undefined` for every one of them,
  // which fails validation and silently blocks Save. printConfigOf() is the
  // one sanctioned place that resolves "absent means the documented default"
  // (see apps/cafe/lib/print.ts) — reused here instead of a second copy of
  // those defaults.
  const printConfig = printConfigOf(settings);

  return {
    restaurantName: settings.restaurantName,
    tagline: settings.tagline,
    mobile: settings.mobile,
    address: settings.address,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    gstEnabled: settings.gstEnabled,
    gstNumber: settings.gstNumber,
    gstRate: settings.gstRate,
    gstMode: settings.gstMode,
    logo: settings.logo ?? "",
    // settingsSchema requires productLogo on every submit (zodResolver
    // validates the FULL object) — omitting it here would fail validation
    // silently on Save for any doc written before this field existed.
    productLogo: settings.productLogo ?? "",
    fssai: settings.fssai ?? "",

    billShowNumber: printConfig.bill.showNumber,
    billNumberStart: printConfig.bill.numberStart,
    billShowLogo: printConfig.bill.showLogo,
    billLogoSize: printConfig.bill.logoSize,
    billShowAddress: printConfig.bill.showAddress,
    billShowMobile: printConfig.bill.showMobile,
    billShowGstNumber: printConfig.bill.showGstNumber,
    billShowFssai: printConfig.bill.showFssai,
    billPaperWidth: printConfig.bill.paperWidth,
    billFontSize: printConfig.bill.fontSize,

    kotShowPrices: printConfig.kot.showPrices,
    kotShowTotal: printConfig.kot.showTotal,
    kotShowNumber: printConfig.kot.showNumber,
    kotNumberStart: printConfig.kot.numberStart,
    kotNumberVoidSlips: printConfig.kot.numberVoidSlips,
    kotShowLogo: printConfig.kot.showLogo,
    kotShowRestaurantName: printConfig.kot.showRestaurantName,
    kotShowTable: printConfig.kot.showTable,
    kotShowStaff: printConfig.kot.showStaff,
    kotShowTime: printConfig.kot.showTime,
    kotShowNotes: printConfig.kot.showNotes,
    kotPaperWidth: printConfig.kot.paperWidth,
    kotFontSize: printConfig.kot.fontSize,

    // Same lean-doc hazard as productLogo above: a pre-CR2 Settings
    // document carries none of these three, so defaultValues must supply
    // the fallback or zodResolver fails validation silently on Save.
    selfOrderMode: settings.selfOrderMode ?? "approve",
    allowTableChange: settings.allowTableChange ?? true,
    showPastOrdersToDiner: settings.showPastOrdersToDiner ?? true,

    // CB-4 — the four loyalty controls the owner actually sees, every one
    // PRE-FILLED with a safe value so a non-technical owner never faces a
    // blank box. 8 stamps is the researched sweet spot (6-10) and the #1
    // small-owner mistake is setting the target too high, so the default is
    // deliberately modest. Both features ship OFF: turning a cafe's diner
    // accounts on is the owner's decision, never a silent upgrade.
    // Same lean-doc hazard as the three fields above — a pre-CB-4 Settings
    // document carries none of these keys, so defaultValues must supply them
    // or zodResolver fails validation silently on Save.
    // Read through ONE local cast (the promoCodes precedent below): @pos/shared's
    // Settings client type predates these keys, so they are not typed on
    // `settings` yet. One alias rather than seven inline casts.
    dinerAccountsEnabled: cb4.dinerAccountsEnabled ?? false,
    loyaltyEnabled: cb4.loyaltyEnabled ?? false,
    loyaltyStampsPerReward: cb4.loyaltyStampsPerReward ?? LOYALTY_STAMPS_DEFAULT,
    loyaltyMinBill: cb4.loyaltyMinBill ?? LOYALTY_MIN_BILL_DEFAULT,
    loyaltyRewardKind: cb4.loyaltyRewardKind ?? LOYALTY_REWARD_KIND_DEFAULT,
    loyaltyRewardValue: cb4.loyaltyRewardValue ?? LOYALTY_REWARD_VALUE_DEFAULT,
    loyaltyRewardItem: cb4.loyaltyRewardItem ?? "",

    // CB-5A — loyaltyRules is a nested subdoc (settingsSchema requires every
    // key once present), so a pre-CB-5A Settings document has none of them at
    // all. loyaltyRulesFormDefaults resolves that the same way
    // appearanceFormDefaults resolves the appearance block above — never a
    // second copy of "absent means default". Same type-drift cast as
    // appearance below: @pos/shared's Settings type predates this field.
    loyaltyRules: loyaltyRulesFormDefaults(cb4 as typeof cb4 & { loyaltyRules?: unknown }),

    // CR2.2c — @pos/shared's Settings type (types.ts) predates this field
    // (P1 landed the storage/validation contract, not this client type), so
    // it isn't a typed key on `settings` yet. Read it the same defensive
    // way as every other optional field on this doc: a local cast, never an
    // assumption the key is present.
    promoCodes: (settings as Settings & { promoCodes?: SettingsInput["promoCodes"] }).promoCodes ?? [],

    // CR2.3b — same lean-doc hazard as above: a pre-Telegram Settings
    // document carries no telegramPaused key at all.
    telegramPaused: settings.telegramPaused ?? false,

    // CR2.4 — appearance is a nested subdoc (settings.schema.ts requires
    // every key once present), so a pre-CR2.4 Settings document has none of
    // them at all. appearanceFormDefaults resolves that the same way
    // printConfigOf resolves the print block above — never a second copy of
    // "absent means the documented default". Same type-drift cast as
    // promoCodes above: @pos/shared's Settings type predates this field.
    appearance: appearanceFormDefaults(settings as Settings & { appearance?: unknown }),
  };
}
