"use client";

import { memo, useMemo, useSyncExternalStore } from "react";

import type { BillDesign } from "@pos/shared/print-template";
import { sampleBillOrder, withSampleToken } from "@/lib/bill-print-sample";
import { printConfigOf } from "@/lib/print";
import { gstConfigOfSettings } from "@/lib/receipt";
import { BILL_EDITOR, activate } from "@/lib/print-design-editor";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import { slipCodeStatus, subscribeSlipCode, templateNeedsSlipCode } from "@/components/print/slip/slip-code";
import type { Settings } from "@/types";

interface DesignThumbProps {
  design: BillDesign;
  /** The SAVED settings: a thumbnail follows them, never the keystrokes in the form, so it does not re-render per key. */
  settings: Settings;
  /** One date for every sample (fixed per mount by the gallery), so the sample's time never ticks. */
  createdAt: string;
  /** The "today's bill" card (no design saved yet): draws the bill printed today, with no template at all. */
  today?: boolean;
}

// The real receipt, scaled down: a design card's picture is <OrderReceipt> over the sample order with the design's
// own starting template, exactly what the editor's preview and a printed bill would draw. 0.4 of the 300px (80mm)
// slip is 120px: a card's picture is about 124px wide both two-across at 360px and four-across beside the preview at
// 1280px (0.45 clipped the amounts, measured in the S4 smoke); the window shows the top of the bill.
const THUMB_HEIGHT_CLASS = "h-44";
const THUMB_SCALE_CLASS = "scale-[0.4]";

// While the design's lazy code has failed to load a preview would silently draw today's bill instead (slip-view.ts),
// so the card says so rather than showing the wrong picture.
const THUMB_UNAVAILABLE_TEXT = "Preview unavailable";

export const DesignThumb = memo(function DesignThumb({ design, settings, createdAt, today = false }: DesignThumbProps) {
  const status = useSyncExternalStore(subscribeSlipCode, slipCodeStatus, slipCodeStatus);
  const shown = useMemo(() => {
    // A design's start turns on every line its locks need, so only no template at all is truly today's bill.
    const template = today ? null : activate(BILL_EDITOR, design, settings).template;
    const withTemplate: Settings = { ...settings, billTemplate: template };
    const order = withSampleToken(
      sampleBillOrder(gstConfigOfSettings(settings), printConfigOf(withTemplate).bill.numberStart, createdAt),
      withTemplate,
    );
    return { template, settings: withTemplate, order };
  }, [design, settings, createdAt, today]);
  const unavailable = status === "failed" && shown.template !== null && templateNeedsSlipCode(shown.template);

  return (
    <div
      aria-hidden="true"
      inert
      className={`${THUMB_HEIGHT_CLASS} relative flex w-full justify-center overflow-hidden bg-white`}
    >
      {unavailable ? (
        <p className="self-center px-2 text-center text-xs text-brand-muted">{THUMB_UNAVAILABLE_TEXT}</p>
      ) : (
        <div className={`pointer-events-none shrink-0 origin-top ${THUMB_SCALE_CLASS}`}>
          <SlipPreview>
            <OrderReceipt order={shown.order} settings={shown.settings} />
          </SlipPreview>
        </div>
      )}
    </div>
  );
});
