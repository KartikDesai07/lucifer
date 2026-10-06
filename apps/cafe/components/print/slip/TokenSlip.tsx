"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode, type Ref } from "react";

import { tokenBlockLocked, type TokenBlock, type TokenBlockType } from "@pos/shared/print-template";
import { PrintBanner } from "@/components/pos/PrintBanner";
import { PAPER_WIDTH_CLASS, PRINT_FONT_CLASS, printConfigOf } from "@/lib/print";
import { tokenTemplateOf } from "@/lib/print-template-resolve";
import type { Order, Settings } from "@/types";
import { renderBlocks, slipRoot } from "./SlipEngine";
import { loadSlipCode, slipCodeStatus, subscribeSlipCode, tokenTemplateNeedsSlipCode } from "./slip-code";
import { slipHasDevanagari } from "./slip-context";
import { tokenDesignSpec, type SlipDesign, type TokenRenderers } from "./slip-designs";
import { TOKEN_LOCK_CONTEXT, tokenSlipContext, type TokenRenderContext } from "./token-blocks";

// The customer's token slip (print customization S7): the order's token number on its own slip, printed right after
// the round-1 kitchen ticket. A token has no legacy slip, so its designs are EAGER (slip-designs.ts tokenDesignSpec):
// it prints in the design at once and never waits on the lazy chunk. Only the QR encoder is lazy (slip-code.ts):
// while it loads a QR line renders nothing (never a skeleton on a print surface) and this slip re-renders once it
// is in. A stored template that cannot be read prints the default design (lib/print-template-resolve.ts). The slip
// is as wide as the BILL paper (it prints on the bill's device and lane), never the kitchen ticket's.

export interface TokenSlipProps {
  order: Order | null;
  settings?: Settings | null;
  // "DUPLICATE" on a token printed again. Absent on a first print.
  banner?: string;
  ref?: Ref<HTMLDivElement>;
}

// Dispatching a block to its renderer is the same correlated-union step as the bill's and the kitchen ticket's
// (SlipEngine.tsx): the map is keyed by block.type and each entry takes that type's block shape.
function renderTokenBlock(block: TokenBlock, ctx: TokenRenderContext, design: SlipDesign<TokenRenderers, TokenBlockType>): ReactNode {
  const render = design.blocks[block.type] as (b: TokenBlock, c: TokenRenderContext) => ReactNode;
  return render(block, ctx);
}

export function TokenSlip({ order, settings, banner, ref }: TokenSlipProps) {
  const template = useMemo(() => tokenTemplateOf(settings), [settings]);
  const needsCode = tokenTemplateNeedsSlipCode(template);
  // Subscribing is what re-renders the slip when the QR encoder arrives.
  useSyncExternalStore(subscribeSlipCode, slipCodeStatus, slipCodeStatus);
  useEffect(() => {
    // Only a first ask fetches from here (a failed fetch is retried when the print host mounts, as for the receipts).
    if (needsCode && slipCodeStatus() === "idle") void loadSlipCode();
  }, [needsCode]);

  const design = tokenDesignSpec(template.design);
  // No order, or an order with no token number, has nothing to print: an empty root, as OrderReceipt does for no order.
  const base = order !== null && order.tokenNumber !== undefined ? tokenSlipContext(order, settings) : null;
  const devanagari = slipHasDevanagari([order, base?.name, template.blocks]);
  const ctx: TokenRenderContext | null = base ? { ...base, devanagari } : null;
  const visible = template.blocks.filter((b) => b.on || tokenBlockLocked(b.type, TOKEN_LOCK_CONTEXT));
  const paper = PAPER_WIDTH_CLASS[printConfigOf(settings).bill.paperWidth];
  const root = slipRoot(paper, PRINT_FONT_CLASS[template.size], design.rootClass, template.font, devanagari);

  return (
    <div ref={ref} className={root.className} style={root.style}>
      {ctx && (
        <>
          <PrintBanner text={banner} />
          {renderBlocks(
            visible,
            design,
            (block) => renderTokenBlock(block, ctx, design),
            (block) => tokenBlockLocked(block.type, TOKEN_LOCK_CONTEXT),
          )}
        </>
      )}
    </div>
  );
}
