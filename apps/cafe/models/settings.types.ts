import type { Document } from "mongoose";
import {
  type GstMode,
  type PaperWidth,
  type PrintFontSize,
  type PrintLogoSize,
} from "@/lib/constants";
import { type SelfOrderMode, type PromoCodeConfig } from "@pos/shared/public";
import { type LoyaltyRewardKind } from "@pos/shared/public-diner";
import { type AppearanceInput } from "@pos/shared/appearance";
import type { LoyaltyRulesInput } from "@pos/shared/schemas/settings-loyalty.schema";

// CB-5A S2 — split out of models/Settings.ts (that file's own ~300-line
// budget) so the loyaltyRules addition below doesn't breach it. Moved
// VERBATIM, comments included — Settings.ts re-exports this type so no
// consumer import path changes (`import type { ISettings } from "@/models/Settings"`).

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

  // Diner accounts + stamp loyalty — CB-4. Flat and all OPTIONAL with no
  // default (the promoCodes precedent above). `loyaltyMinBill` is in RUPEES:
  // the earn site compares it against the v1 Order total, which is a plain
  // rupee Number — the Int32 paise shape lives on models/order.ledger.ts and
  // that path never reads it.
  dinerAccountsEnabled?: boolean;
  loyaltyEnabled?: boolean;
  loyaltyStampsPerReward?: number;
  loyaltyMinBill?: number;
  loyaltyRewardKind?: LoyaltyRewardKind;
  loyaltyRewardValue?: number;
  loyaltyRewardItem?: string;

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

  // CB-5A — the richer milestone-ladder loyalty contract. OPTIONAL, no
  // default (promoCodes/appearance precedent above): a cafe that
  // never opts into this ladder simply never carries the key. See
  // settings-loyalty.schema.ts (packages/shared) for the field semantics —
  // this is a SEPARATE contract from the flat CB-4 loyalty* fields above.
  loyaltyRules?: LoyaltyRulesInput;

  createdAt: Date;
  updatedAt: Date;
}
