// The GST bill's two extra lines on Classic paper (print customization S10). ONE file for the legacy receipt, the
// engine's Classic blocks and the GST settings sample, so today's slip and a saved Classic design can never print them
// two ways (the golden oracle compares them string for string). Each prints only what it is handed: callers render
// them only for a bill that carries GST / an invoice number. Whole literal class names (Tailwind scans source text).
import type { GstBreakdown } from "@/lib/receipt";
import { formatHalfGst, halfGst } from "@/lib/gst-half";

/** The tax split under the GST line: "CGST @2.5%: ₹12.50" and "SGST @2.5%: ₹12.50" (each half = half the rate, half the tax). */
export function GstSplitLines({ gst }: { gst: Pick<GstBreakdown, "rate" | "gstAmount"> }) {
  const rate = halfGst(gst.rate);
  const half = formatHalfGst(gst.gstAmount);
  return (
    <>
      <div className="pl-2 text-[0.83em]">CGST @{rate}%: {half}</div>
      <div className="pl-2 text-[0.83em]">SGST @{rate}%: {half}</div>
    </>
  );
}

/** The bill's "Invoice No." row: the Bill No. row's own look, right under it. `wrap` = the template-path twin (A4:
 *  at a large size the number drops to its own line instead of off the slip). */
export function InvoiceNoRow({ invoiceNo, wrap = false }: { invoiceNo: string; wrap?: boolean }) {
  return wrap ? (
    <div className="flex flex-wrap justify-between gap-2 font-bold">
      <span>Invoice No.</span>
      <span className="ml-auto text-right">{invoiceNo}</span>
    </div>
  ) : (
    <div className="flex justify-between gap-2 font-bold">
      <span>Invoice No.</span>
      <span className="text-right">{invoiceNo}</span>
    </div>
  );
}
