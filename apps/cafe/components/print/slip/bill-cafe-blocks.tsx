import type { BillBlockType } from "@pos/shared/print-template";
import { BILL_DESIGN_FACES } from "@/lib/print-template-designs";
import { billThemedBlocks, type BillTheme } from "./bill-themed-blocks";
import type { SlipDesign, BillRenderers } from "./slip-designs";
import { CLASSIC_BILL_GROUP } from "./slip-groups";
import { THEMED_REGULAR_CLASS } from "./slip-style";
import { formatHalfGst } from "@/lib/gst-half";
import { inr } from "@/lib/utils";

// Bill design "Cafe" (previews/designs.mjs cafe): everything centred, slab headings (name, tagline as "~ tagline ~",
// title, footer, the total's label), ornament dividers, item lines "Name × 2 ....... ₹80" with leaders and a BOXED,
// rounded total. Sans (Inter) carries the body and every amount: the slab face has no tabular figures and no ₹.

// The heading face comes from the design's own face list (lib/print-template-designs.ts), so the font preload and
// this renderer can never disagree about which family a Cafe slip names.
const HEADING_FACE = BILL_DESIGN_FACES.cafe[0];

const CAFE_THEME: BillTheme = {
  generic: {
    ruleMargin: "my-2",
    defaultStyle: "ornament",
    qrLayout: "centreUnder",
    captionClass: "text-[0.85em] italic",
    textClass: "italic",
  },
  headingFace: HEADING_FACE,
  logoClass: "mx-auto block",
  nameClass: "mt-1 text-[1.6em] font-bold leading-tight",
  taglineClass: "",
  taglineTilde: true,
  contactClass: "text-[0.9em]",
  headerTextClass: "italic",
  titleClass: "font-bold tracking-wider",
  metaStyle: "inline",
  metaClass: "text-[0.92em]",
  billNoClass: "font-bold",
  cashierLabel: "Served by",
  itemQtyFirst: false,
  itemClass: "font-bold",
  leaders: true,
  amount: inr,
  halfAmount: formatHalfGst,
  totalKind: "box",
  totalLabel: "Total",
  footerClass: "text-[1.15em] font-bold",
};

export const BILL_CAFE_DESIGN: SlipDesign<BillRenderers, BillBlockType> = {
  blocks: billThemedBlocks(CAFE_THEME),
  groupOf: CLASSIC_BILL_GROUP,
  groupClass: {
    billHeader: "flex flex-col gap-0.5",
    billMeta: "flex flex-col gap-0.5",
    billTotals: "flex flex-col gap-0.5",
  },
  // text-center on the root: every line is centred without hard-coding it per line, so a block's own alignment wins.
  rootClass: "text-center font-medium wrap-anywhere leading-[1.4]",
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};
