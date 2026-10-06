"use client";

import { Fragment, type CSSProperties, type ReactNode, type Ref } from "react";

import {
  billBlockLocked,
  kotBlockLocked,
  type BillBlock,
  type BillBlockType,
  type BillTemplate,
  type KotBlock,
  type KotBlockType,
  type KotTemplate,
  type PrintFontKey,
  type SlipLockContext,
} from "@pos/shared/print-template";
import { printFontFaceOf, printFontStack } from "@pos/shared/print-fonts";
import { printConfigOf, PAPER_WIDTH_CLASS, PRINT_FONT_CLASS } from "@/lib/print";
import { PrintBanner } from "@/components/pos/PrintBanner";
import type { Order, OrderItem, Settings } from "@/types";
import { billDesignSpec, kotDesignSpec, type BillRenderers, type KotRenderers, type SlipDesign } from "./slip-designs";
import { isEmptyNode } from "./slip-format";
import { groupRuns } from "./slip-groups";
import { blockStyleClass, type BlockStyleFields } from "./slip-style";
import {
  billLockContext,
  billSlipContext,
  kotLockContext,
  kotSlipContext,
  slipHasDevanagari,
  type BillRenderContext,
  type KotRenderContext,
} from "./slip-context";

// The slip block engine (print customization S1-S3): renders a template's visible blocks in order, through the
// template's DESIGN (slip-designs.ts: its renderers, its group wrappers, its root classes), in the template's font
// and base size. A block's own size / align / bold wrap its markup (slip-style.ts); a block that sets none is
// emitted bare, which is what keeps Classic's legacy lines byte-identical. S2's dispatch (OrderReceipt /
// KOTReceipt) is the only caller.

export interface BillSlipProps {
  order: Order | null;
  settings?: Settings | null;
  // "DUPLICATE" on a bill printed again. Absent on a first print.
  banner?: string;
  // Render-time clock (epoch ms) for the pay QR's validity. Tests pin it; production omits it and gets Date.now().
  now?: number;
  template: BillTemplate;
  ref?: Ref<HTMLDivElement>;
}

// Every KOTReceipt prop, defined here (not imported from the legacy component: S2 makes that component import
// this engine, so an import back would be circular). Semantics are documented on KOTReceipt.
export interface KotSlipProps {
  order: Order | null;
  settings?: Settings | null;
  roundItems?: OrderItem[];
  roundLabel?: string;
  roundNumber?: number;
  variant?: "kot" | "void" | "moved";
  reason?: string;
  voidedBy?: string;
  voidedAt?: string | Date;
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string | Date;
  /** Phase 2: the routed station's name; the design's station block prints it. */
  stationLine?: string;
  banner?: string;
  template: KotTemplate;
  ref?: Ref<HTMLDivElement>;
}

// Dispatching a block to its renderer is one correlated-union step TypeScript cannot follow: the map is keyed by
// block.type and each entry takes that type's block shape. The cast is safe because the key IS block.type.
// A line prints when it is on or its lock forces it. The bill number is the one exception (owner, s78): "Show bill
// number" is its SOLE control on every design, as on today's bill (OrderReceipt gates it on billShowNumber alone), so
// the line's own `on` and its GST lock are ignored: turning numbering off also hides an old number on a reprint, and
// the editor's preview can never disagree with the print. Nothing switches numbering on by itself.
function billBlockVisible(block: BillBlock, lockCtx: SlipLockContext, showNumber: boolean): boolean {
  if (block.type === "billNo") return showNumber;
  return block.on || billBlockLocked(block.type, lockCtx);
}

// The kitchen ticket's number follows the same rule (owner, s79): "Show ticket number" is its SOLE control, so a
// reprint after numbering is turned off shows no old number, as on today's ticket (KOTReceipt gates on
// kotShowNumber alone). The renderers still print nothing on a moved slip, which is not a round.
function kotBlockVisible(block: KotBlock, lockCtx: SlipLockContext, showNumber: boolean): boolean {
  if (block.type === "kotNo") return showNumber;
  return block.on || kotBlockLocked(block.type, lockCtx);
}

function renderBillBlock(block: BillBlock, ctx: BillRenderContext, design: SlipDesign<BillRenderers, BillBlockType>): ReactNode {
  const render = design.blocks[block.type] as (b: BillBlock, c: BillRenderContext) => ReactNode;
  return render(block, ctx);
}

function renderKotBlock(block: KotBlock, ctx: KotRenderContext, design: SlipDesign<KotRenderers, KotBlockType>): ReactNode {
  const render = design.blocks[block.type] as (b: KotBlock, c: KotRenderContext) => ReactNode;
  return render(block, ctx);
}

