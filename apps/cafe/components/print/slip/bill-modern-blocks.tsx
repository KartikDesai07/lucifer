import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { inr } from "@/lib/utils";
import type { OrderItem } from "@/types";
import { billThemedBlocks, type BillTheme } from "./bill-themed-blocks";
import type { SlipDesign, BillRenderers } from "./slip-designs";
import { plainAmount, plainHalfGst } from "./slip-format";
import { CLASSIC_BILL_GROUP } from "./slip-groups";
import { THEMED_REGULAR_CLASS } from "./slip-style";
import type { BillBlockType } from "@pos/shared/print-template";

// Bill design "Modern" (owner-approved mockup: previews/designs.mjs modern): the logo floats left beside the name
// and tagline, a two-column label / value meta list, an item table (name / qty / amount, rate and modifiers on a
// small line underneath) and an INVERTED total band. Sans (Inter).

const MODERN_THEME: BillTheme = {
  generic: {
    ruleMargin: "my-2",
    defaultStyle: "solid",
    qrLayout: "left",
    captionClass: "font-bold",
    textClass: "text-center",
  },
  headingFace: undefined,
  logoClass: "float-left mr-2.5",
  nameClass: "text-[1.5em] font-bold leading-tight tracking-tight",
  taglineClass: "font-bold",
  taglineTilde: false,
  // clear-left: the address and below start under the floated logo, never squeezed beside it.
  contactClass: "clear-left text-[0.92em]",
  headerTextClass: "italic",
  titleClass: "text-center text-[0.92em] font-bold tracking-[0.14em]",
  metaStyle: "labelled",
  metaClass: "",
  billNoClass: "font-bold",
  cashierLabel: "Staff",
  itemQtyFirst: false,
  itemClass: "font-bold",
  leaders: false,
  amount: plainAmount,
  halfAmount: plainHalfGst,
  totalKind: "band",
  totalLabel: "TOTAL",
  footerClass: "text-center font-bold",
};

const AMOUNT_CELL = "w-[4.5em] shrink-0 text-right tabular-nums";
const QTY_CELL = "w-[2.5em] shrink-0 text-center tabular-nums";
const HEAD_CELL = "text-[0.75em] font-bold uppercase tracking-wider";

const themed = billThemedBlocks(MODERN_THEME);

// The small line's tail: a reward's marker, the modifiers, the instructions.
const extrasOf = (item: OrderItem): string[] => [
  ...(item.reward && item.note ? [item.note] : []),
  ...orderItemModifierLines(item),
  ...(item.instructions ? [item.instructions] : []),
];

const MODERN_BLOCKS: BillRenderers = {
  ...themed,
  // The item table. A reward line says FREE in the amount column and shows its worth struck through underneath.
  items: (_block, { order }) => (
    <div>
      <div className="flex items-baseline border-b border-black pb-0.5">
        <span className={`min-w-0 flex-1 ${HEAD_CELL}`}>Item</span>
        <span className={QTY_CELL}><span className={HEAD_CELL}>Qty</span></span>
        <span className={AMOUNT_CELL}><span className={HEAD_CELL}>Amount</span></span>
      </div>
      <div className="flex flex-col gap-1 pt-1">
        {order.items.map((item, i) => (
          <div key={`${item.productId}-${i}`}>
            <div className="flex items-baseline">
              <span className="min-w-0 flex-1 font-bold">{orderItemLabel(item)}</span>
              <span className={QTY_CELL}>{item.qty}</span>
              <span className={AMOUNT_CELL}>{item.reward ? "FREE" : plainAmount(item.price * item.qty)}</span>
            </div>
            <div className="text-[0.85em]">
              {item.reward ? <span className="line-through">{inr(item.price * item.qty)}</span> : `@ ${plainAmount(item.price)}`}
              {extrasOf(item).map((text) => ` · ${text}`)}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const BILL_MODERN_DESIGN: SlipDesign<BillRenderers, BillBlockType> = {
  blocks: MODERN_BLOCKS,
  groupOf: CLASSIC_BILL_GROUP,
  groupClass: {
    billHeader: "flow-root",
    billMeta: "flex flex-col gap-0.5",
    billTotals: "flex flex-col gap-0.5",
  },
  rootClass: "font-medium wrap-anywhere leading-[1.35]",
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};
