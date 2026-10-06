import type { ReactNode } from "react";
import Image from "next/image";

import { orderItemLabel, orderItemModifierLines, discountLineLabel } from "@pos/shared/utils";
import { chargesFromOrder } from "@pos/shared/order-charges";
import type { BillBlockOf, BillBlockType } from "@pos/shared/print-template";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { PrintLogoSize } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { PRINT_LOGO_CLASS } from "@/lib/print";
import { BillTokenRow } from "@/components/pos/slip-token-lines";
import type { BillSlipContext } from "./slip-context";
import { genericBillQr, genericCustomText, ruleNode, type GenericTheme } from "./generic-blocks";

// Classic's bill block renderers: byte-copies of OrderReceipt.tsx's markup, one block per legacy JSX branch. The
// legacy `cfg.*` gates are gone — a block's `on` (plus the lock gate in SlipEngine) replaces them. The golden
// test (lib/print-template-golden.test.ts) pins that rendering the Classic-from-legacy template equals today's
// component string for string, after one exact transform (`withClassicWrap`: the A4 wrap fix — `Line`, the item
// name, the Bill No. and TOTAL rows and the root's `break-words`, s78). Lines are kept verbatim (even ones the static markup could not tell apart, such
// as a split text node: renderToStaticMarkup emits no `<!-- -->` separators) so this file stays diffable
// against the legacy component. A block a client ADDS to Classic (title, loyalty, qr, custom text, a styled divider)
// is the only new markup here, in Classic's own look: mono, label / value rows, dashed rules.

// Classic's look for the shared lines (generic-blocks.tsx).
const CLASSIC_GENERIC: GenericTheme = {
  ruleMargin: "my-1",
  defaultStyle: "dashed",
  qrLayout: "centreUnder",
  captionClass: "text-[0.83em]",
  textClass: "text-center text-[0.83em]",
};

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

// The ONE deliberate divergence from legacy's markup (owner, s75 — A4): legacy's `Line` (a `whitespace-pre` label,
// an unwrappable value) runs off a 58 mm slip on a long charge label or customer / staff name. On the template path
// the row wraps: the label keeps its spacing but may break, and the value takes the rest of the row, dropping to its
// own line only when label + gap + its longest word cannot fit — exactly where legacy overflowed. Where legacy fits,
// the two lay out the same. The golden's `withClassicWrap` maps legacy to this markup exactly.
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-2">
      <span className="max-w-full whitespace-pre-wrap">{label}</span>
      <span className="max-w-full grow basis-0 text-right">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1 border-t border-dashed border-black" />;
}

type ClassicBillRenderers = { [T in BillBlockType]: (block: BillBlockOf<T>, ctx: BillSlipContext) => ReactNode };

