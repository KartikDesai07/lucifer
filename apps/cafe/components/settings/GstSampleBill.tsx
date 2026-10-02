"use client";

import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { cn, inr } from "@/lib/utils";
import { sampleGstBill, SAMPLE_ITEM_PRICE } from "@/lib/gst-sample-bill";
import type { SampleGstBill } from "@/lib/gst-sample-bill";
import { printConfigOf, PAPER_WIDTH_CLASS, PRINT_FONT_CLASS } from "@/lib/print";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// A sample bill for one ₹100 item, live as the GST fields are edited. The
// GSTIN gate, the tax lines and the TOTAL row mirror the body of
// components/pos/OrderReceipt.tsx line for line, and the money comes from
// lib/gst-sample-bill.ts (the real bill maths). Paper width, font and whether
// the GSTIN prints come from the SAVED Bill print section. Parity-pinned in
// lib/gst-sample-bill.test.ts.

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

function SampleBody({
  bill,
  showGstNumber,
  gstNumber,
}: {
  bill: SampleGstBill;
  showGstNumber: boolean;
  gstNumber: string | undefined;
}) {
  const { gst } = bill;
  return (
    <>
      <div className="text-center">
        {showGstNumber && gst.show && gstNumber && (
          <div className="text-[0.83em]">GSTIN: {gstNumber}</div>
        )}
      </div>
      <Divider />
      <div className="flex justify-between">
        <span className="pr-2">Sample item</span>
        <span>{inr(SAMPLE_ITEM_PRICE)}</span>
      </div>
      <Divider />
      <div className="space-y-0.5">
        <Line label="Subtotal" value={inr(bill.subtotal)} />
        {gst.show && !gst.inclusive && (
          <Line label={`GST @${gst.rate}%`} value={`+${inr(gst.gstAmount)}`} />
        )}
        <div className="flex justify-between text-[1.17em] font-bold">
          <span>TOTAL</span>
          <span>{inr(bill.total)}</span>
        </div>
        {gst.show && gst.inclusive && (
          <div className="pl-2 text-[0.83em]">
            incl. GST @{gst.rate}%: {inr(gst.gstAmount)} (taxable{" "}
            {inr(gst.taxable)})
          </div>
        )}
      </div>
    </>
  );
}

export function GstSampleBill({
  control,
  settings,
}: {
  control: Control<SettingsInput>;
  settings: Settings;
}) {
  const [gstEnabled, gstMode, gstRate, gstNumberValue] = useWatch({
    control,
    name: ["gstEnabled", "gstMode", "gstRate", "gstNumber"],
  });
  const cfg = printConfigOf(settings).bill;
  const bill = sampleGstBill({ gstEnabled, gstRate, gstMode });

  return (
    <div className="overflow-x-auto">
      <div
        className={cn(
          PAPER_WIDTH_CLASS[cfg.paperWidth],
          PRINT_FONT_CLASS[cfg.fontSize],
          "mx-auto bg-white p-3 font-mono text-black shadow-sm ring-1 ring-black/5",
        )}
      >
        {bill ? (
          <SampleBody bill={bill} showGstNumber={cfg.showGstNumber} gstNumber={gstNumberValue?.trim()} />
        ) : (
          <p className="text-center text-[0.83em] text-black/60">Enter a GST rate to see the sample bill.</p>
        )}
      </div>
    </div>
  );
}
