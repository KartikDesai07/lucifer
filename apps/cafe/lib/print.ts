import {
  PRINT_NUMBER_START_MIN,
  type PaperWidth,
  type PrintFontSize,
  type PrintLogoSize,
} from "@/lib/constants";
import type { Settings } from "@/types";

// Shared react-to-print page style for the 80mm thermal printer. Used by the
// POS receipt/KOT, the order-detail receipt, and the end-of-day summary so the
// page setup stays in one place.
export const RECEIPT_PAGE_STYLE =
  "@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }";

// Same page setup for a cafe that runs narrower paper. The @page size and the
// on-screen width of the print source (PAPER_WIDTH_CLASS below) must be chosen
// from the SAME setting, or the browser scales the slip to fit and every column
// lands in the wrong place.
export function receiptPageStyle(width: PaperWidth): string {
  return `@page { size: ${width} auto; margin: 4mm; } @media print { body { margin: 0; } }`;
}

// Written as whole literal class names, never built by interpolation: Tailwind
// scans source text, so a class assembled at runtime is never emitted.
export const PAPER_WIDTH_CLASS: Record<PaperWidth, string> = {
  "58mm": "w-[210px]",
  "80mm": "w-[300px]",
};

// Base type size. Everything inside a slip sizes itself in `em`, so changing
// this scales the whole ticket rather than only its body text.
export const PRINT_FONT_CLASS: Record<PrintFontSize, string> = {
  small: "text-[12px]",
  normal: "text-[14px]",
  large: "text-[16px]",
};

export const PRINT_LOGO_CLASS: Record<PrintLogoSize, string> = {
  small: "h-[36px] w-[80px]",
  medium: "h-[56px] w-[120px]",
  large: "h-[80px] w-[170px]",
};

// ── Resolved print configuration ─────────────────────────────────────────────
// Settings is read with `.lean()`, and Mongoose defaults are a DOCUMENT feature
// — a lean read of a document written before these fields existed returns
// undefined for every one of them. Reading a toggle straight off the object
// would therefore turn every cafe's logo and address OFF the moment this
// ships. This resolver is the only sanctioned way to read them: absent means
// "the documented default", exactly as gstConfigOfSettings does for tax.

export interface BillPrintConfig {
  showNumber: boolean;
  numberStart: number;
  showLogo: boolean;
  logoSize: PrintLogoSize;
  showAddress: boolean;
  showMobile: boolean;
  showGstNumber: boolean;
  showFssai: boolean;
  paperWidth: PaperWidth;
  fontSize: PrintFontSize;
}

export interface KotPrintConfig {
  showPrices: boolean;
  showTotal: boolean;
  showNumber: boolean;
  numberStart: number;
  numberVoidSlips: boolean;
  showLogo: boolean;
  showRestaurantName: boolean;
  showTable: boolean;
  showStaff: boolean;
  showTime: boolean;
  showNotes: boolean;
  paperWidth: PaperWidth;
  fontSize: PrintFontSize;
}

export interface PrintConfig {
  bill: BillPrintConfig;
  kot: KotPrintConfig;
}

// A stored start of 0 or a negative would print a nonsense number on every slip
// that day, so it is floored here as well as bounded in the Zod schema — the
// schema guards what is written, this guards what was written before it existed.
function startOf(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return PRINT_NUMBER_START_MIN;
  }
  return Math.max(PRINT_NUMBER_START_MIN, Math.round(value));
}

// Only the print fields, never the whole Settings object. The server reads a
// Mongoose document (ObjectId `_id`) and the client reads the DTO (string
// `_id`); binding this resolver to either shape would force the other to cast.
// Every print setting is prefixed `bill`/`kot` by convention, which is exactly
// what this selects — so a new one is picked up by naming it correctly.
type PrintSettingsSource = {
  [K in keyof Settings as K extends `bill${string}` | `kot${string}`
    ? K
    : never]?: Settings[K];
};

