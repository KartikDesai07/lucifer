"use client";

import type { Ref } from "react";

import { CAFE_TIMEZONE } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import type { Order, Settings } from "@/types";

const FALLBACK_NAME = "Lucifer Cafe";
const FALLBACK_FOOTER = "Thank you! Visit again";

function fmtDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

interface OrderReceiptProps {
  order: Order | null;
  settings?: Settings | null;
  ref?: Ref<HTMLDivElement>;
}

// 80mm thermal receipt (~300px), monospace, black-only. Rendered off-screen and
// cloned by react-to-print at print time, so it never affects the page layout.
// All restaurant/GST/footer text comes from Settings (Phase 7), with fallbacks
// for the brief window before settings load.
export function OrderReceipt({ order, settings, ref }: OrderReceiptProps) {
  const name = settings?.restaurantName?.trim() || FALLBACK_NAME;
  const tagline = settings?.tagline?.trim();
  const address = settings?.address?.trim();
  const mobile = settings?.mobile?.trim();
  const header = settings?.receiptHeader?.trim();
  const footer = settings?.receiptFooter?.trim() || FALLBACK_FOOTER;
  const gstNumber = settings?.gstNumber?.trim();

  const gstCfg: GstConfig = {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
  const gst = order ? receiptGst(order, gstCfg) : null;
  const due = order ? order.total - order.paidAmount : 0;

  return (
    <div ref={ref} className="w-[300px] bg-white p-3 font-mono text-[12px] text-black">
      {order && (
        <>
          <div className="text-center">
            <div className="text-base font-bold tracking-wide">{name}</div>
            {tagline && <div className="text-[10px]">{tagline}</div>}
            {address && <div className="text-[10px]">{address}</div>}
            {mobile && <div className="text-[10px]">Ph: {mobile}</div>}
            {/* Show GSTIN only when this order actually carried GST (snapshot-
                aware via `gst`), so the header can't drift from the tax body
                after the cafe later toggles GST on/off. */}
            {gst?.show && gstNumber && (
              <div className="text-[10px]">GSTIN: {gstNumber}</div>
            )}
            {header && <div className="mt-1 text-[10px]">{header}</div>}
          </div>

          <Divider />

          <div className="space-y-0.5">
            <Line label="Order" value={order.orderId} />
            <Line label="Date" value={fmtDateTime(order.createdAt)} />
            <Line label="Table" value={order.tableNo ?? "Walk-In"} />
            <Line label="Customer" value={order.customerName} />
            <Line label="Staff" value={order.receiver} />
          </div>

          <Divider />

          <div className="space-y-1">
            {order.items.map((item, i) => (
              <div key={`${item.productId}-${i}`}>
                <div className="flex justify-between">
                  <span className="pr-2">
                    {item.name}
                    {item.qty > 1 ? ` x${item.qty}` : ""}
                  </span>
                  <span>{inr(item.price * item.qty)}</span>
                </div>
                {item.modifiers.length > 0 && (
                  <div className="pl-2 text-[10px]">+ {item.modifiers.join(", ")}</div>
                )}
                {item.instructions && (
                  <div className="pl-2 text-[10px] italic">{item.instructions}</div>
                )}
              </div>
            ))}
          </div>

          <Divider />

          <div className="space-y-0.5">
            <Line label="Subtotal" value={inr(order.subtotal)} />
            {order.discount > 0 && (
              <Line label="Discount" value={`-${inr(order.discount)}`} />
            )}
            {/* Exclusive GST is added on top of the total. */}
            {gst?.show && !gst.inclusive && (
              <Line label={`GST @${gst.rate}%`} value={`+${inr(gst.gstAmount)}`} />
            )}

            <div className="flex justify-between text-sm font-bold">
              <span>TOTAL</span>
              <span>{inr(order.total)}</span>
            </div>

            {/* Inclusive GST is already in the total — shown as a breakdown note. */}
            {gst?.show && gst.inclusive && (
              <div className="pl-2 text-[10px]">
                incl. GST @{gst.rate}%: {inr(gst.gstAmount)} (taxable{" "}
                {inr(gst.taxable)})
              </div>
            )}

            <Line label={`Paid (${order.payment})`} value={inr(order.paidAmount)} />
            {order.payment === "Split" && (
              <Line
                label="  Cash / Online"
                value={`${inr(order.splitCash ?? 0)} / ${inr(order.splitOnline ?? 0)}`}
              />
            )}
            {due > 0 && <Line label="Due" value={inr(due)} />}
          </div>

          <Divider />

          <div className="text-center text-[11px]">{footer}</div>
          {/* Actual print time (this branch only renders client-side, after an
              order is selected — so new Date() is hydration-safe here). */}
          <div className="mt-1 text-center text-[9px]">
            Printed {fmtDateTime(new Date())}
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
  return <div className="my-1 border-t border-dashed border-black" />;
}