export const BILL_CLASSIC_BLOCKS: ClassicBillRenderers = {
  logo: (block, { logoUrl }) => {
    const logoDim = LOGO_DIMENSIONS_PX[block.options.logoSize];
    return (
      logoUrl && (
        <Image
          src={logoUrl}
          alt="Logo"
          width={logoDim.width}
          height={logoDim.height}
          loading="eager"
          unoptimized
          className={`${PRINT_LOGO_CLASS[block.options.logoSize]} mx-auto object-contain`}
        />
      )
    );
  },
  name: (_block, { name }) => name && <div className="text-[1.33em] font-bold tracking-wide">{name}</div>,
  tagline: (_block, { tagline }) => tagline && <div className="text-[0.83em]">{tagline}</div>,
  address: (_block, { address }) => address && <div className="text-[0.83em]">{address}</div>,
  phone: (_block, { mobile }) => mobile && <div className="text-[0.83em]">Ph: {mobile}</div>,
  // Show GSTIN only when this order actually carried GST (snapshot-
  // aware via `gst`), so the header can't drift from the tax body
  // after the cafe later toggles GST on/off. The block's `on` is an
  // ADDITIONAL gate on top of that, never a replacement for it.
  gstin: (_block, { gst, gstNumber }) =>
    gst.show && gstNumber && <div className="text-[0.83em]">GSTIN: {gstNumber}</div>,
  // FSSAI is a food-license number, not tax — unconditional on GST.
  // Kept at a literal 10px (not em-scaled like its neighbours) —
  // lib/print-paths.test.ts pins this exact line's className.
  fssai: (_block, { fssai }) => fssai && <div className="text-[10px]">FSSAI: {fssai}</div>,
  headerText: (_block, { header }) => header && <div className="mt-1 text-[0.83em]">{header}</div>,
  // No options = the legacy rule, byte for byte; a chosen style prints that style.
  divider: (block) => (block.options ? ruleNode(CLASSIC_GENERIC, block.options.style) : <Divider />),
  // Loud on purpose (thermal = monochrome, no red ink) — mirrors the
  // KOTReceipt void banner so a cancelled bill can never be mistaken
  // for a live receipt if handed to a guest or filed as one. The banner
  // owns its trailing divider.
  cancelBanner: (_block, { isCancelled }) =>
    isCancelled && (
      <>
        <div className="text-center text-[1.5em] font-bold tracking-widest">
          *** CANCELLED ***
        </div>
        <div className="text-center text-[1.08em] font-semibold">
          VOID — NOT A VALID RECEIPT
        </div>
        <Divider />
      </>
    ),
  // Prominent — this is the number a guest reads back at the counter.
  // Rendered only when the order actually HAS one: an order that
  // hasn't been paid yet carries no bill number, and a blank label
  // is worse than printing nothing.
  billNo: (_block, { order }) =>
    order.billNumber !== undefined && (
      // flex-wrap + ml-auto (A4, s78): at a large size the number drops to its own line instead of off the slip.
      <div className="flex flex-wrap justify-between gap-2 font-bold">
        <span>Bill No.</span>
        <span className="ml-auto text-right">{order.billNumber}</span>
      </div>
    ),
  orderId: (_block, { order }) => <Line label="Order" value={order.orderId} />,
  dateTime: (_block, { order }) => <Line label="Date" value={fmtDateTime(order.createdAt)} />,
  table: (_block, { order }) => <Line label="Table" value={order.tableNo ?? "Walk-In"} />,
  customer: (_block, { order }) => <Line label="Customer" value={order.customerName} />,
  cashier: (_block, { order }) => <Line label="Staff" value={order.receiver} />,
  cancelReason: (_block, { order, isCancelled }) =>
    isCancelled &&
    order.cancelReason && (
      <div className="pt-0.5 text-[0.83em] font-semibold">
        Reason: {order.cancelReason}
      </div>
    ),
  items: (_block, { order }) => (
    <div className="space-y-1">
      {order.items.map((item, i) => (
        <div key={`${item.productId}-${i}`}>
          <div className="flex justify-between">
            {/* min-w-0 (A4): an unbroken long dish name wraps inside the slip instead of pushing the price off it. */}
            <span className="min-w-0 pr-2">
              {orderItemLabel(item)}
              {item.qty > 1 ? ` x${item.qty}` : ""}
            </span>
            {/* CB-5B — a reward line is on the bill so the customer SEES
                what they were given, but its money is excluded from the
                subtotal (lib/receipt.ts's reducer skips it). Printing its
                real price in the amount column would make the bill fail
                to add up in the customer's hands, so the amount column
                says FREE and the worth is shown struck through beside the
                name. The stored `note` is preferred over the live
                constant: a reprint must reproduce the paper as issued. */}
            {item.reward ? (
              <span className="whitespace-nowrap">
                <span className="line-through opacity-60">{inr(item.price * item.qty)}</span>{" "}
                FREE
              </span>
            ) : (
              <span>{inr(item.price * item.qty)}</span>
            )}
          </div>
          {item.reward && item.note && (
            <div className="pl-2 text-[0.83em] italic">{item.note}</div>
          )}
          {orderItemModifierLines(item).map((line) => (
            <div key={line} className="pl-2 text-[0.83em]">{line}</div>
          ))}
          {item.instructions && (
            <div className="pl-2 text-[0.83em] italic">{item.instructions}</div>
          )}
        </div>
      ))}
    </div>
  ),
  subtotal: (_block, { order }) => <Line label="Subtotal" value={inr(order.subtotal)} />,
  discount: (_block, { order }) =>
    order.discount > 0 && (
      <Line label={discountLineLabel(order.discountKind)} value={`-${inr(order.discount)}`} />
    ),
  // Exclusive GST is added on top of the total.
  taxes: (_block, { gst }) =>
    gst.show &&
    !gst.inclusive && (
      <Line label={`GST @${gst.rate}%`} value={`+${inr(gst.gstAmount)}`} />
    ),
  // CB-CHG — every charge line (table + staff-entered extras), each
  // printed under its own name, after the tax line, because they
  // are added on top of the taxed bill rather than taxed with it.
  // A legacy order (no `charges[]`, only the scalars) derives to
  // exactly the ONE line the old conditional printed, under the
  // same "Table charge" fallback — a reprint is byte-identical.
  charges: (_block, { order }) =>
    chargesFromOrder(order).map((c, i) => (
      <Line key={`${c.label}-${i}`} label={c.label} value={`+${inr(c.amount)}`} />
    )),
  // A4 (s78): a size chip can make this row wider than a 58 mm slip, so it wraps like the other designs' totals: the
  // amount moves to its own line, right-aligned, and is never split. Where it fits it lays out as today's bill.
  total: (_block, { order }) => (
    <div className="flex flex-wrap justify-between text-[1.17em] font-bold">
      <span>TOTAL</span>
      <span className="ml-auto whitespace-nowrap">{inr(order.total)}</span>
    </div>
  ),
  // Inclusive GST is already in the total — shown as a breakdown note.
  taxIncluded: (_block, { gst }) =>
    gst.show &&
    gst.inclusive && (
      <div className="pl-2 text-[0.83em]">
        incl. GST @{gst.rate}%: {inr(gst.gstAmount)} (taxable{" "}
        {inr(gst.taxable)})
      </div>
    ),
  // A cancelled bill's `payment`/`paidAmount` are historical snapshots
  // the books no longer count — printing "Paid"/"Due" here would
  // assert a live receivable that the cancel already reversed.
  payment: (_block, { order, isCancelled }) =>
    isCancelled ? (
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
      </>
    ),
  due: (_block, { due, isCancelled }) => !isCancelled && due > 0 && <Line label="Due" value={inr(due)} />,
  footerText: (_block, { footer }) => footer && <div className="text-center text-[0.92em]">{footer}</div>,
  // Actual print time (this block only renders client-side, after an
  // order is selected — so new Date() is hydration-safe here).
  printedAt: () => (
    <div className="mt-1 text-center text-[0.75em]">
      Printed {fmtDateTime(new Date())}
    </div>
  ),
  // Added lines, not part of the legacy bill. Classic-from-legacy has title off, so it prints only when the GST
  // lock forces it (the one planned golden divergence, 01-PLAN A3).
  title: (_block, { gst }) => (
    <div className="text-center font-bold tracking-widest">{gst.show ? "TAX INVOICE" : "BILL"}</div>
  ),
  // The order's token (S6): the legacy bill's own row (slip-token-lines.tsx), wrapped like Bill No. (A4).
  token: (_block, { order }) => order.tokenNumber !== undefined && <BillTokenRow tokenNumber={order.tokenNumber} wrap />,
  loyalty: (_block, { rewardSaved }) => rewardSaved > 0 && <Line label="Reward saved" value={inr(rewardSaved)} />,
  qr: genericBillQr(CLASSIC_GENERIC),
  customText: genericCustomText(CLASSIC_GENERIC),
};
