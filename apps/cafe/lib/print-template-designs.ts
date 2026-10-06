import {
  PRINT_TEMPLATE_VERSION,
  type BillBlock,
  type BillBlockType,
  type BillDesign,
  type BillTemplate,
  type KotBlock,
  type KotBlockType,
  type KotDesign,
  type KotTemplate,
  type TokenBlock,
  type TokenDesign,
  type TokenTemplate,
} from "@pos/shared/print-template";
import { printFontFaceOf, printFontStackFaces, type PrintFontFace } from "@pos/shared/print-fonts";
import type { PrintLogoSize } from "@/lib/constants";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";

// The built-in designs (print customization S3, 01-PLAN Amendment A1.2): a design is a THEME (its renderers, in
// components/print/slip/) plus the default block list below. Pure: the engine, the S2 resolver (which re-inserts a
// missing required block after its neighbour in THIS order) and the font preload all read it.
//
// Every default list carries every non-repeatable block type of its kind exactly once, on or off, so the editor
// (S4/S5) only ever toggles a line rather than having to know where a missing one belongs. Classic's default IS
// Classic-from-legacy (the converter), so "Reset to design" on Classic restores today's slip exactly.

type SettingsArg = Parameters<typeof classicBillTemplate>[0];

type PlainBillType = Exclude<BillBlockType, "logo" | "divider" | "customText" | "qr">;
type PlainKotType = Exclude<KotBlockType, "logo" | "divider" | "customText" | "qr" | "items">;

// A plain block's id is its type. The cast: TypeScript cannot match a 25+-member type union against the block union.
const bill = (type: PlainBillType, on = true): BillBlock => ({ id: type, type, on }) as BillBlock;
const kot = (type: PlainKotType, on = true): KotBlock => ({ id: type, type, on }) as KotBlock;
const billLogo = (on: boolean, logoSize: PrintLogoSize): BillBlock => ({ id: "logo", type: "logo", on, options: { logoSize } });
const divider = <B extends BillBlock | KotBlock | TokenBlock>(n: number, style?: "dashed" | "solid"): B =>
  (style ? { id: `divider-${n}`, type: "divider", on: true, options: { style } } : { id: `divider-${n}`, type: "divider", on: true }) as B;
const token = (type: "name" | "tokenNo" | "label" | "dateTime" | "items" | "message", on = true): TokenBlock =>
  ({ id: type, type, on }) as TokenBlock;
const tokenLogo = (): TokenBlock => ({ id: "logo", type: "logo", on: false, options: { logoSize: "small" } });
const upiQr = (): BillBlock => ({ id: "qr-1", type: "qr", on: true, options: { content: "upi" } });

// Shared runs. The totals keep legacy's order (tax line before the charges, inclusive note after the total) with
// the loyalty line right before the total; the meta keeps the cancelled bill's reason last. Functions, not shared
// constants: every default is built fresh, so an editor changing one block in place can never leak into the next.
const billTotals = (): BillBlock[] => [
  bill("subtotal"), bill("discount"), bill("taxes"), bill("charges"), bill("loyalty"),
];
const billTotalTail = (): BillBlock[] => [bill("total"), bill("taxIncluded"), bill("payment"), bill("due")];

function modernBlocks(): BillBlock[] {
  return [
    billLogo(true, "small"), bill("name"), bill("tagline"), bill("address"), bill("phone"), bill("gstin"),
    bill("fssai"), bill("headerText", false),
    divider(1),
    bill("title"), bill("cancelBanner"), bill("billNo"), bill("token"), bill("dateTime"), bill("orderId"),
    bill("table"), bill("customer", false), bill("cashier"), bill("cancelReason"),
    divider(2),
    bill("items"),
    divider(3),
    ...billTotals(), ...billTotalTail(),
    upiQr(),
    bill("footerText"), bill("printedAt"),
  ];
}

function expressBlocks(): BillBlock[] {
  return [
    billLogo(false, "small"), bill("name"), bill("tagline", false), bill("address"), bill("phone", false),
    bill("gstin"), bill("fssai"), bill("headerText", false),
    divider(1),
    bill("title"), bill("cancelBanner"), bill("token"), bill("billNo"), bill("dateTime"), bill("orderId"),
    bill("table"), bill("customer", false), bill("cashier"), bill("cancelReason"),
    divider(2),
    bill("items"),
    divider(3, "solid"),
    ...billTotals(),
    divider(4),
    ...billTotalTail(),
    divider(5),
    upiQr(),
    bill("footerText"), bill("printedAt", false),
  ];
}

function cafeBlocks(): BillBlock[] {
  return [
    billLogo(true, "medium"), bill("name"), bill("tagline"), bill("address"), bill("phone"), bill("gstin"),
    bill("fssai"),
    divider(1),
    bill("headerText"), bill("title"), bill("cancelBanner"), bill("billNo"), bill("token"), bill("dateTime"),
    bill("orderId"), bill("table"), bill("customer", false), bill("cashier"), bill("cancelReason"),
    divider(2),
    bill("items"),
    divider(3, "dashed"),
    ...billTotals(), ...billTotalTail(),
    upiQr(),
    divider(4),
    bill("footerText"), bill("printedAt", false),
  ];
}

