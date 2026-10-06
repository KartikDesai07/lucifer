import type { TokenBlockType } from "@pos/shared/print-template";
import type { SlipDesign, TokenRenderers } from "./slip-designs";
import { Band } from "./slip-rows";
import { THEMED_REGULAR_CLASS } from "./slip-style";
import {
  BAND_NUMBER_SIZES_PX,
  BIG_NUMBER_SIZES_PX,
  TOKEN_BAND_TEXT,
  tokenBlocks,
  type TokenTheme,
} from "./token-blocks";

// The two token designs (previews/designs.mjs tokenBig / tokenItems). Both are eager: a token has no legacy slip to
// fall back to, so neither waits on the lazy chunk.

// Big Number: everything centred, the number as large as the paper allows, dashed rules around it.
const BIG_NUMBER_THEME: TokenTheme = {
  generic: {
    ruleMargin: "my-1.5",
    defaultStyle: "dashed",
    qrLayout: "centreBeside",
    captionClass: "text-[0.86em] font-bold",
    textClass: "text-center font-bold",
  },
  nameClass: "text-center text-[1.07em] font-bold uppercase tracking-[0.12em]",
  labelClass: "text-center text-[0.93em] font-bold tracking-[0.32em]",
  messageClass: "mt-1 text-center font-bold",
  dateClass: "text-center text-[0.86em]",
  dateWithYear: true,
  dateSeparator: " · ",
  billSuffix: true,
  itemsClass: "space-y-0.5 text-center font-bold",
  itemCountClass: "text-[0.86em]",
  numberSizes: BIG_NUMBER_SIZES_PX,
  frame: (number) => <div className="my-1 text-center">{number}</div>,
};

// Number + Items: the cafe name and the time on one head row, the number in an inverted band, then what was ordered.
const NUMBER_ITEMS_THEME: TokenTheme = {
  generic: {
    ruleMargin: "my-1.5",
    defaultStyle: "dashed",
    qrLayout: "centreUnder",
    captionClass: "text-[0.86em] font-bold",
    textClass: "text-center font-bold",
  },
  nameClass: "min-w-0 text-[1.07em] font-bold",
  labelClass: "text-[0.93em] font-bold tracking-[0.2em]",
  messageClass: "text-center font-bold",
  dateClass: "ml-auto text-right text-[0.86em]",
  dateWithYear: false,
  dateSeparator: ", ",
  billSuffix: false,
  itemsClass: "space-y-0.5 font-semibold",
  itemCountClass: "text-[0.86em]",
  numberSizes: BAND_NUMBER_SIZES_PX,
  // flex-wrap: a number too wide to share the band with the word TOKEN drops to its own line, still inside the band.
  frame: (number) => (
    <Band className="my-1.5 flex flex-wrap items-center justify-between gap-x-2 px-2.5 py-1">
      <span className="text-[0.8em] font-bold tracking-[0.15em]">{TOKEN_BAND_TEXT}</span>
      {number}
    </Band>
  ),
};

// wrap-anywhere: a long cafe name or dish wraps instead of running off the slip (as Kitchen Bold does).
const TOKEN_ROOT_CLASS = "font-medium wrap-anywhere leading-snug";

export const BIG_NUMBER_DESIGN: SlipDesign<TokenRenderers, TokenBlockType> = {
  blocks: tokenBlocks(BIG_NUMBER_THEME),
  groupOf: {},
  groupClass: {},
  rootClass: TOKEN_ROOT_CLASS,
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};

export const NUMBER_ITEMS_DESIGN: SlipDesign<TokenRenderers, TokenBlockType> = {
  blocks: tokenBlocks(NUMBER_ITEMS_THEME),
  // The head row: consecutive name + date-time share one wrapper (slip-groups.ts), name left and date-time right.
  groupOf: { name: "tokenHead", dateTime: "tokenHead" },
  groupClass: { tokenHead: "flex flex-wrap items-baseline justify-between gap-x-2" },
  rootClass: TOKEN_ROOT_CLASS,
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};
