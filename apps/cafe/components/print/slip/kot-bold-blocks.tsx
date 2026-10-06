import Image from "next/image";

import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import type { KotBlockType } from "@pos/shared/print-template";
import { inr } from "@/lib/utils";
import { PRINT_LOGO_CLASS } from "@/lib/print";
import { genericCustomText, genericDivider, genericKotQr, type GenericTheme } from "./generic-blocks";
import type { SlipDesign, KotRenderers } from "./slip-designs";
import { fmtTime, LOGO_DIMENSIONS_PX } from "./slip-format";
import { Band } from "./slip-rows";
import { THEMED_REGULAR_CLASS } from "./slip-style";

// Kitchen ticket design "Kitchen Bold" (previews/designs.mjs kitchenBold): condensed (Barlow), made to be read
// from an arm's length. The KOT number sits in a bordered box floated left with the meta lines beside it, the table
// is big and bold, items are upper-case bold with the quantity in a bordered box, modifiers and instructions sit
// under them ("» " prefix: the faces lack the triangle Classic uses), notes are an INVERTED band, and a VOID /
// TABLE MOVED title is a loud inverted band. Same words and rules as Classic (kot-classic-blocks.tsx): a moved slip
// lists no items and prints no item count or round total.

const BOLD_GENERIC: GenericTheme = {
  ruleMargin: "my-1.5",
  defaultStyle: "double",
  qrLayout: "centreUnder",
  captionClass: "text-[0.86em] font-bold",
  textClass: "text-center font-bold",
};

const META_LINE_CLASS = "text-[0.9em]";
const SUB_LINE_CLASS = "text-[0.9em] font-bold";
const INSTRUCTION_PREFIX = "» ";

