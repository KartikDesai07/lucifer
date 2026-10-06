import type { ReactNode } from "react";
import Image from "next/image";

import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import type { KotBlockOf, KotBlockType } from "@pos/shared/print-template";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { PrintLogoSize } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { PRINT_LOGO_CLASS } from "@/lib/print";
import { KotTokenLine } from "@/components/pos/slip-token-lines";
import type { KotRenderContext } from "./slip-context";
import { genericCustomText, genericKotQr, ruleNode, type GenericTheme } from "./generic-blocks";

// Classic's kitchen-ticket block renderers: byte-copies of KOTReceipt.tsx's markup (see the note on
// bill-classic-blocks.tsx), except the S5 wrap fix (`Line`, the item name, the root's `break-words`). The legacy
// `cfg.*` gates are replaced by the block's `on`, except the item list's prices, which stay a block option (dish
// options and notes always print, as on today's ticket). A block a client ADDS to Classic (qr, custom text, a styled
// divider) is the only new markup, in Classic's own look.

// Classic's look for the shared lines (generic-blocks.tsx).
const CLASSIC_GENERIC: GenericTheme = {
  ruleMargin: "my-1.5",
  defaultStyle: "dashed",
  qrLayout: "centreUnder",
  captionClass: "text-[0.86em]",
  textClass: "text-center text-[0.86em]",
};

// next/image's intrinsic size per PRINT_LOGO_CLASS box. A kitchen ticket never needs a large logo, but the
// size is the block's option now (Classic-from-legacy passes "small": 80 x 36, today's pinned values).
const LOGO_DIMENSIONS_PX: Record<PrintLogoSize, { width: number; height: number }> = {
  small: { width: 80, height: 36 },
  medium: { width: 120, height: 56 },
  large: { width: 170, height: 80 },
};

function fmtTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

// S5 (owner, s75/s79 — the A4 wrap fix, kitchen ticket): legacy's `Line` (a `whitespace-pre` label, an unwrappable
// value) runs off a 58 mm slip on a long staff name or table. On the template path the row wraps exactly like the
// bill's (bill-classic-blocks.tsx): where legacy fits, the two lay out the same. The golden's `withClassicKotWrap`
// maps legacy to this markup exactly.
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-2">
      <span className="max-w-full whitespace-pre-wrap">{label}</span>
      <span className="max-w-full grow basis-0 text-right">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 border-t border-dashed border-black" />;
}

type ClassicKotRenderers = { [T in KotBlockType]: (block: KotBlockOf<T>, ctx: KotRenderContext) => ReactNode };

