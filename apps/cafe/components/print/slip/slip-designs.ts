import type { ReactNode } from "react";

import type {
  BillBlockOf,
  BillBlockType,
  BillDesign,
  KotBlockOf,
  KotBlockType,
  KotDesign,
  TokenBlockOf,
  TokenBlockType,
  TokenDesign,
} from "@pos/shared/print-template";
import { BILL_CLASSIC_BLOCKS } from "./bill-classic-blocks";
import { KOT_CLASSIC_BLOCKS } from "./kot-classic-blocks";
import { loadedSlipCode } from "./slip-code";
import { CLASSIC_BILL_GROUP, CLASSIC_GROUP_CLASS, CLASSIC_KOT_GROUP } from "./slip-groups";
import type { BillRenderContext, KotRenderContext } from "./slip-context";
import { CLASSIC_REGULAR_CLASS } from "./slip-style";
import { BIG_NUMBER_DESIGN, NUMBER_ITEMS_DESIGN } from "./token-designs";
import type { TokenRenderContext } from "./token-blocks";

// The design registry (print customization S3, 01-PLAN A1.2): a design is its THEME renderers plus the groups that
// restore its wrappers; its default block list lives in lib/print-template-designs.ts. The engine looks a design up
// here and never names one. Classic is eager; every other design is in the lazy slip chunk (R6, slip-code.ts).

export type BillRenderers = { [T in BillBlockType]: (block: BillBlockOf<T>, ctx: BillRenderContext) => ReactNode };
export type KotRenderers = { [T in KotBlockType]: (block: KotBlockOf<T>, ctx: KotRenderContext) => ReactNode };
export type TokenRenderers = { [T in TokenBlockType]: (block: TokenBlockOf<T>, ctx: TokenRenderContext) => ReactNode };

export interface SlipDesign<R, T extends string> {
  blocks: R;
  /** Block type -> group key. Consecutive visible blocks of one group share one wrapper (slip-groups.ts). */
  groupOf: Partial<Record<T, string>>;
  /** Group key -> the wrapper's whole literal className. */
  groupClass: Record<string, string>;
  /** Extra root classes after the engine's own ("" for Classic, which must stay byte-identical). */
  rootClass: string;
  /** Classic keeps the legacy markup semantics: a visible block's run emits its wrapper even when it prints nothing.
   *  Every other design drops a block that prints nothing BEFORE grouping, so no empty wrapper is left behind. */
  classic: boolean;
  /** What "not bold" forces on a block: the design's regular weight (slip-style.ts). */
  regularClass: string;
}

// A4 (s78): a customized Classic bill wraps an unbroken word instead of running off the slip. `break-words` never
// changes a box's min-content size, so wherever today's bill fits, the template-path Classic lays out the same.
// S5 (s79): the kitchen ticket's Classic gets the same root class (and the same wrapping `Line`).
const CLASSIC_BILL_ROOT_CLASS = "break-words";
const CLASSIC_KOT_ROOT_CLASS = "break-words";

const CLASSIC_BILL_SPEC: SlipDesign<BillRenderers, BillBlockType> = {
  blocks: BILL_CLASSIC_BLOCKS,
  groupOf: CLASSIC_BILL_GROUP,
  groupClass: CLASSIC_GROUP_CLASS,
  rootClass: CLASSIC_BILL_ROOT_CLASS,
  classic: true,
  regularClass: CLASSIC_REGULAR_CLASS,
};

const CLASSIC_KOT_SPEC: SlipDesign<KotRenderers, KotBlockType> = {
  blocks: KOT_CLASSIC_BLOCKS,
  groupOf: CLASSIC_KOT_GROUP,
  groupClass: CLASSIC_GROUP_CLASS,
  rootClass: CLASSIC_KOT_ROOT_CLASS,
  classic: true,
  regularClass: CLASSIC_REGULAR_CLASS,
};

// A receipt renders a non-Classic design only once its useSlipCode said "ready", so the chunk is loaded here. The
// Classic fallback only keeps a slip from ever printing blank if a caller skips that.

export function billDesignSpec(design: BillDesign): SlipDesign<BillRenderers, BillBlockType> {
  if (design === "classic") return CLASSIC_BILL_SPEC;
  return loadedSlipCode()?.bill[design] ?? CLASSIC_BILL_SPEC;
}

export function kotDesignSpec(design: KotDesign): SlipDesign<KotRenderers, KotBlockType> {
  if (design === "classic") return CLASSIC_KOT_SPEC;
  return loadedSlipCode()?.kot[design] ?? CLASSIC_KOT_SPEC;
}

// A token has no legacy slip to fall back to, so its designs are EAGER (S7): they are in the main bundle and print at
// once. Only the QR encoder stays in the lazy chunk (tokenTemplateNeedsSlipCode, slip-code.ts).
const TOKEN_DESIGN_SPECS: Record<TokenDesign, SlipDesign<TokenRenderers, TokenBlockType>> = {
  bigNumber: BIG_NUMBER_DESIGN,
  numberItems: NUMBER_ITEMS_DESIGN,
};

export function tokenDesignSpec(design: TokenDesign): SlipDesign<TokenRenderers, TokenBlockType> {
  return TOKEN_DESIGN_SPECS[design];
}