const KOT_BOLD_BLOCKS: KotRenderers = {
  logo: (block, { logoUrl }) => {
    const dim = LOGO_DIMENSIONS_PX[block.options.logoSize];
    return (
      logoUrl && (
        <Image
          src={logoUrl}
          alt="Logo"
          width={dim.width}
          height={dim.height}
          loading="eager"
          unoptimized
          className={`${PRINT_LOGO_CLASS[block.options.logoSize]} mx-auto block object-contain`}
        />
      )
    );
  },
  name: (_block, { restaurantName }) =>
    restaurantName && (
      <div className="text-center text-[1.2em] font-bold uppercase tracking-wide">{restaurantName}</div>
    ),
  // Loud on purpose, like Classic: a cook must never mistake a void or moved slip for a fresh ticket and fire it.
  title: (_block, { isMoved, isVoid }) =>
    isMoved ? (
      <Band className="px-2 py-1 text-center">
        <div className="text-[1.4em] font-bold tracking-widest">*** TABLE MOVED ***</div>
        <div className="text-[0.95em] font-bold">FOOD ALREADY ORDERED — DO NOT MAKE AGAIN</div>
      </Band>
    ) : isVoid ? (
      <Band className="px-2 py-1 text-center">
        <div className="text-[1.4em] font-bold tracking-widest">*** VOID ***</div>
        <div className="text-[0.95em] font-bold">CANCELLED ITEMS — DO NOT MAKE</div>
      </Band>
    ) : (
      <div className="text-center text-[1.1em] font-bold tracking-widest">KITCHEN ORDER</div>
    ),
  // Phase 2's station line (a routed KOT: "BAR", "ALL STATIONS"), big enough to read across a kitchen; nothing in
  // simple mode.
  station: (_block, { stationLine }) =>
    stationLine !== undefined && stationLine !== "" && (
      <div className="text-center text-[1.4em] font-black tracking-widest">{stationLine}</div>
    ),
  // The order's token (S6), beside the KOT box (it joins kotMeta), on every variant.
  token: (_block, { order }) =>
    order.tokenNumber !== undefined && (
      <div className="text-[1.25em] font-bold leading-none">{`TOKEN ${order.tokenNumber}`}</div>
    ),
  // The number a cook calls out, in a bordered box floated left; a moved slip is not a round and has none.
  kotNo: (_block, { isMoved, roundNumber }) =>
    !isMoved &&
    roundNumber !== undefined && (
      <div className="float-left mb-1 mr-2 border-[3px] border-black px-2 py-0.5 text-center">
        <div className="text-[0.75em] font-bold tracking-widest">KOT</div>
        <div className="text-[2.2em] font-bold leading-none tabular-nums">{roundNumber}</div>
      </div>
    ),
  roundLabel: (_block, { roundLabel }) => roundLabel && <div className="font-bold">{roundLabel}</div>,
  orderId: (_block, { order }) => <div className={META_LINE_CLASS}>Order {order.orderId}</div>,
  // A moved slip names FROM → TO so a cook can match it to the ticket already held under the old table's name.
  table: (_block, { order, movedFrom }) => (
    <div className="text-[1.7em] font-bold leading-none">
      Table {movedFrom ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}` : (order.tableNo ?? "Walk-In")}
    </div>
  ),
  time: (_block, { order, movedMeta, voidMeta }) => (
    <div className={META_LINE_CLASS}>Time {fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt)}</div>
  ),
  staff: (_block, { order, movedMeta, voidMeta }) => (
    <div className={META_LINE_CLASS}>Staff {movedMeta?.by ?? voidMeta?.by ?? order.receiver}</div>
  ),
  voidReason: (_block, { isVoid, reason }) =>
    isVoid && reason && <div className="font-bold">Reason: {reason}</div>,
  // A moved slip lists no dishes: a list of items on a kitchen slip is an instruction to cook them.
  items: (block, { isMoved, items }) =>
    !isMoved && (
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={`${item.productId}-${i}`} className="flex items-start gap-2">
            <span className="min-w-[1.6em] shrink-0 border-2 border-black text-center text-[1.2em] font-bold leading-tight tabular-nums">
              {item.qty}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-[1.25em] font-bold uppercase leading-tight">
                <span className="min-w-0">{orderItemLabel(item)}</span>
                {block.options.prices && (
                  <span className="whitespace-nowrap tabular-nums">{inr(item.price * item.qty)}</span>
                )}
              </div>
              {/* Dish options and dish notes ALWAYS print (owner, s79); the stored flags no longer gate them. */}
              {orderItemModifierLines(item).map((line) => (
                <div key={line} className={SUB_LINE_CLASS}>{line}</div>
              ))}
              {item.instructions && (
                <div className={SUB_LINE_CLASS}>{INSTRUCTION_PREFIX}{item.instructions}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    ),
  notes: (_block, { order }) =>
    order.notes && <Band className="px-2 py-1 font-bold uppercase">Note: {order.notes}</Band>,
  itemCount: (_block, { isMoved, isVoid, items }) =>
    !isMoved && (
      <div className="text-[0.9em] font-bold">
        {items.reduce((n, it) => n + it.qty, 0)} item(s){isVoid ? " VOIDED" : ""}
      </div>
    ),
  // This round's total, never the bill total; only with line amounts, never on a moved slip (no items there).
  roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
    !isMoved && showsPrices && <div className="text-[0.9em] font-bold">Round total: {inr(roundTotal)}</div>,
  qr: genericKotQr(BOLD_GENERIC),
  divider: genericDivider(BOLD_GENERIC),
  customText: genericCustomText(BOLD_GENERIC),
};

export const KOT_BOLD_DESIGN: SlipDesign<KotRenderers, KotBlockType> = {
  blocks: KOT_BOLD_BLOCKS,
  groupOf: {
    kotNo: "kotMeta",
    token: "kotMeta",
    table: "kotMeta",
    roundLabel: "kotMeta",
    time: "kotMeta",
    staff: "kotMeta",
    orderId: "kotMeta",
    voidReason: "kotMeta",
  },
  // flow-root: the wrapper contains the floated KOT box, so the divider below never rides up beside it.
  groupClass: { kotMeta: "flow-root space-y-0.5" },
  rootClass: "font-medium wrap-anywhere leading-tight",
  classic: false,
  regularClass: THEMED_REGULAR_CLASS,
};
