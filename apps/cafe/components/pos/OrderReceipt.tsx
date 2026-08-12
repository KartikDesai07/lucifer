"use client";

import type { Ref } from "react";
import Image from "next/image";

import { CAFE_TIMEZONE } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { productImageUrl } from "@/lib/images";
import type { Order, Settings } from "@/types";

// 80mm thermal header logo — kept small so it never crowds the name/address
// block above the fold.
const LOGO_WIDTH_PX = 120;
const LOGO_HEIGHT_PX = 56;

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
// All restaurant/GST/footer text comes from Settings (Phase 7); a receipt must
// never print a fallback brand, so the name/footer lines are omitted entirely
// when Settings hasn't set them (CR1.5).
export function OrderReceipt({ order, settings, ref }: OrderReceiptProps) {
  const name = settings?.restaurantName?.trim();
  const tagline = settings?.tagline?.trim();
  const address = settings?.address?.trim();
  const mobile = settings?.mobile?.trim();
  const header = settings?.receiptHeader?.trim();
  const footer = settings?.receiptFooter?.trim();
  const gstNumber = settings?.gstNumber?.trim();
  const fssai = settings?.fssai?.trim();
  const logoUrl = productImageUrl(settings?.logo, undefined, { fit: true });

  const gstCfg: GstConfig = {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
  const gst = order ? receiptGst(order, gstCfg) : null;
  const due = order ? order.total - order.paidAmount : 0;
  const isCancelled = order?.status === "Cancelled";

  return (
    <div ref={ref} className="w-[300px] bg-white p-3 font-mono text-[12px] text-black">
      {order && (
        <>
          <div className="text-center">
            {logoUrl && (
              <Image
                src={logoUrl}
                alt="Logo"
                width={LOGO_WIDTH_PX}
                height={LOGO_HEIGHT_PX}
                loading="eager"
                unoptimized
                className="mx-auto object-contain"
              />
            )}
            {name && (
              <div className="text-base font-bold tracking-wide">{name}</div>
            )}
            {tagline && <div className="text-[10px]">{tagline}</div>}
            {address && <div className="text-[10px]">{address}</div>}
            {mobile && <div className="text-[10px]">Ph: {mobile}</div>}
            {/* Show GSTIN only when this order actually carried GST (snapshot-
                aware via `gst`), so the header can't drift from the tax body
                after the cafe later toggles GST on/off. */}
            {gst?.show && gstNumber && (
              <div className="text-[10px]">GSTIN: {gstNumber}</div>
            )}
            {/* FSSAI is a food-license number, not tax — unconditional on GST. */}
            {fssai && <div className="text-[10px]">FSSAI: {fssai}</div>}
            {header && <div className="mt-1 text-[10px]">{header}</div>}
          </div>

          <Divider />

          {/* Loud on purpose (thermal = monochrome, no red ink) — mirrors the
              KOTReceipt void banner so a cancelled bill can never be mistaken
              for a live receipt if handed to a guest or filed as one. */}
          {isCancelled && (
            <>
              <div className="text-center text-lg font-bold tracking-widest">
                *** CANCELLED ***
              </div>
              <div className="text-center text-[13px] font-semibold">
                VOID — NOT A VALID RECEIPT
              </div>
              <Divider />
            </>
          )}

          <div className="space-y-0.5">
            <Line label="Order" value={order.orderId} />
            <Line label="Date" value={fmtDateTime(order.createdAt)} />
            <Line label="Table" value={order.tableNo ?? "Walk-In"} />
            <Line label="Customer" value={order.customerName} />
            <Line label="Staff" value={order.receiver} />
            {isCancelled && order.cancelReason && (
              <div className="pt-0.5 text-[10px] font-semibold">
                Reason: {order.cancelReason}
              </div>
            )}
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

            {/* A cancelled bill's `payment`/`paidAmount` are historical snapshots
                the books no longer count — printing "Paid"/"Due" here would
                assert a live receivable that the cancel already reversed. */}
            {isCancelled ? (
              <div className="pt-1 text-center text-[11px] font-semibold">
                VOID — no payment due
              </div>
            ) : (
              <>
                <Line
                  label={`Paid (${order.payment})`}
                  value={inr(order.paidAmount)}
                />
                {order.payment === "Split" && (
                  <Line
                    label="  Cash / Online"
                    value={`${inr(order.splitCash ?? 0)} / ${inr(order.splitOnline ?? 0)}`}
                  />
                )}
                {due > 0 && <Line label="Due" value={inr(due)} />}
              </>
            )}
          </div>

          <Divider />

          {footer && <div className="text-center text-[11px]">{footer}</div>}
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
