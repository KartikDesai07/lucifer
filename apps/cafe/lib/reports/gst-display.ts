// GST report presentation helpers — pure, no React (used by app/(dashboard)/
// reports/gst/page.tsx). CGST = SGST = GST / 2 per bill (receiptGst's own
// rule); `inr()` rounds to whole rupees, so a half-GST that lands on an odd
// paisa (e.g. ₹25 GST -> ₹12.50 half) must be shown to the paisa via
// inrPaise, never inr (which would silently round it to ₹13 or ₹12).
import { halfGst } from "@/lib/gst-half";
import { addDays } from "@/lib/dashboard/range";
import type { DashboardRange } from "@/types/dashboard";
import type { GstRateRow } from "@/types/reports";

// The halves moved to lib/gst-half.ts (client-safe, shared with the printed bill); re-exported so callers are unchanged.
export { halfGst, formatHalfGst } from "@/lib/gst-half";

/**
 * The bill-wise CSV is fetched at most this many days per request: a Vercel
 * function response is capped at 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE), and
 * a year of a busy cafe's bill rows is well past that. The route refuses a
 * longer bills request; the client walks the range in chunks of this size.
 */
export const GST_BILLS_MAX_DAYS = 31;

/** The range as consecutive, non-overlapping chunks of at most GST_BILLS_MAX_DAYS days, oldest first. */
export function gstBillChunks(range: DashboardRange): DashboardRange[] {
  const chunks: DashboardRange[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, GST_BILLS_MAX_DAYS)) {
    const last = addDays(from, GST_BILLS_MAX_DAYS - 1);
    chunks.push({ from, to: last < range.to ? last : range.to });
  }
  return chunks;
}

/** "CGST 2.5%" when the range carried exactly one taxed rate (each half carries HALF the rate), else the plain label. */
export function gstRateLabel(rates: readonly GstRateRow[], half: boolean): string {
  const label = half ? "CGST" : "SGST";
  if (rates.length === 1) return `${label} ${halfGst(rates[0].rate)}%`;
  return label;
}