// Paper width is Settings policy (01-PLAN C6), never the template's; the base size comes from the template.
// "geistMono" is the legacy slip's own face, so it keeps the root's `font-mono` class and today's exact string. Any
// other font drops the class and names its self-hosted stack inline (never a CSS variable or a font class: neither
// survives the react-to-print iframe or the raster lane).
export function slipRoot(
  paperClass: string,
  sizeClass: string,
  rootClass: string,
  font: PrintFontKey,
  devanagari: boolean,
): { className: string; style: CSSProperties | undefined } {
  const face = printFontFaceOf(font);
  const extra = rootClass === "" ? "" : ` ${rootClass}`;
  if (face === null) {
    return { className: `${paperClass} ${sizeClass} bg-white p-3 font-mono text-black${extra}`, style: undefined };
  }
  return {
    className: `${paperClass} ${sizeClass} bg-white p-3 text-black${extra}`,
    style: { fontFamily: printFontStack(face, devanagari) },
  };
}

// Renders each visible block, wraps it in its own size / align / bold, then restores the design's group wrappers by
// run-length grouping. A non-Classic design drops a block that prints nothing BEFORE grouping, so no empty wrapper
// is left behind; Classic keeps S1's semantics (a visible block's run emits its wrapper even when it renders
// nothing), which is what legacy markup does.
export function renderBlocks<B extends BlockStyleFields & { id: string; type: T }, T extends string>(
  blocks: readonly B[],
  design: Pick<SlipDesign<unknown, T>, "groupOf" | "groupClass" | "classic" | "regularClass">,
  renderBlock: (block: B) => ReactNode,
  isLocked: (block: B) => boolean,
): ReactNode {
  const entries = blocks.flatMap((block) => {
    const node = renderBlock(block);
    const empty = isEmptyNode(node);
    if (empty && !design.classic) return [];
    const styleClass = empty ? null : blockStyleClass(block, isLocked(block), design.regularClass);
    return [{ block, node: styleClass === null ? node : <div className={styleClass}>{node}</div> }];
  });
  return groupRuns(entries, (entry) => design.groupOf[entry.block.type]).map((run) => {
    const children = run.blocks.map((entry) => <Fragment key={entry.block.id}>{entry.node}</Fragment>);
    if (run.group === undefined) return children;
    return (
      <div key={run.blocks[0].block.id} className={design.groupClass[run.group]}>
        {children}
      </div>
    );
  });
}

export function BillSlip({ order, settings, banner, now, template, ref }: BillSlipProps) {
  const cfg = printConfigOf(settings).bill;
  const design = billDesignSpec(template.design);
  const base = order ? billSlipContext(order, settings, now) : null;
  const lockCtx = base ? billLockContext(base) : null;
  const visible = lockCtx ? template.blocks.filter((b) => billBlockVisible(b, lockCtx, cfg.showNumber)) : [];
  const devanagari = slipHasDevanagari([
    order, base?.name, base?.tagline, base?.address, base?.header, base?.footer, template.blocks,
  ]);
  const ctx: BillRenderContext | null = base ? { ...base, devanagari } : null;
  const root = slipRoot(PAPER_WIDTH_CLASS[cfg.paperWidth], PRINT_FONT_CLASS[template.size], design.rootClass, template.font, devanagari);

  return (
    <div ref={ref} className={root.className} style={root.style}>
      {ctx && lockCtx && (
        <>
          <PrintBanner text={banner} />
          {renderBlocks(
            visible,
            design,
            (block) => renderBillBlock(block, ctx, design),
            (block) => billBlockLocked(block.type, lockCtx),
          )}
        </>
      )}
    </div>
  );
}

export function KotSlip({ template, order, settings, banner, ref, ...rest }: KotSlipProps) {
  const cfg = printConfigOf(settings).kot;
  const design = kotDesignSpec(template.design);
  const base = order ? kotSlipContext(order, settings, rest) : null;
  const lockCtx = base ? kotLockContext(base) : null;
  const visible = lockCtx ? template.blocks.filter((b) => kotBlockVisible(b, lockCtx, cfg.showNumber)) : [];
  // Legacy's own rule: the round total needs line amounts, so it follows the visible items block's prices.
  const showsPrices = visible.some((b) => b.type === "items" && b.options.prices);
  const devanagari = slipHasDevanagari([order, rest, base?.restaurantName, template.blocks]);
  const ctx: KotRenderContext | null = base ? { ...base, showsPrices, devanagari } : null;
  const root = slipRoot(PAPER_WIDTH_CLASS[cfg.paperWidth], PRINT_FONT_CLASS[template.size], design.rootClass, template.font, devanagari);

  return (
    <div ref={ref} className={root.className} style={root.style}>
      {ctx && lockCtx && (
        <>
          <PrintBanner text={banner} />
          {renderBlocks(
            visible,
            design,
            (block) => renderKotBlock(block, ctx, design),
            (block) => kotBlockLocked(block.type, lockCtx),
          )}
        </>
      )}
    </div>
  );
}