export function printConfigOf(
  settings: PrintSettingsSource | undefined | null,
): PrintConfig {
  return {
    bill: {
      showNumber: settings?.billShowNumber ?? true,
      numberStart: startOf(settings?.billNumberStart),
      showLogo: settings?.billShowLogo ?? true,
      logoSize: settings?.billLogoSize ?? "medium",
      showAddress: settings?.billShowAddress ?? true,
      showMobile: settings?.billShowMobile ?? true,
      showGstNumber: settings?.billShowGstNumber ?? true,
      showFssai: settings?.billShowFssai ?? true,
      paperWidth: settings?.billPaperWidth ?? "80mm",
      // "small" (12px), NOT "normal" — the bill has always been rendered at
      // 12px and every em ratio inside OrderReceipt is derived from that base.
      // Defaulting to 14px would print an existing cafe's bill ~17% larger
      // than the day before, dropping an 80mm line from ~38 characters to ~33
      // and wrapping item names that used to fit. The KOT is the control: its
      // base has always been 14px, so its default IS "normal".
      fontSize: settings?.billFontSize ?? "small",
    },
    kot: {
      // The one pre-existing field. Its stored value wins; only a cafe with no
      // stored value at all (a document older than the field) falls back, and
      // the fallback matches the model's current default.
      showPrices: settings?.kotShowPrices ?? true,
      showTotal: settings?.kotShowTotal ?? true,
      showNumber: settings?.kotShowNumber ?? true,
      numberStart: startOf(settings?.kotNumberStart),
      numberVoidSlips: settings?.kotNumberVoidSlips ?? true,
      showLogo: settings?.kotShowLogo ?? false,
      showRestaurantName: settings?.kotShowRestaurantName ?? false,
      showTable: settings?.kotShowTable ?? true,
      showStaff: settings?.kotShowStaff ?? true,
      showTime: settings?.kotShowTime ?? true,
      showNotes: settings?.kotShowNotes ?? true,
      paperWidth: settings?.kotPaperWidth ?? "80mm",
      fontSize: settings?.kotFontSize ?? "normal",
    },
  };
}

// The same resolved configuration, flattened back into the shape the Settings
// document and `settingsSchema` use. Two callers need exactly this:
//
//  • the Settings FORM, to seed its fields. `settingsSchema` requires every
//    print field, but a cafe whose Settings document predates them has none —
//    seeding raw would hand the resolver `undefined`, fail validation on submit,
//    and surface errors on fields in a tab the operator may not have open. Seed
//    from here and the form opens showing the state the receipts are ACTUALLY
//    printing in.
//  • test fixtures, which then state no defaults of their own and cannot drift.
//
// Passing nothing yields the documented defaults; passing a cafe's settings
// yields its effective values.
export function printSettingsFields(settings?: PrintSettingsSource | null) {
  const { bill, kot } = printConfigOf(settings);
  return {
    billShowNumber: bill.showNumber,
    billNumberStart: bill.numberStart,
    billShowLogo: bill.showLogo,
    billLogoSize: bill.logoSize,
    billShowAddress: bill.showAddress,
    billShowMobile: bill.showMobile,
    billShowGstNumber: bill.showGstNumber,
    billShowFssai: bill.showFssai,
    billPaperWidth: bill.paperWidth,
    billFontSize: bill.fontSize,
    kotShowPrices: kot.showPrices,
    kotShowTotal: kot.showTotal,
    kotShowNumber: kot.showNumber,
    kotNumberStart: kot.numberStart,
    kotNumberVoidSlips: kot.numberVoidSlips,
    kotShowLogo: kot.showLogo,
    kotShowRestaurantName: kot.showRestaurantName,
    kotShowTable: kot.showTable,
    kotShowStaff: kot.showStaff,
    kotShowTime: kot.showTime,
    kotShowNotes: kot.showNotes,
    kotPaperWidth: kot.paperWidth,
    kotFontSize: kot.fontSize,
  };
}

// The number actually printed on a slip: the cafe's chosen starting point plus
// however many have been issued today. The stored counter always counts from 1,
// so raising tomorrow's start never renumbers a slip already in a customer's
// hand.
export function printedSlipNumber(sequence: number, start: number): number {
  return startOf(start) + Math.max(1, Math.round(sequence)) - 1;
}

// ── Why two print jobs must NEVER fire in the same tick (CR1.2) ──────────────
// react-to-print (package.json pins ^3.0.5; the installed build is 3.3.0) keeps
// ONE iframe with the fixed id "printWindow": it invokes onAfterPrint and only
// THEN removes it, and every trigger force-removes any existing #printWindow
// first. So two triggers in one tick — or firing the receipt synchronously inside
// the KOT's onAfterPrint — makes the KOT's teardown delete the receipt's
// just-appended iframe, silently killing the receipt print. The POS therefore
// chains them: a guard ref keeps the KOT effect from re-firing (the trigger's
// identity changes every render), onAfterPrint only flips that flag, and the
// receipt goes out on the NEXT effect flush — safely after the library's teardown.
//
// Verified on desktop Chrome/Firefox ONLY. On MOBILE user-agents (a tablet POS —
// /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i) 3.3.0 fires
// onAfterPrint on a fixed 500ms timer after invoking print() rather than at job
// completion, so the two jobs can overlap there instead of being sequenced.
// Tablets/phones are therefore NOT a supported counter device (CR1.6 decision —
// docs/GO-LIVE-CHECKLIST.md §7); desktop Chrome/Firefox is the verified path.
