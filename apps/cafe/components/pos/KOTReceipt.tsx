"use client";

import type { Ref } from "react";
import Image from "next/image";

import { orderItemLabel } from "@pos/shared/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { inr } from "@/lib/utils";
import {
  printConfigOf,
  PAPER_WIDTH_CLASS,
  PRINT_FONT_CLASS,
  PRINT_LOGO_CLASS,
} from "@/lib/print";
import { productImageUrl } from "@/lib/images";
import type { Order, OrderItem, Settings } from "@/types";

// A kitchen ticket never needs a large logo — pinned to next/image's intrinsic
// size for the "small" PRINT_LOGO_CLASS box.
const KOT_LOGO_WIDTH_PX = 80;
const KOT_LOGO_HEIGHT_PX = 36;

function fmtTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

interface KOTReceiptProps {
  order: Order | null;
  settings?: Settings | null;
  // When set, print only these items (one KOT round) instead of the whole order,
  // and show the round label in the header. Used when firing a new round so the
  // kitchen only sees the newly-added items.
  roundItems?: OrderItem[];
  roundLabel?: string;
  // The ticket number for THIS slip — this round's kotNumbers entry for a plain
  // ticket, or the void entry's own kotNumber for a void slip. Already resolved
  // server-side (against the cafe's configured daily start), so this is printed
  // verbatim and never recomputed here. Left off the slip entirely when absent
  // (an older order minted before numbering shipped, or a cafe that numbers
  // rounds but not voids).
  roundNumber?: number;
  // "void" swaps the header for an unmistakable cancellation banner (CR1.3);
  // "moved" swaps it for a "food already ordered" banner and suppresses the
  // item list entirely — both default to "kot" so every existing call site
  // prints exactly as before.
  variant?: "kot" | "void" | "moved";
  reason?: string; // shown only in the "void" variant
  // Who voided the line and when — on a void slip the kitchen needs to know who
  // told them to stop and at what moment, not the tab's opener/open-time
  // (CR1.3 review). Ignored outside variant === "void"; a plain KOT is
  // unaffected by these being set or not.
  voidedBy?: string;
  voidedAt?: string | Date;
  // The table the food was ordered FROM — the only way the kitchen can match
  // this slip to the ticket they're already holding on the pass. movedBy/
  // movedAt mirror voidedBy/voidedAt: the move's own mover and moment, not the
  // tab's opener/open-time. Ignored outside variant === "moved".
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string | Date;
  ref?: Ref<HTMLDivElement>;
}

// Kitchen Order Ticket — a stripped-down ticket for the kitchen: large item +
// qty text, modifiers and instructions, prices/logo/etc. gated by Settings
// (printConfigOf(settings).kot). Rendered off-screen like the receipt; paper
// width and font size come from the same resolved config.
export function KOTReceipt({
  order,
  settings,
  roundItems,
  roundLabel,
  roundNumber,
  variant = "kot",
  reason,
  voidedBy,
  voidedAt,
  movedFrom,
  movedBy,
  movedAt,
  ref,
}: KOTReceiptProps) {
  const cfg = printConfigOf(settings).kot;
  const items = roundItems ?? order?.items ?? [];
  const isVoid = variant === "void";
  const isMoved = variant === "moved";
  // Both-or-neither: a slip naming only one of who/when is worse than naming
  // the tab's opener/open-time, so an incomplete pair falls back to those.
  const voidMeta = isVoid && voidedBy && voidedAt ? { by: voidedBy, at: voidedAt } : null;
  // Same both-or-neither rule as voidMeta, for the moved variant.
  const movedMeta = isMoved && movedBy && movedAt ? { by: movedBy, at: movedAt } : null;
  const logoUrl = productImageUrl(settings?.logo, undefined, { fit: true });
  const restaurantName = settings?.restaurantName?.trim();
  // The round's own total — this slip only lists one round's items, so it is
  // never the bill total. Only meaningful alongside per-line prices.
  const roundTotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);

  return (
    <div
      ref={ref}
      className={`${PAPER_WIDTH_CLASS[cfg.paperWidth]} ${PRINT_FONT_CLASS[cfg.fontSize]} bg-white p-3 font-mono text-black`}
    >
      {order && (
        <>
          {cfg.showLogo && logoUrl && (
            <div className="text-center">
              <Image
                src={logoUrl}
                alt="Logo"
                width={KOT_LOGO_WIDTH_PX}
                height={KOT_LOGO_HEIGHT_PX}
                loading="eager"
                unoptimized
                className={`${PRINT_LOGO_CLASS.small} mx-auto object-contain`}
              />
            </div>
          )}
          {cfg.showRestaurantName && restaurantName && (
            <div className="text-center text-[1.29em] font-bold tracking-wide">
              {restaurantName}
            </div>
          )}

          {isMoved ? (
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
          )}
          {/* The number a cook calls out — large, directly under the title.
              A moved slip consumes no ticket number: it is not a round. */}
          {!isMoved && cfg.showNumber && roundNumber !== undefined && (
            <div className="text-center text-[1.6em] font-bold">#{roundNumber}</div>
          )}
          {roundLabel && (
            <div className="text-center text-[0.93em] font-semibold">{roundLabel}</div>
          )}

          <Divider />

          <div className="space-y-0.5 text-[0.93em]">
            <Line label="Order" value={order.orderId} />
            {cfg.showTable && (
              // A moved slip names FROM → TO so a cook can match it to the
              // ticket they're already holding under the old table's name.
              <Line
                label="Table"
                value={
                  movedFrom
                    ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}`
                    : order.tableNo ?? "Walk-In"
                }
              />
            )}
            {cfg.showTime && (
              <Line label="Time" value={fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt)} />
            )}
            {cfg.showStaff && (
              <Line label="Staff" value={movedMeta?.by ?? voidMeta?.by ?? order.receiver} />
            )}
            {isVoid && reason && (
              <div className="pt-0.5 font-semibold">Reason: {reason}</div>
            )}
          </div>

          <Divider />

          {/* A moved slip lists no dishes: a list of items on a kitchen slip
              is an instruction to cook them, and this food is already made. */}
          {!isMoved && (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={`${item.productId}-${i}`}>
                  <div className="flex justify-between font-bold">
                    <span>
                      {/* The variation rides on THIS bold line, not a sub-line —
                          a cook scanning a rail must not have to hunt for the size. */}
                      {item.qty} × {orderItemLabel(item)}
                    </span>
                    {cfg.showPrices && <span>{inr(item.price * item.qty)}</span>}
                  </div>
                  {item.modifiers.length > 0 && (
                    <div className="pl-4 text-[0.86em]">+ {item.modifiers.join(", ")}</div>
                  )}
                  {item.instructions && (
                    <div className="pl-4 text-[0.86em] font-semibold italic">
                      ▸ {item.instructions}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {cfg.showNotes && order.notes && (
            <>
              <Divider />
              <div className="text-[0.86em] font-semibold">Note: {order.notes}</div>
            </>
          )}

          <Divider />

          {!isMoved && (
            <div className="text-center text-[0.86em]">
              {items.reduce((n, it) => n + it.qty, 0)} item(s){isVoid ? " VOIDED" : ""}
            </div>
          )}
          {/* This round's total — never the bill total, so it is labelled
              distinctly. Meaningless with no line amounts, so gated on prices too;
              meaningless on a moved slip, which lists no items at all. */}
          {!isMoved && cfg.showTotal && cfg.showPrices && (
            <div className="text-center text-[0.86em] font-semibold">
              Round total: {inr(roundTotal)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 border-t border-dashed border-black" />;
}
