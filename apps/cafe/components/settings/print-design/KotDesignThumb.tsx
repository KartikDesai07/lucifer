"use client";

import { memo, useMemo, useSyncExternalStore } from "react";

import type { KotDesign } from "@pos/shared/print-template";
import { sampleKitchenOrder, sampleKitchenSlip, withSampleToken } from "@/lib/bill-print-sample";
import { printConfigOf } from "@/lib/print";
import { KOT_EDITOR, activate } from "@/lib/print-design-editor";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import { slipCodeStatus, subscribeSlipCode, templateNeedsSlipCode } from "@/components/print/slip/slip-code";
import type { Settings } from "@/types";

interface KotDesignThumbProps {
  design: KotDesign;
  /** The SAVED settings: a thumbnail follows them, never the keystrokes in the form, so it does not re-render per key. */
  settings: Settings;
  /** One date for every sample (fixed per mount by the gallery), so the sample's time never ticks. */
  createdAt: string;
  /** The "today's ticket" card (no design saved yet): draws the ticket printed today, with no template at all. */
  today?: boolean;
}

// The real kitchen ticket, scaled down: a design card's picture is <KOTReceipt> over the sample order with the
// design's own starting template, exactly what the editor's preview and a printed ticket would draw. Same 0.4 scale
// and window as DesignThumb (measured in the S4 smoke): the window shows the top of the ticket.
const THUMB_HEIGHT_CLASS = "h-44";
const THUMB_SCALE_CLASS = "scale-[0.4]";

// While the design's lazy code has failed to load a preview would silently draw today's ticket instead (slip-view.ts),
// so the card says so rather than showing the wrong picture.
const THUMB_UNAVAILABLE_TEXT = "Preview unavailable";

export const KotDesignThumb = memo(function KotDesignThumb({ design, settings, createdAt, today = false }: KotDesignThumbProps) {
  const status = useSyncExternalStore(subscribeSlipCode, slipCodeStatus, slipCodeStatus);
  const shown = useMemo(() => {
    // A design's start keeps its own lines, so only no template at all is truly today's ticket.
    const template = today ? null : activate(KOT_EDITOR, design, settings).template;
    const withTemplate: Settings = { ...settings, kotTemplate: template };
    const order = withSampleToken(sampleKitchenOrder(createdAt), withTemplate);
    const slip = sampleKitchenSlip("kot", order, printConfigOf(withTemplate).kot);
    return { template, settings: withTemplate, order, slip };
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
            <KOTReceipt order={shown.order} settings={shown.settings} {...shown.slip} />
          </SlipPreview>
        </div>
      )}
    </div>
  );
});
