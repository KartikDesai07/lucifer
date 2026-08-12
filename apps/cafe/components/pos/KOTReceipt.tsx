"use client";

import type { Ref } from "react";

import { CAFE_TIMEZONE } from "@/lib/constants";
import { inr } from "@/lib/utils";
import type { Order, OrderItem, Settings } from "@/types";

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
  // "void" swaps the header for an unmistakable cancellation banner (CR1.3) —
  // defaults to "kot" so every existing call site prints exactly as before.
  variant?: "kot" | "void";
  reason?: string; // shown only in the "void" variant
  // Who voided the line and when — on a void slip the kitchen needs to know who
  // told them to stop and at what moment, not the tab's opener/open-time
  // (CR1.3 review). Ignored outside variant === "void"; a plain KOT is
  // unaffected by these being set or not.
  voidedBy?: string;
  voidedAt?: string | Date;
  ref?: Ref<HTMLDivElement>;
}

// Kitchen Order Ticket — a stripped-down ticket for the kitchen: large item +
// qty text, modifiers and instructions, NO prices by default (toggle via
// Settings.kotShowPrices). 80mm width, rendered off-screen like the receipt.
export function KOTReceipt({
  order,
  settings,
  roundItems,
  roundLabel,
  variant = "kot",
  reason,
  voidedBy,
  voidedAt,
  ref,
}: KOTReceiptProps) {
  const showPrices = settings?.kotShowPrices ?? false;
  const items = roundItems ?? order?.items ?? [];
  const isVoid = variant === "void";
  // Both-or-neither: a slip naming only one of who/when is worse than naming
  // the tab's opener/open-time, so an incomplete pair falls back to those.
  const voidMeta = isVoid && voidedBy && voidedAt ? { by: voidedBy, at: voidedAt } : null;

  return (
    <div ref={ref} className="w-[300px] bg-white p-3 font-mono text-[14px] text-black">
      {order && (
        <>
          {isVoid ? (
            // Loud on purpose (thermal printers are monochrome — no red ink to
            // rely on): a cook glancing at a slip mid-rush must never mistake a
            // void for a fresh ticket and fire it.
            <>
              <div className="text-center text-lg font-bold tracking-widest">
                *** VOID ***
              </div>
              <div className="text-center text-[13px] font-semibold">
                CANCELLED ITEMS — DO NOT MAKE
              </div>
            </>
          ) : (
            <div className="text-center text-lg font-bold tracking-widest">
              KITCHEN ORDER
            </div>
          )}
          {roundLabel && (
            <div className="text-center text-[13px] font-semibold">{roundLabel}</div>
          )}

          <Divider />

          <div className="space-y-0.5 text-[13px]">
            <Line label="Order" value={order.orderId} />
            <Line label="Table" value={order.tableNo ?? "Walk-In"} />
            <Line label="Time" value={fmtTime(voidMeta?.at ?? order.createdAt)} />
            <Line label="Staff" value={voidMeta?.by ?? order.receiver} />
            {isVoid && reason && (
              <div className="pt-0.5 font-semibold">Reason: {reason}</div>
            )}
          </div>

          <Divider />

          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={`${item.productId}-${i}`}>
                <div className="flex justify-between font-bold">
                  <span>
                    {item.qty} × {item.name}
                  </span>
                  {showPrices && <span>{inr(item.price * item.qty)}</span>}
                </div>
                {item.modifiers.length > 0 && (
                  <div className="pl-4 text-[12px]">+ {item.modifiers.join(", ")}</div>
                )}
                {item.instructions && (
                  <div className="pl-4 text-[12px] font-semibold italic">
                    ▸ {item.instructions}
                  </div>
                )}
              </div>
            ))}
          </div>

          {order.notes && (
            <>
              <Divider />
              <div className="text-[12px] font-semibold">Note: {order.notes}</div>
            </>
          )}

          <Divider />

          <div className="text-center text-[12px]">
            {items.reduce((n, it) => n + it.qty, 0)} item(s){isVoid ? " VOIDED" : ""}
          </div>
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
