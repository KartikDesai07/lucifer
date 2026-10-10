import type { BillBlockType } from "@pos/shared/print-template";
import { billThemedBlocks, type BillTheme } from "./bill-themed-blocks";
import type { SlipDesign, BillRenderers } from "./slip-designs";
import { plainAmount, plainHalfGst } from "./slip-format";
import { CLASSIC_BILL_GROUP } from "./slip-groups";
import { THEMED_REGULAR_CLASS } from "./slip-style";

// Bill design "Express" (previews/designs.mjs express): condensed (Barlow), a centred upper-case name, double
// rules, upper-case item lines with dotted leaders ("2 x MASALA CHAI ....... 80") and a huge TOTAL line. Made for
// quick service and 58 mm paper. The token prints in a bordered box (S6), above the bill number by default.

const EXPRESS_THEME: BillTheme = {
  generic: {
    ruleMargin: "my-1.5",
    defaultStyle: "double",
    qrLayout: "centreBeside",
    captionClass: "font-bold uppercase leading-tight",
    textClass: "text-center font-bold uppercase",
  },
  headingFace: undefined,
  logoClass: "mx-auto block",
  nameClass: "text-[2em] font-bold uppercase leading-none tracking-wide",
  taglineClass: "font-bold uppercase",
  taglineTilde: false,
  contactClass: "text-[0.9em]",
  headerTextClass: "font-bold",
  titleClass: "text-center font-bold uppercase tracking-widest",
  metaStyle: "split",
  metaClass: "",
  billNoClass: "text-[1.3em] font-bold leading-tight",
  tokenBox: true,
  cashierLabel: "Staff",
  itemQtyFirst: true,
  itemClass: "font-bold uppercase",
  leaders: false,
  amount: plainAmount,
  halfAmount: plainHalfGst,
  totalKind: "huge",
  totalLabel: "TOTAL",
  footerClass: "text-center text-[1.1em] font-bold uppercase tracking-wide",
};

export const BILL_EXPRESS_DESIGN: SlipDesign<BillRenderers, BillBlockType> = {
  blocks: billThemedBlocks(EXPRESS_THEME),
  groupOf: CLASSIC_BILL_GROUP,
  groupClass: {
    billHeader: "flex flex-col gap-0.5 text-center",
    billMeta: "flex flex-col gap-0.5",
    billTotals: "flex flex-col gap-0.5",
  },
  rootClass: "font-medium wrap-anywhere leading-tight",
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};
