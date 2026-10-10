import { cafeDateString } from "@pos/shared/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { halfGst } from "@/lib/gst-half";
import type { PrintLogoSize } from "@/lib/constants";

// Helpers the S3 design themes share. The Classic files keep their own byte-copied twins (they must stay
// diffable against OrderReceipt / KOTReceipt), so nothing here is imported by them.

// next/image's intrinsic width/height per PRINT_LOGO_CLASS box: the class sets the displayed size, these only give
// the tag an aspect-ratio hint.
export const LOGO_DIMENSIONS_PX: Record<PrintLogoSize, { width: number; height: number }> = {
  small: { width: 80, height: 36 },
  medium: { width: 120, height: 56 },
  large: { width: 170, height: 80 },
};

export function fmtDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

export function fmtTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

// The pay QR's "Valid till" line: the time alone when it falls on the same cafe day as now, else date and time.
export function validTillLabel(tillMs: number, nowMs: number): string {
  const sameDay = cafeDateString(new Date(tillMs)) === cafeDateString(new Date(nowMs));
  return `Valid till ${sameDay ? fmtTime(new Date(tillMs)) : fmtDateTime(new Date(tillMs))}`;
}

// A rupee amount with no symbol, for columns whose heading or neighbour already says rupees (Express's item lines).
const PLAIN_AMOUNT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export function plainAmount(amount: number): string {
  return PLAIN_AMOUNT.format(amount);
}

// A CGST / SGST half in the same symbol-free style: a whole half as plainAmount, an odd half to the paisa ("12.50").
// The whole amount never goes through plainAmount (it would round 12.5 away), as formatHalfGst never uses inr.
const PLAIN_PAISE = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function plainHalfGst(gst: number): string {
  const half = halfGst(gst);
  return Number.isInteger(half) ? plainAmount(half) : PLAIN_PAISE.format(half);
}

/** True when a React node prints nothing: null / undefined / false / "" or an array of only those. */
export function isEmptyNode(node: unknown): boolean {
  if (node === null || node === undefined || node === false || node === true || node === "") return true;
  return Array.isArray(node) && node.every(isEmptyNode);
}
