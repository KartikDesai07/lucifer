import { kotBlockLocked, type KotBlock, type KotDesign } from "@pos/shared/print-template";
import { kotLockContext, kotSlipContext } from "@/components/print/slip/slip-context";
import { kitchenLinesOf, kitchenOrderOf } from "@/lib/kitchen-lines";
import { printConfigOf } from "@/lib/print";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { kotTemplateOf } from "@/lib/print-template-resolve";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import {
  PICTURE_ONLY,
  TEXT_BASE_RATIO,
  TEXT_BLOCK_SIZE_RATIO,
  TEXT_LOCKED_MIN_SIZE,
  textRow,
  type KotTextContext,
  type KotTextDesign,
  type PictureOnly,
} from "./kot-text-design";
import { escposTextJob } from "./text-escpos";
import { layoutRows, type TextColumns, type TextPiece, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.1, S3): a kitchen-surface slip as ESC/POS text, or the reason it must print as
// a picture. Pure; the print bridge (Session 4B) calls it right before the picture path and uses its bytes only when it
// answers ok. It reads the slip exactly as the picture does: the kitchen view of the order (PrintSources.tsx), the stored
// template or the legacy ticket's own Classic template (KOTReceipt.tsx), the blocks SlipEngine shows and the banner.

/** The text renderer of each design it knows. A design not listed prints as a picture. */
export const KOT_TEXT_DESIGNS: Partial<Record<KotDesign, KotTextDesign>> = {
  classic: KOT_TEXT_CLASSIC,
};

/** Why a slip prints as a picture: an unknown design or block, a logo or QR code, a character text cannot print, nothing
 *  to print (the picture path then says so itself), or an error in this code. */
export type KotTextRefusal = "design" | "block" | "picture" | "characters" | "empty" | "error";

export interface KotTextInput {
  slip: HostKotSlip;
  settings: Settings | null | undefined;
  columns: TextColumns;
}

export type KotTextPlan = { ok: true; pieces: TextPiece[] } | { ok: false; refusal: KotTextRefusal };
export type KotTextResult = { ok: true; bytes: Uint8Array } | { ok: false; refusal: KotTextRefusal };

/** The banner's look (components/pos/PrintBanner.tsx: 1.29em, bold, centred, white on black). */
const BANNER_RATIO = 1.29;

// SlipEngine's kotBlockVisible: "Show ticket number" alone decides the number; every other block prints when it is on
// or its lock forces it.
function blockVisible(block: KotBlock, ctx: ReturnType<typeof kotLockContext>, showNumber: boolean): boolean {
  if (block.type === "kotNo") return showNumber;
  return block.on || kotBlockLocked(block.type, ctx);
}

// A block's own size / alignment / weight (slip-style.ts), on top of its design's group size and the template's base
// size. A rule keeps its line; a feed is a feed.
function styled(rows: TextRow[], block: KotBlock, locked: boolean, groupRatio: number, baseRatio: number): TextRow[] {
  const size = locked && block.size === "xs" ? TEXT_LOCKED_MIN_SIZE : block.size;
  const factor = baseRatio * groupRatio * (size === undefined ? 1 : TEXT_BLOCK_SIZE_RATIO[size]);
  return rows.map((row) => {
    if (row.kind === "rule" || row.kind === "feed") return row;
    return {
      ...row,
      style: { ...row.style, ratio: row.style.ratio * factor, align: block.align ?? row.style.align, bold: block.bold ?? row.style.bold },
    };
  });
}

/** The slip's printed pieces, or why it prints as a picture. Throws only on a bug (kotTextJob catches it). */
export function kotTextPlan({ slip, settings, columns }: KotTextInput): KotTextPlan {
  const template = kotTemplateOf(settings) ?? classicKotTemplate(settings);
  const design = Object.hasOwn(KOT_TEXT_DESIGNS, template.design) ? KOT_TEXT_DESIGNS[template.design] : undefined;
  if (design === undefined) return { ok: false, refusal: "design" };
  const base = kotSlipContext(kitchenOrderOf(slip.order), settings, {
    roundItems: slip.kotRoundItems ? [...kitchenLinesOf(slip.kotRoundItems)] : undefined,
    roundLabel: slip.kotRoundLabel,
    roundNumber: slip.kotRoundNumber,
    variant: slip.kotVariant,
    reason: slip.voidReason,
    voidedBy: slip.voidedBy,
    voidedAt: slip.voidedAt,
    movedFrom: slip.movedFrom,
    movedBy: slip.movedBy,
    movedAt: slip.movedAt,
    stationLine: slip.stationLine,
  });
  const lockCtx = kotLockContext(base);
  const visible = template.blocks.filter((block) => blockVisible(block, lockCtx, printConfigOf(settings).kot.showNumber));
  const ctx: KotTextContext = { ...base, showsPrices: visible.some((block) => block.type === "items" && block.options.prices) };
  const baseRatio = TEXT_BASE_RATIO[template.size];
  const rows: TextRow[] = slip.banner ? [textRow(slip.banner, BANNER_RATIO * baseRatio, true, "center", { invert: true })] : [];
  for (const block of visible) {
    if (!Object.hasOwn(design.rows, block.type)) return { ok: false, refusal: "block" };
    // One correlated-union step TypeScript cannot follow (as in SlipEngine): the renderer is keyed by block.type.
    const render = design.rows[block.type] as (b: KotBlock, c: KotTextContext) => TextRow[] | PictureOnly;
    const out = render(block, ctx);
    if (out === PICTURE_ONLY) return { ok: false, refusal: "picture" };
    rows.push(...styled(out, block, kotBlockLocked(block.type, lockCtx), design.groupRatio[block.type] ?? 1, baseRatio));
  }
  const pieces = layoutRows(rows, columns);
  if (pieces === null) return { ok: false, refusal: "characters" };
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) return { ok: false, refusal: "empty" };
  return { ok: true, pieces };
}

/** The slip as ESC/POS text bytes, or why it prints as a picture. Never throws (spec S3): any error is a refusal, and a
 *  refusal is decided before a single byte is sent. */
export function kotTextJob(input: KotTextInput): KotTextResult {
  try {
    const plan = kotTextPlan(input);
    return plan.ok ? { ok: true, bytes: escposTextJob(plan.pieces, input.columns) } : plan;
  } catch {
    return { ok: false, refusal: "error" };
  }
}
