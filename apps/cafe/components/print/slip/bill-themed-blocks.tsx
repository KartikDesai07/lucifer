import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";

import { orderItemLabel, orderItemModifierLines, discountLineLabel } from "@pos/shared/utils";
import { chargesFromOrder } from "@pos/shared/order-charges";
import { printFontStack, type PrintFontFace } from "@pos/shared/print-fonts";
import { inr } from "@/lib/utils";
import { PRINT_LOGO_CLASS } from "@/lib/print";
import { BANNER_STYLE } from "@/components/pos/PrintBanner";
import type { OrderItem } from "@/types";
import {
  genericBillQr,
  genericCustomText,
  genericDivider,
  ruleNode,
  type GenericTheme,
} from "./generic-blocks";
import { LabelledRow, LeaderRow, SplitRow, Band } from "./slip-rows";
import { fmtDateTime, LOGO_DIMENSIONS_PX } from "./slip-format";
import type { BillRenderContext } from "./slip-context";
import type { BillRenderers } from "./slip-designs";

// The bill themes' shared renderers (print customization S3, 01-PLAN A1.2): ONE factory returns a full renderer
// map for every bill block type, reading a theme's tokens. Modern / Express / Cafe each pass tokens (and Modern
// overrides its item table), so a block a client adds to any of them prints in that design's own look. The
// semantics are Classic's (bill-classic-blocks.tsx) with different markup: GSTIN only on a GST bill, the bill
// number only when the order has one, every charge line, a cancelled bill's banner instead of payment / due.
// 1-bit thermal rules: no opacity, no grey, strike-through (not fading) for a reward's worth.

export type TotalKind = "band" | "huge" | "box";
export type MetaStyle = "split" | "labelled" | "inline";

export interface BillTheme {
  generic: GenericTheme;
  /** A face set on top of the base font for headings (Cafe's slab). Never used for an amount. */
  headingFace: PrintFontFace | undefined;
  logoClass: string;
  nameClass: string;
  taglineClass: string;
  /** Prints the tagline as "~ tagline ~". */
  taglineTilde: boolean;
  /** The small lines under the name (address, phone, GSTIN, FSSAI, header text). */
  contactClass: string;
  headerTextClass: string;
  titleClass: string;
  metaStyle: MetaStyle;
  metaClass: string;
  billNoClass: string;
  /** Prints the token in a bordered "TOKEN / 42" box (Express's approved look) instead of a meta row. */
  tokenBox?: boolean;
  cashierLabel: string;
  /** Item lines: qty first and upper-case ("2 x NAME") vs name first ("Name × 2"). */
  itemQtyFirst: boolean;
  itemClass: string;
  /** Subtotal / charges / payment rows with a dotted leader instead of a gap. */
  leaders: boolean;
  amount: (n: number) => string;
  totalKind: TotalKind;
  totalLabel: string;
  footerClass: string;
}

const SUB_LINE_CLASS = "pl-4 text-left text-[0.85em]";
// Whole literal classes (Tailwind scans source text). Each total row may wrap: on 58 mm a big amount in a big face
// (Express's ₹1,00,000) does not fit beside its label, so it moves to its own line, flush right, never split.
const TOTAL_CLASS: Record<TotalKind, string> = {
  band: "my-1.5 flex flex-wrap items-center justify-between gap-x-2 bg-black px-2 py-1.5 text-[1.3em] font-bold text-white",
  huge: "flex flex-wrap items-baseline justify-between gap-x-2 text-[2.2em] font-bold leading-none",
  box: "my-1.5 flex flex-wrap items-baseline justify-between gap-x-2 rounded-lg border-2 border-black px-2.5 py-1.5 text-[1.35em] font-bold",
};

// Kitchen Bold's KOT box, not floated: w-fit keeps it the number's width in a flex column or on its own line.
function TokenBox({ tokenNumber }: { tokenNumber: number }) {
  return (
    <div className="w-fit border-[3px] border-black px-2 py-0.5 text-center">
      <div className="text-[0.75em] font-bold tracking-widest">TOKEN</div>
      <div className="text-[2.2em] font-bold leading-none tabular-nums">{tokenNumber}</div>
    </div>
  );
}

