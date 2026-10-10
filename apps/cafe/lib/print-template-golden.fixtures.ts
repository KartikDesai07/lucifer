// Fixtures for the Classic golden test (print customization S1, 01-PLAN §2.3): hand-built Orders, a Settings
// builder, and the KOT prop sets. Money goes through the REAL computeOrderTotals, so every bill's totals are the
// ones the server would have written. The KOT prop sets mirror every shape the app passes to <KOTReceipt>:
// PrintSources (round / whole tab / void / moved), print-host-slips.ts (kotRoundSlip, voidSlipOf, the moved slip
// and the cancel-notice), OrderDetailSheet (cancelled order -> void with the cancel reason) and MoveTableDialog
// (moved without a roundItems filter), plus the KitchenTicketPreview shape (round label + start number).

// Speed: React's DEV server renderer costs ~4 ms per slip (owner-stack capture), which made the ~50k renders of
// this golden take minutes. The test file imports this module BEFORE react / react-dom, so this runs first and
// both sides render with the production build (same markup; dev only adds stderr warnings).
(process.env as Record<string, string | undefined>).NODE_ENV = "production";

import { computeOrderTotals, gstConfigOfSettings, receiptGst, type GstConfig } from "@/lib/receipt";
import type { Order, OrderItem, Settings } from "@/types";

export const FIXED_NOW_MS = Date.UTC(2026, 9, 4, 8, 30, 0); // 04 Oct 2026, 14:00 IST
export const PRINTED_LINE_RE = /Printed 04 Oct 2026, 0?2:00 (?:pm|PM)/;
export const LOGO_REF = "local:logo:0123456789ab";
export const TAGLINE = "Brewed fresh since 2019";
export const FOOTER = "Thank you, visit again";
export const HEADER = "Open 8am to 11pm";
export const GSTIN = "29ABCDE1234F1Z5";
export const FSSAI = "11223344556677";

