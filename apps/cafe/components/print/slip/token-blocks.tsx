import Image from "next/image";
import type { ReactNode } from "react";

import { printFontStack } from "@pos/shared/print-fonts";
import type { SlipLockContext } from "@pos/shared/print-template";
import { orderItemLabel } from "@pos/shared/utils";
import { CAFE_TIMEZONE, type PaperWidth } from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { PRINT_LOGO_CLASS, printConfigOf } from "@/lib/print";
import type { Order, Settings } from "@/types";
import { genericCustomText, genericDivider, genericTokenQr, type GenericTheme } from "./generic-blocks";
import type { TokenRenderers } from "./slip-designs";
import { fmtTime, LOGO_DIMENSIONS_PX } from "./slip-format";

// The token slip's block renderers (print customization S7, previews/designs.mjs tokenBig / tokenItems). A design is a
// small TokenTheme (classes, the number's frame and its size steps); tokenBlocks(theme) turns it into the whole
// renderer map, so a line a client ADDS prints in that design's own look. 1-bit thermal rules: no opacity, no grey.
// The slip is customer-facing: the cafe name, the number, when, what was ordered and one friendly sentence.

/** The words on a token slip. The label and the message are plain blocks, so their copy is named here. */
export const TOKEN_LABEL_TEXT = "YOUR TOKEN";
export const TOKEN_MESSAGE_TEXT = "Please collect your order when your number is called.";
export const TOKEN_BAND_TEXT = "TOKEN";

// A token slip is not a bill or a kitchen ticket: it asks nothing of GST, FSSAI or a void banner. Only the number's
// own lock (TOKEN_LOCKS.always) can force a line on.
export const TOKEN_LOCK_CONTEXT: SlipLockContext = { gst: false, fssai: false, banner: false };

export interface TokenSlipContext {
  order: Order;
  name: string | undefined;
  logoUrl: string | null;
  // The BILL paper (the token prints on the bill's device and lane): the number's size steps read it.
  paperWidth: PaperWidth;
  // "Show bill number" is the ONLY bill-number control (owner, S4 A7 Q1): off = no "Bill n", even on a reprint.
  showBillNumber: boolean;
}

// What the renderers receive: the context plus one fact only the whole slip knows (the slip carries Devanagari text,
// so the number's own display stack adds that family too).
export interface TokenRenderContext extends TokenSlipContext {
  devanagari: boolean;
}

export function tokenSlipContext(order: Order, settings: Settings | null | undefined): TokenSlipContext {
  return {
    order,
    name: settings?.restaurantName?.trim(),
    logoUrl: productImageUrl(settings?.logo, undefined, { fit: true }),
    paperWidth: printConfigOf(settings).bill.paperWidth,
    showBillNumber: printConfigOf(settings).bill.showNumber,
  };
}

// ── The number ───────────────────────────────────────────────────────────────

// K13: a token number can reach 6 digits plus the day's count, and 58 mm paper is 186 CSS px inside its padding, so a
// fixed size overflows at 4 digits. The size steps DOWN by digit count (index = digits - 1; a longer number takes the
// last step). Each step is the largest that keeps the digits of the heavy display face (about 0.75 em each, a
// conservative advance) inside the line, so "9999999" never runs off the slip; `break-all` is the last resort.
// px, not em: a number's size is its own, whatever size the block or the slip is set to.
export type TokenNumberSizes = Record<PaperWidth, readonly number[]>;

/** Big Number: the whole line is the number (186 px of content at 58 mm, 276 at 80 mm). */
export const BIG_NUMBER_SIZES_PX: TokenNumberSizes = {
  "58mm": [80, 80, 80, 60, 48, 40, 34, 28],
  "80mm": [104, 104, 104, 90, 72, 60, 52, 44],
};

/** Number + Items: the number shares the inverted band with the word TOKEN (166 px of content at 58 mm, 256 at 80 mm). */
export const BAND_NUMBER_SIZES_PX: TokenNumberSizes = {
  "58mm": [44, 44, 44, 40, 40, 34, 28, 24],
  "80mm": [64, 64, 64, 60, 56, 48, 42, 36],
};

export function tokenNumberSizePx(sizes: TokenNumberSizes, paper: PaperWidth, digits: number): number {
  const steps = sizes[paper];
  return steps[Math.min(Math.max(digits, 1), steps.length) - 1];
}

// The display face has one weight (400): `font-normal` stops an inherited bold from synthesizing a wider one.
export function TokenNumber({ ctx, sizes, className = "" }: { ctx: TokenRenderContext; sizes: TokenNumberSizes; className?: string }) {
  const value = String(ctx.order.tokenNumber);
  return (
    <div
      className={`max-w-full break-all font-normal leading-none tabular-nums ${className}`}
      style={{
        fontFamily: printFontStack("display", ctx.devanagari),
        fontSize: `${tokenNumberSizePx(sizes, ctx.paperWidth, value.length)}px`,
      }}
    >
      {value}
    </div>
  );
}

// ── Dates ────────────────────────────────────────────────────────────────────

function fmtDate(value: string | Date, withYear: boolean): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: CAFE_TIMEZONE,
  });
}

// ── Theme ────────────────────────────────────────────────────────────────────

export interface TokenTheme {
  generic: GenericTheme;
  nameClass: string;
  labelClass: string;
  messageClass: string;
  dateClass: string;
  dateWithYear: boolean;
  dateSeparator: string;
  /** Adds "Bill n" to the date line when the order has a bill number. */
  billSuffix: boolean;
  itemsClass: string;
  itemCountClass: string;
  numberSizes: TokenNumberSizes;
  /** Frames the number line: centred under the label (Big Number) or the inverted band (Number + Items). */
  frame: (number: ReactNode) => ReactNode;
}

export function tokenBlocks(theme: TokenTheme): TokenRenderers {
  return {
    name: (_block, { name }) => name && <div className={theme.nameClass}>{name}</div>,
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
    tokenNo: (_block, ctx) => theme.frame(<TokenNumber ctx={ctx} sizes={theme.numberSizes} className="ml-auto" />),
    label: () => <div className={theme.labelClass}>{TOKEN_LABEL_TEXT}</div>,
    dateTime: (_block, { order, showBillNumber }) => {
      const bill = theme.billSuffix && showBillNumber && order.billNumber !== undefined ? ` · Bill ${order.billNumber}` : "";
      return (
        <div className={theme.dateClass}>
          {fmtDate(order.createdAt, theme.dateWithYear)}
          {theme.dateSeparator}
          {fmtTime(order.createdAt)}
          {bill}
        </div>
      );
    },
    items: (_block, { order }) => {
      if (order.items.length === 0) return null;
      const count = order.items.reduce((n, item) => n + item.qty, 0);
      return (
        <div className={theme.itemsClass}>
          {order.items.map((item, i) => (
            <div key={`${item.productId}-${i}`} className="break-words">
              {item.qty} × {orderItemLabel(item)}
            </div>
          ))}
          <div className={theme.itemCountClass}>
            {count} {count === 1 ? "item" : "items"}
          </div>
        </div>
      );
    },
    message: () => <div className={theme.messageClass}>{TOKEN_MESSAGE_TEXT}</div>,
    qr: genericTokenQr(theme.generic),
    divider: genericDivider(theme.generic),
    customText: genericCustomText(theme.generic),
  };
}