export function headingStyle(face: PrintFontFace | undefined, devanagari: boolean): CSSProperties | undefined {
  return face ? { fontFamily: printFontStack(face, devanagari) } : undefined;
}

/** A reward line's marker, its modifiers and its instructions: the small lines under an item. */
export function ItemExtras({ item, className }: { item: OrderItem; className: string }) {
  return (
    <>
      {item.reward && item.note && <div className={`${className} italic`}>{item.note}</div>}
      {orderItemModifierLines(item).map((line) => (
        <div key={line} className={className}>{line}</div>
      ))}
      {item.instructions && <div className={`${className} italic`}>{item.instructions}</div>}
    </>
  );
}

export function billThemedBlocks(theme: BillTheme): BillRenderers {
  const money = theme.amount;
  const heading = (ctx: BillRenderContext) => headingStyle(theme.headingFace, ctx.devanagari);
  const rule = () => ruleNode(theme.generic, theme.generic.defaultStyle);
  const row = (label: string, value: string, className = ""): ReactNode =>
    theme.leaders ? (
      <LeaderRow label={label} value={value} className={className} />
    ) : (
      <SplitRow label={label} value={value} className={className} />
    );
  // The bill's header lines (meta). "inline" prints "label value" as one centred sentence; bare drops the label.
  const meta = (label: string, value: string, className = "", bare = false): ReactNode => {
    if (theme.metaStyle === "labelled") return <LabelledRow label={label} value={value} className={className} />;
    if (theme.metaStyle === "inline") {
      return <div className={`${theme.metaClass} ${className}`}>{bare ? value : `${label} ${value}`}</div>;
    }
    return <SplitRow label={label} value={value} className={`${theme.metaClass} ${className}`} />;
  };

  return {
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
            className={`${PRINT_LOGO_CLASS[block.options.logoSize]} object-contain ${theme.logoClass}`}
          />
        )
      );
    },
    name: (_block, ctx) => ctx.name && <div className={theme.nameClass} style={heading(ctx)}>{ctx.name}</div>,
    tagline: (_block, ctx) =>
      ctx.tagline && (
        <div className={theme.taglineClass} style={heading(ctx)}>
          {theme.taglineTilde ? `~ ${ctx.tagline} ~` : ctx.tagline}
        </div>
      ),
    address: (_block, { address }) => address && <div className={theme.contactClass}>{address}</div>,
    phone: (_block, { mobile }) => mobile && <div className={theme.contactClass}>Ph: {mobile}</div>,
    // Only when this order carried GST (snapshot-aware), as in Classic: the header can never drift from the tax body.
    gstin: (_block, { gst, gstNumber }) =>
      gst.show && gstNumber && <div className={theme.contactClass}>GSTIN: {gstNumber}</div>,
    fssai: (_block, { fssai }) => fssai && <div className={theme.contactClass}>FSSAI: {fssai}</div>,
    headerText: (_block, { header }) => header && <div className={`${theme.contactClass} ${theme.headerTextClass}`}>{header}</div>,
    title: (_block, ctx) => (
      <div className={theme.titleClass} style={heading(ctx)}>{ctx.gst.show ? "TAX INVOICE" : "BILL"}</div>
    ),
    // Loud on purpose (thermal = monochrome): a cancelled bill must never pass for a live receipt. Owns its rule.
    cancelBanner: (_block, { isCancelled }) =>
      isCancelled && (
        <>
          <Band className="py-1 text-center text-[1.3em] font-bold tracking-widest">*** CANCELLED ***</Band>
          <div className="mt-1 text-center text-[0.95em] font-bold">VOID — NOT A VALID RECEIPT</div>
          {rule()}
        </>
      ),
    billNo: (_block, { order }) => {
      if (order.billNumber === undefined) return null;
      if (theme.metaStyle === "inline") {
        return <div className={`${theme.metaClass} ${theme.billNoClass}`}>Bill #{order.billNumber}</div>;
      }
      return meta("Bill No", String(order.billNumber), theme.billNoClass);
    },
    // The order's token (S6), as loud as the bill number; only when the order has one. Express boxes it (D5).
    token: (_block, { order }) => {
      if (order.tokenNumber === undefined) return null;
      if (theme.tokenBox) return <TokenBox tokenNumber={order.tokenNumber} />;
      if (theme.metaStyle === "inline") {
        return <div className={`${theme.metaClass} ${theme.billNoClass}`}>Token #{order.tokenNumber}</div>;
      }
      return meta("Token", String(order.tokenNumber), theme.billNoClass);
    },
    orderId: (_block, { order }) => meta("Order", order.orderId),
    dateTime: (_block, { order }) => meta("Date", fmtDateTime(order.createdAt), "", true),
    table: (_block, { order }) => meta("Table", order.tableNo ?? "Walk-In"),
    customer: (_block, { order }) => meta("Customer", order.customerName),
    cashier: (_block, { order }) => meta(theme.cashierLabel, order.receiver),
    cancelReason: (_block, { order, isCancelled }) =>
      isCancelled && order.cancelReason && <div className="pt-0.5 text-[0.85em] font-bold">Reason: {order.cancelReason}</div>,
    // "2 x NAME ....... 80" or "Name × 2 ....... ₹80". A reward line prints FREE with its worth struck through
    // (the subtotal skips it, so a real price in the amount column would make the bill fail to add up).
    items: (_block, { order }) => (
      <div className="flex flex-col gap-1">
        {order.items.map((item, i) => (
          <div key={`${item.productId}-${i}`}>
            <LeaderRow
              className={theme.itemClass}
              label={theme.itemQtyFirst ? `${item.qty} x ${orderItemLabel(item)}` : `${orderItemLabel(item)} × ${item.qty}`}
              value={
                item.reward ? (
                  <>
                    <span className="line-through">{money(item.price * item.qty)}</span> FREE
                  </>
                ) : (
                  money(item.price * item.qty)
                )
              }
            />
            <ItemExtras item={item} className={SUB_LINE_CLASS} />
          </div>
        ))}
      </div>
    ),
    subtotal: (_block, { order }) => row("Subtotal", money(order.subtotal)),
    discount: (_block, { order }) =>
      order.discount > 0 && row(discountLineLabel(order.discountKind), `-${money(order.discount)}`),
    taxes: (_block, { gst }) => gst.show && !gst.inclusive && row(`GST @${gst.rate}%`, `+${money(gst.gstAmount)}`),
    charges: (_block, { order }) =>
      chargesFromOrder(order).map((c, i) => <div key={`${c.label}-${i}`}>{row(c.label, `+${money(c.amount)}`)}</div>),
    loyalty: (_block, { rewardSaved }) => rewardSaved > 0 && row("Reward saved", money(rewardSaved)),
    total: (_block, ctx) => (
      <div className={TOTAL_CLASS[theme.totalKind]} style={theme.totalKind === "band" ? BANNER_STYLE : undefined}>
        <span style={heading(ctx)}>{theme.totalLabel}</span>
        <span className="ml-auto whitespace-nowrap tabular-nums">{inr(ctx.order.total)}</span>
      </div>
    ),
    taxIncluded: (_block, { gst }) =>
      gst.show &&
      gst.inclusive && (
        <div className="text-[0.85em]">
          incl. GST @{gst.rate}%: {money(gst.gstAmount)} (taxable {money(gst.taxable)})
        </div>
      ),
    // A cancelled bill's payment / paidAmount are snapshots the books no longer count: no Paid / Due lines.
    payment: (_block, { order, isCancelled }) =>
      isCancelled ? (
        <div className="pt-1 text-center text-[0.95em] font-bold">VOID — no payment due</div>
      ) : (
        <>
          {row(`Paid (${order.payment})`, money(order.paidAmount))}
          {order.payment === "Split" &&
            row("Cash / Online", `${money(order.splitCash ?? 0)} / ${money(order.splitOnline ?? 0)}`, "text-[0.85em]")}
        </>
      ),
    due: (_block, { due, isCancelled }) => !isCancelled && due > 0 && row("Due", money(due), "font-bold"),
    footerText: (_block, ctx) =>
      ctx.footer && <div className={theme.footerClass} style={heading(ctx)}>{ctx.footer}</div>,
    printedAt: () => <div className="mt-1 text-center text-[0.8em]">Printed {fmtDateTime(new Date())}</div>,
    qr: genericBillQr(theme.generic),
    divider: genericDivider(theme.generic),
    customText: genericCustomText(theme.generic),
  };
}