/** Content-full Settings: every optional header/footer line present, logo set, GST off. */
export function settingsOf(over: Partial<Settings> = {}): Settings {
  return {
    _id: "settings-1",
    restaurantName: "Test Cafe",
    tagline: TAGLINE,
    mobile: "9876543210",
    address: "12 Market Road, Pune",
    receiptHeader: HEADER,
    receiptFooter: FOOTER,
    gstEnabled: false,
    gstNumber: GSTIN,
    gstRate: 0,
    gstMode: "inclusive",
    logo: LOGO_REF,
    fssai: FSSAI,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const gstOn = (gstRate: number, gstMode: GstConfig["gstMode"]): Partial<Settings> => ({
  gstEnabled: true,
  gstRate,
  gstMode,
});

export const ITEMS: OrderItem[] = [
  { productId: "p1", name: "Masala Chai", price: 40, qty: 2, modifiers: ["Less sugar", "Extra ginger"], instructions: "Hot please", kotRound: 1 },
  { productId: "p2", name: "Pizza", variation: "Large", price: 300, qty: 1, modifiers: [], removedModifiers: ["Onion"], instructions: "", kotRound: 1 },
  { productId: "p3", name: "Cold Coffee", price: 120, qty: 3, modifiers: [], instructions: "Extra ice", kotRound: 2 },
];
export const REWARD_LINE: OrderItem = {
  productId: "p9", name: "Free Brownie", price: 150, qty: 1, modifiers: [], instructions: "", kotRound: 1,
  reward: true, note: "Reward - free",
};

export interface OrderOpts {
  items?: OrderItem[];
  gst?: { rate: number; mode: GstConfig["gstMode"] };
  discount?: number;
  discountKind?: Order["discountKind"];
  extraCharge?: number;
  tableCharge?: number;
  over?: Partial<Order>;
}

export function orderOf(o: OrderOpts): Order {
  const items = o.items ?? ITEMS;
  const cfg: GstConfig = o.gst
    ? { gstEnabled: true, gstRate: o.gst.rate, gstMode: o.gst.mode }
    : { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };
  const t = computeOrderTotals({
    items, discount: o.discount ?? 0, discountKind: o.discountKind,
    charge: o.tableCharge ?? 0, extraCharge: o.extraCharge ?? 0, cfg,
  });
  const charges: Order["charges"] =
    t.charge > 0
      ? [
          ...(o.tableCharge ? [{ type: "table" as const, label: "Table charge", amount: o.tableCharge }] : []),
          ...(o.extraCharge ? [{ type: "extra" as const, label: "Packing", amount: o.extraCharge }] : []),
        ]
      : undefined;
  return {
    _id: "o1", orderId: "ORD-20261004-042", customerName: "Ravi", items,
    subtotal: t.subtotal, discount: t.discount, gstAmount: t.gstAmount, gstRate: cfg.gstRate, gstMode: cfg.gstMode,
    ...(charges ? { charges, chargeAmount: t.charge, chargeLabel: charges[0].label } : {}),
    ...(o.discountKind ? { discountKind: o.discountKind } : {}),
    total: t.total, paidAmount: t.total, payment: "Cash", status: "Completed", receiver: "Asha", tableNo: "T4",
    kotRounds: 2, kotNumbers: [7, 8], billNumber: 12,
    createdAt: "2026-10-04T05:15:00.000Z", updatedAt: "2026-10-04T05:15:00.000Z",
    ...o.over,
  };
}

/** S10: a GST bill's invoice number as the order stores it (FY 2026-27 -> "2627/0000nn"). */
export const invoiceOf = (invoiceNumber: number): Partial<Order> => ({ invoiceNumber, invoiceFy: 2026 });

export interface BillFixture {
  id: string;
  order: Order;
  settings: Settings;
}

const EMPTY_CONTENT: Partial<Settings> = {
  restaurantName: "", tagline: "", receiptHeader: "", receiptFooter: "", logo: "", ...gstOn(5, "inclusive"),
};

export const BILL_FIXTURES: BillFixture[] = [
  { id: "paid-cash", order: orderOf({}), settings: settingsOf() },
  { id: "split", order: orderOf({ gst: { rate: 5, mode: "inclusive" }, over: { payment: "Split", splitCash: 300, splitOnline: 0, ...invoiceOf(45) } }), settings: settingsOf(gstOn(5, "inclusive")) },
  { id: "partial-due", order: orderOf({ over: { paidAmount: 200, status: "Pending", billNumber: undefined } }), settings: settingsOf() },
  { id: "cancelled-reason", order: orderOf({ gst: { rate: 5, mode: "exclusive" }, over: { status: "Cancelled", cancelReason: "Guest left before food arrived", ...invoiceOf(46) } }), settings: settingsOf(gstOn(5, "exclusive")) },
  { id: "reward-note", order: orderOf({ items: [...ITEMS, REWARD_LINE] }), settings: settingsOf() },
  { id: "excl-gst-discount-charges", order: orderOf({ gst: { rate: 18, mode: "exclusive" }, discount: 20, discountKind: "gst", tableCharge: 20, extraCharge: 15, over: invoiceOf(123456) }), settings: settingsOf(gstOn(18, "exclusive")) },
  { id: "incl-gst", order: orderOf({ gst: { rate: 12, mode: "inclusive" }, discount: 30, over: invoiceOf(1) }), settings: settingsOf(gstOn(12, "inclusive")) },
  { id: "gst-off", order: orderOf({}), settings: settingsOf({ gstEnabled: false }) },
  { id: "gst-settings-fallback", order: orderOf({ over: { gstRate: undefined, gstMode: undefined, gstAmount: undefined } }), settings: settingsOf(gstOn(5, "inclusive")) },
  // Blind-branch closers (review): walk-in table, a qty>1 reward line with no note, Split with no split amounts.
  { id: "walk-in-reward-qty-split-unset", order: orderOf({ items: [...ITEMS, { ...REWARD_LINE, qty: 2, note: undefined }], over: { tableNo: undefined, payment: "Split" } }), settings: settingsOf() },
  // Cancelled with NO reason and money still owing: legacy hides Due and prints "VOID - no payment due".
  { id: "cancelled-no-reason-due", order: orderOf({ over: { status: "Cancelled", paidAmount: 100 } }), settings: settingsOf() },
  { id: "empty-content", order: orderOf({ gst: { rate: 5, mode: "inclusive" } }), settings: settingsOf(EMPTY_CONTENT) },
];

// ── KOT ──────────────────────────────────────────────────────────────────────

export interface KotExtra {
  roundItems?: OrderItem[];
  roundLabel?: string;
  roundNumber?: number;
  variant?: "kot" | "void" | "moved";
  reason?: string;
  voidedBy?: string;
  voidedAt?: string;
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string;
  banner?: string;
}
export interface KotPropSet {
  id: string;
  order: Order | null;
  extra: KotExtra;
}

const KOT_ORDER = orderOf({ over: { notes: "Birthday table, no peanuts" } });
const KOT_ORDER_PLAIN = orderOf({ over: { tableNo: undefined, receiver: "Meera" } });
const ROUND_ONE = KOT_ORDER.items.filter((it) => it.kotRound === 1);
const ROUND_TWO = KOT_ORDER.items.filter((it) => it.kotRound === 2);
const CANCELLED = orderOf({ over: { notes: "Allergy", status: "Cancelled", cancelReason: "Wrong table" } });
const VOID_LINE = { ...ITEMS[2], qty: 1 };
const VOID_AT = "2026-10-04T06:40:00.000Z";
const MOVED_AT = "2026-10-04T07:05:00.000Z";

export const KOT_PROP_SETS: KotPropSet[] = [
  { id: "round-label-number", order: KOT_ORDER, extra: { roundItems: ROUND_ONE, roundLabel: "Round 1", roundNumber: 7 } },
  { id: "round-no-number", order: KOT_ORDER, extra: { roundItems: ROUND_TWO, roundLabel: "Round 2" } },
  { id: "whole-tab", order: KOT_ORDER, extra: {} },
  { id: "whole-tab-no-notes-no-table", order: KOT_ORDER_PLAIN, extra: {} },
  { id: "preview-label-start", order: KOT_ORDER, extra: { roundLabel: "Round 1", roundNumber: 1 } },
  { id: "round-banner-reprint", order: KOT_ORDER, extra: { roundItems: ROUND_ONE, roundLabel: "Round 1", roundNumber: 7, banner: "REPRINT" } },
  { id: "void-reason-by-at", order: KOT_ORDER, extra: { roundItems: [VOID_LINE], roundLabel: "Round 2", roundNumber: 9, variant: "void", reason: "Guest changed mind", voidedBy: "Owner", voidedAt: VOID_AT } },
  { id: "void-by-only", order: KOT_ORDER, extra: { roundItems: [VOID_LINE], roundLabel: "Round 2", roundNumber: 9, variant: "void", reason: "Out of stock", voidedBy: "Owner" } },
  { id: "void-at-only", order: KOT_ORDER, extra: { roundItems: [VOID_LINE], roundLabel: "Round 2", variant: "void", reason: "Out of stock", voidedAt: VOID_AT } },
  { id: "void-no-reason-no-number", order: KOT_ORDER, extra: { roundItems: [VOID_LINE], roundLabel: "Round 2", variant: "void", voidedBy: "Owner", voidedAt: VOID_AT } },
  { id: "cancel-notice-reason", order: CANCELLED, extra: { variant: "void", reason: "Wrong table" } },
  { id: "cancel-notice-no-reason", order: CANCELLED, extra: { variant: "void" } },
  { id: "round-items-empty", order: KOT_ORDER, extra: { roundItems: [], roundLabel: "Round 3", roundNumber: 10 } },
  { id: "void-banner", order: KOT_ORDER, extra: { roundItems: [VOID_LINE], roundLabel: "Round 2", roundNumber: 9, variant: "void", reason: "Guest changed mind", voidedBy: "Owner", voidedAt: VOID_AT, banner: "REPRINT" } },
  { id: "moved-banner", order: KOT_ORDER, extra: { variant: "moved", movedFrom: "T2", movedBy: "Asha", movedAt: MOVED_AT, banner: "REPRINT" } },
  { id: "moved-from-by-at", order: KOT_ORDER, extra: { variant: "moved", movedFrom: "T2", movedBy: "Asha", movedAt: MOVED_AT } },
  { id: "moved-no-from", order: KOT_ORDER, extra: { variant: "moved", movedBy: "Asha", movedAt: MOVED_AT } },
  { id: "moved-by-only", order: KOT_ORDER, extra: { variant: "moved", movedFrom: "T2", movedBy: "Asha" } },
  { id: "moved-stray-round-props", order: KOT_ORDER, extra: { variant: "moved", movedFrom: "T2", movedBy: "Asha", movedAt: MOVED_AT, roundItems: ROUND_ONE, roundLabel: "Round 1", roundNumber: 7, reason: "ignored", voidedBy: "Owner", voidedAt: VOID_AT } },
  { id: "kot-stray-void-props", order: KOT_ORDER, extra: { roundItems: ROUND_ONE, roundNumber: 7, reason: "ignored", voidedBy: "Owner", voidedAt: VOID_AT, movedFrom: "T2" } },
  { id: "null-order", order: null, extra: { roundLabel: "Round 1" } },
];

/** KOT settings variants: the logo flag on with no logo to show, and the name flag on with a blank name. */
export const KOT_SETTINGS_VARIANTS: { id: string; settings: Settings }[] = [
  { id: "full", settings: settingsOf() },
  { id: "no-logo", settings: settingsOf({ logo: "" }) },
  { id: "blank-name", settings: settingsOf({ restaurantName: "   " }) },
  { id: "bare", settings: settingsOf({ logo: "", restaurantName: "" }) },
];
/** The prop sets the full 1024-flag matrix runs against on the "bare" variant (one per slip shape). */
export const KOT_BARE_MATRIX_IDS = ["round-label-number", "whole-tab", "void-reason-by-at", "moved-from-by-at", "round-items-empty"];

export const BILL_FLAG_KEYS = [
  "billShowLogo", "billShowAddress", "billShowMobile", "billShowGstNumber", "billShowFssai", "billShowNumber",
] as const;
export const KOT_FLAG_KEYS = [
  "kotShowPrices", "kotShowTotal", "kotShowNumber", "kotNumberVoidSlips", "kotShowLogo", "kotShowRestaurantName",
  "kotShowTable", "kotShowStaff", "kotShowTime", "kotShowNotes",
] as const;

// ── The bill oracle's engine-only differences (the locks, 01-PLAN §2.7; the Classic wrap, A4) ───────────────────
// The legacy OrderReceipt has no locks. On the engine path a GST bill (a) forces address / GSTIN / FSSAI on and
// (b) prints the locked "TAX INVOICE" title, which Classic-from-legacy keeps off otherwise. (a) is the settings the
// oracle is rendered with (forceBillLocks); (b) is ONE inserted line, pinned here as a literal. The bill NUMBER is
// not forced by GST: "Show bill number" is its sole control on every design (owner, s78, 01-PLAN A7), which is also
// legacy's own gate, so the engine and the legacy slip agree on it with no oracle help. (c) is the Classic wrap
// (withClassicWrap): the template path's one deliberate markup divergence, mapped exactly below.

/** Does this order's own GST snapshot show tax? (the lock context of the engine, slip-context.ts billLockContext) */
export function billGstShows(order: Order | null, settings: Settings): boolean {
  return order ? receiptGst(order, gstConfigOfSettings(settings)).show : false;
}

/** The legacy settings with the template-path locks forced on: a GST order -> address / GSTIN; a non-empty FSSAI ->
 *  FSSAI. The other locked blocks (name, date, items, total, cancel lines) are always on. billShowNumber is NOT
 *  forced (owner, s78, 01-PLAN A7): the engine prints the bill number only when "Show bill number" is on, GST or not. */
export function forceBillLocks(s: Settings, order: Order | null): Settings {
  return {
    ...s,
    ...(billGstShows(order, s) ? { billShowAddress: true, billShowGstNumber: true } : {}),
    ...(s.fssai?.trim() ? { billShowFssai: true } : {}),
  };
}

/** The first rule of the legacy bill, which closes the header: the title is printed right after it. */
export const TITLE_ANCHOR_HTML = '<div class="my-1 border-t border-dashed border-black"></div>';
export const LOCKED_TITLE_HTML = '<div class="text-center font-bold tracking-widest">TAX INVOICE</div>';

/** The oracle for a bill cell: the legacy markup, plus (only when the order shows GST) exactly the locked title line
 *  inserted immediately after the FIRST header rule. Never a silent no-op: a GST cell whose legacy markup has no such
 *  rule, or already carries a title, is a broken oracle and throws. A non-GST cell is returned untouched (exact). */
export function withLockedTitle(legacyHtml: string, gstShows: boolean): string {
  if (!gstShows) return legacyHtml;
  const at = legacyHtml.indexOf(TITLE_ANCHOR_HTML);
  if (at < 0) throw new Error("withLockedTitle: the legacy bill has no header rule to anchor the TAX INVOICE title on");
  if (legacyHtml.includes(LOCKED_TITLE_HTML)) throw new Error("withLockedTitle: the legacy bill already prints the title");
  const end = at + TITLE_ANCHOR_HTML.length;
  return legacyHtml.slice(0, end) + LOCKED_TITLE_HTML + legacyHtml.slice(end);
}

// ── The Classic wrap (A4, 04-S4-plan D6/D7) ──────────────────────────────────────────────────────────────────────
// The template-path Classic bill differs from legacy in exactly five places, mapped here as EXACT string rewrites
// (never a regex "close enough"): the root gains `break-words` as the last class (SlipEngine.slipRoot appends
// design.rootClass after `font-mono text-black`), every legacy `Line` row becomes the wrapping row, and the item-name
// span gains `min-w-0`, and the Bill No. / Token and TOTAL rows wrap (flex-wrap + ml-auto). Total: it throws on a missed root anchor, and on any legacy marker left over afterwards.

// next/image hoists the logo's <link rel="preload" .../> in front of the root (the engine's markup has it too), so the
// root is the first tag after any such preload links and nothing else.
export const LEGACY_ROOT_RE = /^((?:<link rel="preload"[^>]*\/>)*)(<div class="[^"]*\bbg-white p-3 font-mono text-black")/;
export const CLASSIC_WRAP_ROOT_CLASS = "break-words";
export const LEGACY_LINE_RE =
  /<div class="flex justify-between gap-2"><span class="whitespace-pre">([^<]*)<\/span><span class="text-right">([^<]*)<\/span><\/div>/g;
export const WRAPPED_LINE = (label: string, value: string): string =>
  `<div class="flex flex-wrap justify-between gap-x-2"><span class="max-w-full whitespace-pre-wrap">${label}</span><span class="max-w-full grow basis-0 text-right">${value}</span></div>`;
const LEGACY_NUMBER_RE = // S6: the Token row is the Bill No. row twin; S10: so is Invoice No.; the label is captured
  /<div class="flex justify-between gap-2 font-bold"><span>(Bill No\.|Invoice No\.|Token)<\/span><span class="text-right">([^<]*)<\/span><\/div>/g;
const WRAPPED_NUMBER = (label: string, value: string): string =>
  `<div class="flex flex-wrap justify-between gap-2 font-bold"><span>${label}</span><span class="ml-auto text-right">${value}</span></div>`;
const LEGACY_TOTAL_RE =
  /<div class="flex justify-between text-\[1\.17em\] font-bold"><span>TOTAL<\/span><span>([^<]*)<\/span><\/div>/g;
const WRAPPED_TOTAL = (value: string): string =>
  `<div class="flex flex-wrap justify-between text-[1.17em] font-bold"><span>TOTAL</span><span class="ml-auto whitespace-nowrap">${value}</span></div>`;
const LEGACY_ITEM_NAME = '<span class="pr-2">';
const WRAPPED_ITEM_NAME = '<span class="min-w-0 pr-2">';
const LEFTOVER_MARKERS = [
  'class="whitespace-pre"',
  'class="pr-2"',
  'class="flex justify-between gap-2 font-bold"',
  'class="flex justify-between text-[1.17em] font-bold"',
];

/** The legacy bill's markup mapped to what the Classic template path prints. Throws instead of no-op. */
export function withClassicWrap(legacyHtml: string): string {
  const root = LEGACY_ROOT_RE.exec(legacyHtml);
  if (!root) throw new Error("withClassicWrap: the first tag (after any logo preload links) is not the legacy bill root (bg-white p-3 font-mono text-black)");
  const rooted = `${root[1]}${root[2].slice(0, -1)} ${CLASSIC_WRAP_ROOT_CLASS}"${legacyHtml.slice(root[0].length)}`;
  const wrapped = rooted
    .replace(LEGACY_LINE_RE, (_all, label: string, value: string) => WRAPPED_LINE(label, value))
    .replace(LEGACY_NUMBER_RE, (_all, label: string, value: string) => WRAPPED_NUMBER(label, value))
    .replace(LEGACY_TOTAL_RE, (_all, value: string) => WRAPPED_TOTAL(value))
    .split(LEGACY_ITEM_NAME).join(WRAPPED_ITEM_NAME);
  for (const marker of LEFTOVER_MARKERS) {
    if (wrapped.includes(marker)) throw new Error(`withClassicWrap: a legacy ${marker} survived the rewrite (a Line, item, Bill No. or TOTAL row of an unexpected shape)`);
  }
  return wrapped;
}

export function flagsOf<K extends string>(keys: readonly K[], mask: number): Record<K, boolean> {
  const out = {} as Record<K, boolean>;
  keys.forEach((k, bit) => { out[k] = (mask & (1 << bit)) !== 0; });
  return out;
}
