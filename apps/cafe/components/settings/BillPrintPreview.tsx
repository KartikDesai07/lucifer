"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { sampleBillOrder, withSampleToken } from "@/lib/bill-print-sample";
import { printConfigOf } from "@/lib/print";
import type { GstConfig } from "@/lib/receipt";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// Every field the Bill print page edits, as ONE list. The sample bill below is
// the REAL receipt renderer over a real priced order, so it follows the form
// the moment one of these changes. A field added to the page but missing here
// would silently stop updating the preview — lib/bill-print-preview-paths.test.ts
// pins that the two sets are equal.
const WATCHED_PRINT_FIELDS = [
  "billShowNumber",
  "billNumberStart",
  "billShowLogo",
  "billLogoSize",
  "billShowAddress",
  "billShowMobile",
  "billShowGstNumber",
  "billShowFssai",
  "billPaperWidth",
  "billFontSize",
  "receiptHeader",
  "receiptFooter",
] as const;

export function BillPrintPreview({
  control,
  settings,
}: {
  control: Control<SettingsInput>;
  settings: Settings;
}) {
  const [
    billShowNumber,
    billNumberStart,
    billShowLogo,
    billLogoSize,
    billShowAddress,
    billShowMobile,
    billShowGstNumber,
    billShowFssai,
    billPaperWidth,
    billFontSize,
    receiptHeader,
    receiptFooter,
  ] = useWatch({ control, name: WATCHED_PRINT_FIELDS });

  // The saved settings with the form's unsaved print fields laid over them.
  const live: Settings = {
    ...settings,
    billShowNumber,
    billNumberStart,
    billShowLogo,
    billLogoSize,
    billShowAddress,
    billShowMobile,
    billShowGstNumber,
    billShowFssai,
    billPaperWidth,
    billFontSize,
    receiptHeader,
    receiptFooter,
  };
  const cfg = printConfigOf(live).bill;
  // GST is edited on its own page, so the sample prices at the SAVED GST
  // config, with the receipt's own defaults.
  const gstCfg: GstConfig = {
    gstEnabled: settings.gstEnabled ?? false,
    gstRate: settings.gstRate ?? 0,
    gstMode: settings.gstMode ?? "inclusive",
  };
  // Fixed once per mount so the sample's date does not tick while editing.
  const [createdAt] = useState(() => new Date().toISOString());
  const order = withSampleToken(sampleBillOrder(gstCfg, cfg.numberStart, createdAt), live);

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto w-fit shadow-sm ring-1 ring-black/5">
        <SlipPreview>
          <OrderReceipt order={order} settings={live} />
        </SlipPreview>
      </div>
    </div>
  );
}