export const KOT_CLASSIC_BLOCKS: ClassicKotRenderers = {
  logo: (block, { logoUrl }) => {
    const logoDim = LOGO_DIMENSIONS_PX[block.options.logoSize];
    return (
      logoUrl && (
        <div className="text-center">
          <Image
            src={logoUrl}
            alt="Logo"
            width={logoDim.width}
            height={logoDim.height}
            loading="eager"
            unoptimized
            className={`${PRINT_LOGO_CLASS[block.options.logoSize]} mx-auto object-contain`}
          />
        </div>
      )
    );
  },
  name: (_block, { restaurantName }) =>
    restaurantName && (
      <div className="text-center text-[1.29em] font-bold tracking-wide">
        {restaurantName}
      </div>
    ),
  title: (_block, { isMoved, isVoid }) =>
    isMoved ? (
      // Loud on purpose, same reasoning as the VOID banner: a cook must
      // never mistake a moved-table slip for a fresh ticket and fire it —
      // the food behind it is already cooking (or cooked).
      <>
        <div className="text-center text-[1.29em] font-bold tracking-widest">
          *** TABLE MOVED ***
        </div>
        <div className="text-center text-[0.93em] font-semibold">
          FOOD ALREADY ORDERED — DO NOT MAKE AGAIN
        </div>
      </>
    ) : isVoid ? (
      // Loud on purpose (thermal printers are monochrome — no red ink to
      // rely on): a cook glancing at a slip mid-rush must never mistake a
      // void for a fresh ticket and fire it.
      <>
        <div className="text-center text-[1.29em] font-bold tracking-widest">
          *** VOID ***
        </div>
        <div className="text-center text-[0.93em] font-semibold">
          CANCELLED ITEMS — DO NOT MAKE
        </div>
      </>
    ) : (
      <div className="text-center text-[1.29em] font-bold tracking-widest">
        KITCHEN ORDER
      </div>
    ),
  // The number a cook calls out — large, directly under the title.
  // A moved slip consumes no ticket number: it is not a round.
  kotNo: (_block, { isMoved, roundNumber }) =>
    !isMoved &&
    roundNumber !== undefined && (
      <div className="text-center text-[1.6em] font-bold">#{roundNumber}</div>
    ),
  roundLabel: (_block, { roundLabel }) =>
    roundLabel && (
      <div className="text-center text-[0.93em] font-semibold">{roundLabel}</div>
    ),
  // No options = the legacy rule, byte for byte; a chosen style prints that style.
  divider: (block) => (block.options ? ruleNode(CLASSIC_GENERIC, block.options.style) : <Divider />),
  orderId: (_block, { order }) => <Line label="Order" value={order.orderId} />,
  // A moved slip names FROM → TO so a cook can match it to the
  // ticket they're already holding under the old table's name.
  table: (_block, { order, movedFrom }) => (
    <Line
      label="Table"
      value={
        movedFrom
          ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}`
          : order.tableNo ?? "Walk-In"
      }
    />
  ),
  time: (_block, { order, movedMeta, voidMeta }) => (
    <Line label="Time" value={fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt)} />
  ),
  staff: (_block, { order, movedMeta, voidMeta }) => (
    <Line label="Staff" value={movedMeta?.by ?? voidMeta?.by ?? order.receiver} />
  ),
  voidReason: (_block, { isVoid, reason }) =>
    isVoid &&
    reason && (
      <div className="pt-0.5 font-semibold">Reason: {reason}</div>
    ),
  // A moved slip lists no dishes: a list of items on a kitchen slip
  // is an instruction to cook them, and this food is already made.
  items: (block, { isMoved, items }) =>
    !isMoved && (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={`${item.productId}-${i}`}>
            <div className="flex justify-between font-bold">
              {/* min-w-0 (S5 wrap fix): a long dish name wraps instead of pushing the amount off the slip. */}
              <span className="min-w-0">
                {/* The variation rides on THIS bold line, not a sub-line —
                    a cook scanning a rail must not have to hunt for the size. */}
                {item.qty} × {orderItemLabel(item)}
              </span>
              {block.options.prices && <span>{inr(item.price * item.qty)}</span>}
            </div>
            {/* Dish options and dish notes ALWAYS print (owner, s79): a cook must never miss a "no onion" or an
                allergy line. The stored modifiers / instructions flags no longer gate them. */}
            {orderItemModifierLines(item).map((line) => (
              <div key={line} className="pl-4 text-[0.86em]">{line}</div>
            ))}
            {item.instructions && (
              <div className="pl-4 text-[0.86em] font-semibold italic">
                ▸ {item.instructions}
              </div>
            )}
          </div>
        ))}
      </div>
    ),
  // The note owns its leading divider.
  notes: (_block, { order }) =>
    order.notes && (
      <>
        <Divider />
        <div className="text-[0.86em] font-semibold">Note: {order.notes}</div>
      </>
    ),
  itemCount: (_block, { isMoved, isVoid, items }) =>
    !isMoved && (
      <div className="text-center text-[0.86em]">
        {items.reduce((n, it) => n + it.qty, 0)} item(s){isVoid ? " VOIDED" : ""}
      </div>
    ),
  // This round's total — never the bill total, so it is labelled
  // distinctly. Meaningless with no line amounts, so it prints only when
  // the visible items block shows prices; meaningless on a moved slip,
  // which lists no items at all.
  roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
    !isMoved &&
    showsPrices && (
      <div className="text-center text-[0.86em] font-semibold">
        Round total: {inr(roundTotal)}
      </div>
    ),
  // Station is Phase 2's slot (stationLine).
  station: () => null,
  // The order's token (S6): the legacy KOT's own line (slip-token-lines.tsx), on every variant.
  token: (_block, { order }) => order.tokenNumber !== undefined && <KotTokenLine tokenNumber={order.tokenNumber} />,
  qr: genericKotQr(CLASSIC_GENERIC),
  customText: genericCustomText(CLASSIC_GENERIC),
};
