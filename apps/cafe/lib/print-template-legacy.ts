import {
  CLASSIC_PRINT_FONT,
  PRINT_TEMPLATE_VERSION,
  type BillBlock,
  type BillTemplate,
  type DividerBlock,
  type KotBlock,
  type KotTemplate,
} from "@pos/shared/print-template";
import type { PrintLogoSize } from "@/lib/constants";
import { printConfigOf } from "@/lib/print";

// Classic-from-legacy (print customization S1, 01-PLAN §2.2): today's bill and kitchen ticket, expressed as a
// slip template. Rendering this template through the block engine must equal the legacy components string for
// string (lib/print-template-golden.test.ts), so each legacy `show*` flag maps to the `on` of the one block it
// gated, and every line the legacy slip always printed is `on: true`. Pure: it reads ONLY printConfigOf(settings),
// so an absent or pre-field Settings document resolves to the documented defaults exactly as the legacy slip does.
//
// Five forward blocks are emitted although the legacy slips print none of them: bill `title` (off; only the GST
// lock forces it — "TAX INVOICE", S3), `token` (S6) and `loyalty` (off; S3, so a client turns the line on in the
// editor rather than having to place it), KOT `station` (office PC Phase 2) and `token`. A template saved now then
// already carries the lines the slips will gain, and the write schema requires bill `title`.
//
// Not template: kotNumberVoidSlips, billNumberStart / kotNumberStart and paper width stay Settings policy. The
// first two decide whether the SERVER mints a number at all (so the slip merely prints what it is given), and
// paper width is a property of the paper in the printer, not of the design (01-PLAN C6).

// A kitchen ticket never needs a large logo — the legacy KOT is pinned to the "small" box (80 x 36).
const KOT_LOGO_SIZE: PrintLogoSize = "small";

type SettingsArg = Parameters<typeof printConfigOf>[0];

function divider(n: number): DividerBlock {
  return { id: `divider-${n}`, type: "divider", on: true };
}

export function classicBillTemplate(settings: SettingsArg): BillTemplate {
  const cfg = printConfigOf(settings).bill;
  const blocks: BillBlock[] = [
    { id: "logo", type: "logo", on: cfg.showLogo, options: { logoSize: cfg.logoSize } },
    { id: "name", type: "name", on: true },
    { id: "tagline", type: "tagline", on: true },
    { id: "address", type: "address", on: cfg.showAddress },
    { id: "phone", type: "phone", on: cfg.showMobile },
    { id: "gstin", type: "gstin", on: cfg.showGstNumber },
    { id: "fssai", type: "fssai", on: cfg.showFssai },
    { id: "headerText", type: "headerText", on: true },
    divider(1),
    // Forward block, off: it prints only when the GST lock forces it (S3 renders "TAX INVOICE").
    { id: "title", type: "title", on: false },
    { id: "cancelBanner", type: "cancelBanner", on: true },
    { id: "billNo", type: "billNo", on: cfg.showNumber },
    { id: "token", type: "token", on: true },
    { id: "orderId", type: "orderId", on: true },
    { id: "dateTime", type: "dateTime", on: true },
    { id: "table", type: "table", on: true },
    { id: "customer", type: "customer", on: true },
    { id: "cashier", type: "cashier", on: true },
    { id: "cancelReason", type: "cancelReason", on: true },
    divider(2),
    { id: "items", type: "items", on: true },
    divider(3),
    { id: "subtotal", type: "subtotal", on: true },
    { id: "discount", type: "discount", on: true },
    { id: "taxes", type: "taxes", on: true },
    { id: "charges", type: "charges", on: true },
    { id: "loyalty", type: "loyalty", on: false },
    { id: "total", type: "total", on: true },
    { id: "taxIncluded", type: "taxIncluded", on: true },
    { id: "payment", type: "payment", on: true },
    { id: "due", type: "due", on: true },
    divider(4),
    { id: "footerText", type: "footerText", on: true },
    { id: "printedAt", type: "printedAt", on: true },
  ];
  return { v: PRINT_TEMPLATE_VERSION, design: "classic", font: CLASSIC_PRINT_FONT, size: cfg.fontSize, blocks };
}

export function classicKotTemplate(settings: SettingsArg): KotTemplate {
  const cfg = printConfigOf(settings).kot;
  const blocks: KotBlock[] = [
    { id: "logo", type: "logo", on: cfg.showLogo, options: { logoSize: KOT_LOGO_SIZE } },
    { id: "name", type: "name", on: cfg.showRestaurantName },
    { id: "title", type: "title", on: true },
    { id: "station", type: "station", on: true },
    { id: "kotNo", type: "kotNo", on: cfg.showNumber },
    { id: "token", type: "token", on: true },
    { id: "roundLabel", type: "roundLabel", on: true },
    divider(1),
    { id: "orderId", type: "orderId", on: true },
    { id: "table", type: "table", on: cfg.showTable },
    { id: "time", type: "time", on: cfg.showTime },
    { id: "staff", type: "staff", on: cfg.showStaff },
    { id: "voidReason", type: "voidReason", on: true },
    divider(2),
    {
      id: "items",
      type: "items",
      on: true,
      options: { prices: cfg.showPrices, modifiers: true, instructions: true },
    },
    { id: "notes", type: "notes", on: cfg.showNotes },
    divider(3),
    { id: "itemCount", type: "itemCount", on: true },
    // Legacy printed the round total only with per-line prices: the old double gate is the block's `on`.
    { id: "roundTotal", type: "roundTotal", on: cfg.showTotal && cfg.showPrices },
  ];
  return { v: PRINT_TEMPLATE_VERSION, design: "classic", font: CLASSIC_PRINT_FONT, size: cfg.fontSize, blocks };
}
