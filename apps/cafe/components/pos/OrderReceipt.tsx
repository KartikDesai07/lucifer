"use client";

import type { Ref } from "react";
import Image from "next/image";

import { CAFE_TIMEZONE } from "@/lib/constants";
import type { PrintLogoSize } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { productImageUrl } from "@/lib/images";
import {
  printConfigOf,
  PAPER_WIDTH_CLASS,
  PRINT_FONT_CLASS,
  PRINT_LOGO_CLASS,
} from "@/lib/print";
import type { Order, Settings } from "@/types";

// next/image's intrinsic width/height per PRINT_LOGO_CLASS box — the CSS class
// sets the displayed size, these just give the tag an aspect-ratio hint.
const LOGO_DIMENSIONS_PX: Record<PrintLogoSize, { width: number; height: number }> = {
  small: { width: 80, height: 36 },
  medium: { width: 120, height: 56 },
  large: { width: 170, height: 80 },
};

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

// 80mm thermal receipt, monospace, black-only. Rendered off-screen and cloned
// by react-to-print at print time, so it never affects the page layout. Paper
// width, font size, logo, and every optional header line are gated by Settings
// (printConfigOf(settings).bill); a receipt must never print a fallback brand,
// so the name/footer lines are omitted entirely when Settings hasn't set them
// (CR1.5).
export function OrderReceipt({ order, settings, ref }: OrderReceiptProps) {
  const cfg = printConfigOf(settings).bill;
  const name = settings?.restaurantName?.trim();
  const tagline = settings?.tagline?.trim();
  const address = settings?.address?.trim();
  const mobile = settings?.mobile?.trim();
  const header = settings?.receiptHeader?.trim();
  const footer = settings?.receiptFooter?.trim();
  const gstNumber = settings?.gstNumber?.trim();
  const fssai = settings?.fssai?.trim();
  const logoUrl = productImageUrl(settings?.logo, undefined, { fit: true });
  const logoDim = LOGO_DIMENSIONS_PX[cfg.logoSize];

  const gstCfg: GstConfig = {
    gstEnabled: settings?.gstEnabled ?? false,
    gstRate: settings?.gstRate ?? 0,
    gstMode: settings?.gstMode ?? "inclusive",
  };
  const gst = order ? receiptGst(order, gstCfg) : null;
  const due = order ? order.total - order.paidAmount : 0;
  const isCancelled = order?.status === "Cancelled";

  return (
    <div
      ref={ref}
      className={`${PAPER_WIDTH_CLASS[cfg.paperWidth]} ${PRINT_FONT_CLASS[cfg.fontSize]} bg-white p-3 font-mono text-black`}
    >
      {order && (
        <>
          <div className="text-center">
            {cfg.showLogo && logoUrl && (
              <Image
                src={logoUrl}
                alt="Logo"
                width={logoDim.width}
                height={logoDim.height}
                loading="eager"
                unoptimized
                className={`${PRINT_LOGO_CLASS[cfg.logoSize]} mx-auto object-contain`}
              />
            )}
            {name && (
              <div className="text-[1.33em] font-bold tracking-wide">{name}</div>
            )}
            {tagline && <div className="text-[0.83em]">{tagline}</div>}
            {cfg.showAddress && (
              <>{address && <div className="text-[0.83em]">{address}</div>}</>
            )}
            {cfg.showMobile && (
              <>{mobile && <div className="text-[0.83em]">Ph: {mobile}</div>}</>
            )}
            {/* Show GSTIN only when this order actually carried GST (snapshot-
                aware via `gst`), so the header can't drift from the tax body
                after the cafe later toggles GST on/off. showGstNumber is an
                ADDITIONAL gate on top of that, never a replacement for it. */}
            {cfg.showGstNumber && (
              <>
                {gst?.show && gstNumber && (
                  <div className="text-[0.83em]">GSTIN: {gstNumber}</div>
                )}
              </>
            )}
            {/* FSSAI is a food-license number, not tax — unconditional on GST.
                Kept at a literal 10px (not em-scaled like its neighbours) —
                lib/print-paths.test.ts pins this exact line's className. */}
            {cfg.showFssai && (
              <>{fssai && <div className="text-[10px]">FSSAI: {fssai}</div>}</>
            )}
            {header && <div className="mt-1 text-[0.83em]">{header}</div>}
          </div>

          <Divider />

          {/* Loud on purpose (thermal = monochrome, no red ink) — mirrors the
              KOTReceipt void banner so a cancelled bill can never be mistaken
              for a live receipt if handed to a guest or filed as one. */}
          {isCancelled && (
            <>
              <div className="text-center text-[1.5em] font-bold tracking-widest">
                *** CANCELLED ***
              </div>
              <div className="text-center text-[1.08em] font-semibold">
                VOID — NOT A VALID RECEIPT
              </div>
              <Divider />
            </>
          )}

          <div className="space-y-0.5">
            {/* Prominent — this is the number a guest reads back at the counter.
                Rendered only when the order actually HAS one: an order that
                hasn't been paid yet carries no bill number, and a blank label
                is worse than printing nothing. */}
            {cfg.showNumber && order.billNumber !== undefined && (
              <div className="flex justify-between gap-2 font-bold">
                <span>Bill No.</span>
                <span className="text-right">{order.billNumber}</span>
              </div>
            )}
            <Line label="Order" value={order.orderId} />
            <Line label="Date" value={fmtDateTime(order.createdAt)} />
            <Line label="Table" value={order.tableNo ?? "Walk-In"} />
            <Line label="Customer" value={order.customerName} />
            <Line label="Staff" value={order.receiver} />
            {isCancelled && order.cancelReason && (
              <div className="pt-0.5 text-[0.83em] font-semibold">
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
                  <div className="pl-2 text-[0.83em]">+ {item.modifiers.join(", ")}</div>
                )}
                {item.instructions && (
                  <div className="pl-2 text-[0.83em] italic">{item.instructions}</div>
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
            {/* The table's charge, printed under the cafe's OWN name for it and
                after the tax line, because it is added on top of the taxed bill
                rather than taxed with it. Keyed on the amount being present:
                a waived charge leaves no line, and the label is never printed
                without a figure beside it. */}
            {order.chargeAmount !== undefined && order.chargeAmount > 0 && (
              <Line
                label={order.chargeLabel ?? "Table charge"}
                value={`+${inr(order.chargeAmount)}`}
              />
            )}

            <div className="flex justify-between text-[1.17em] font-bold">
              <span>TOTAL</span>
              <span>{inr(order.total)}</span>
            </div>

            {/* Inclusive GST is already in the total — shown as a breakdown note. */}
            {gst?.show && gst.inclusive && (
              <div className="pl-2 text-[0.83em]">
                incl. GST @{gst.rate}%: {inr(gst.gstAmount)} (taxable{" "}
                {inr(gst.taxable)})
              </div>
            )}

            {/* A cancelled bill's `payment`/`paidAmount` are historical snapshots
                the books no longer count — printing "Paid"/"Due" here would
                assert a live receivable that the cancel already reversed. */}
            {isCancelled ? (
              <div className="pt-1 text-center text-[0.92em] font-semibold">
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

          {footer && <div className="text-center text-[0.92em]">{footer}</div>}
          {/* Actual print time (this branch only renders client-side, after an
              order is selected — so new Date() is hydration-safe here). */}
          <div className="mt-1 text-center text-[0.75em]">
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
