// CGST / SGST halves — pure and client-safe (the GST report and every printed bill share it). CGST = SGST = GST / 2
// per bill (receiptGst's own rule); `inr()` rounds to whole rupees, so a half-GST that lands on an odd paisa (e.g.
// ₹25 GST -> ₹12.50 half) must be shown to the paisa via inrPaise, never inr (which would silently round it to ₹13
// or ₹12). Moved out of lib/reports/gst-display.ts (which re-exports it) so a bill never pulls the report's code in.
import { inr, inrPaise } from "@/lib/utils";

const HALF = 2;
const PAISE_PER_RUPEE = 100;
const HALF_PAISE_PER_RUPEE = PAISE_PER_RUPEE / HALF; // 1 rupee of GST = 50 paise of half-GST

/** CGST or SGST — half the bill's (or range's) GST. */
export function halfGst(gst: number): number {
  return gst / HALF;
}

/** halfGst(gst), formatted: a whole-rupee half via inr(), an odd half to the paisa. */
export function formatHalfGst(gst: number): string {
  const half = halfGst(gst);
  if (Number.isInteger(half)) return inr(half);
  // gst is in RUPEES; half its value in PAISE is gst * 50 (never divide then
  // re-multiply by a float 100/2, which reintroduces the rounding this exists to avoid).
  return inrPaise(Math.round(gst * HALF_PAISE_PER_RUPEE));
}