function kitchenBoldBlocks(): KotBlock[] {
  return [
    { id: "logo", type: "logo", on: false, options: { logoSize: "small" } }, kot("name", false),
    // Off: like Classic's bill title, it prints only when the VOID / TABLE MOVED lock forces the banner — first,
    // so a cook sees it before anything else.
    kot("title", false), kot("station"),
    kot("kotNo"), kot("token"), kot("table"), kot("roundLabel"), kot("time"), kot("staff"), kot("orderId"),
    kot("voidReason"),
    divider(1),
    { id: "items", type: "items", on: true, options: { prices: false, modifiers: true, instructions: true } },
    divider(2),
    kot("notes"), kot("itemCount"), kot("roundTotal", false),
  ];
}

// Token slips (S7). Like every default, each carries every non-repeatable block type of its kind once, on or off (the
// logo, and the lines a design does not use, sit OFF). No QR by default: its link has no default (the write gate
// needs a real https URL). The number block is the one the lock keeps on.
function bigNumberBlocks(): TokenBlock[] {
  return [
    tokenLogo(), token("name"), divider(1), token("label"), token("tokenNo"), divider(2), token("dateTime"),
    token("items", false), token("message"),
  ];
}

function numberItemsBlocks(): TokenBlock[] {
  return [
    tokenLogo(), token("name"), token("dateTime"), token("label", false), token("tokenNo"), token("items"),
    divider(1), token("message"),
  ];
}

// Owner decision (S7): a cafe that never picked a token design, or whose stored one cannot be read, prints Big Number.
export const TOKEN_DEFAULT_DESIGN: TokenDesign = "bigNumber";

// Base type size and face per design (the template can change both). Paper width stays Settings policy (C6).
const BILL_DESIGN_BASE: Record<Exclude<BillDesign, "classic">, Pick<BillTemplate, "font" | "size">> = {
  modern: { font: "sans", size: "small" },
  express: { font: "condensed", size: "normal" },
  cafe: { font: "sans", size: "small" },
};

/** The design's default template. Classic's is Classic-from-legacy, so it follows the cafe's legacy toggles. */
export function defaultBillTemplate(design: BillDesign, settings: SettingsArg): BillTemplate {
  if (design === "classic") return classicBillTemplate(settings);
  const blocks = design === "modern" ? modernBlocks() : design === "express" ? expressBlocks() : cafeBlocks();
  return { v: PRINT_TEMPLATE_VERSION, design, ...BILL_DESIGN_BASE[design], blocks };
}

export function defaultKotTemplate(design: KotDesign, settings: SettingsArg): KotTemplate {
  if (design === "classic") return classicKotTemplate(settings);
  return { v: PRINT_TEMPLATE_VERSION, design, font: "condensed", size: "normal", blocks: kitchenBoldBlocks() };
}

/** The design's default token template. `_settings` mirrors the other kinds' signature; no token default reads it. */
export function defaultTokenTemplate(design: TokenDesign, _settings?: SettingsArg): TokenTemplate {
  const blocks = design === "bigNumber" ? bigNumberBlocks() : numberItemsBlocks();
  return { v: PRINT_TEMPLATE_VERSION, design, font: "sans", size: "normal", blocks };
}

// ── Faces ────────────────────────────────────────────────────────────────────
// The faces a design's renderers set ON TOP of the template's base font (Cafe's slab headings). The themes read
// these; lib/print-template-designs.test.ts pins every family a rendered slip names to templateFaces().
export const BILL_DESIGN_FACES: Record<BillDesign, readonly PrintFontFace[]> = {
  classic: [],
  modern: [],
  express: [],
  cafe: ["slab"],
};
export const KOT_DESIGN_FACES: Record<KotDesign, readonly PrintFontFace[]> = {
  classic: [],
  kitchenBold: [],
};

// Both token designs set the number in the display face (Archivo Black), on top of the base font.
export const TOKEN_DESIGN_FACES: Record<TokenDesign, readonly PrintFontFace[]> = {
  bigNumber: ["display"],
  numberItems: ["display"],
};

/** Every self-hosted face a slip printed from this template can name, fallbacks included (≤ PRINT_FONT_FAMILIES_MAX). */
export function templateFaces(
  template: Pick<BillTemplate, "font"> | Pick<KotTemplate, "font"> | Pick<TokenTemplate, "font">,
  designFaces: readonly PrintFontFace[],
  devanagari: boolean,
): PrintFontFace[] {
  const base = printFontFaceOf(template.font);
  const faces = new Set<PrintFontFace>();
  for (const face of base ? [base, ...designFaces] : designFaces) {
    for (const f of printFontStackFaces(face, devanagari)) faces.add(f);
  }
  return [...faces];
}
