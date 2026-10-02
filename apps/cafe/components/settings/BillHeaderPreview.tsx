"use client";

import Image from "next/image";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { PrintLogoSize } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { productImageUrl } from "@/lib/images";
import {
  printConfigOf,
  PAPER_WIDTH_CLASS,
  PRINT_FONT_CLASS,
  PRINT_LOGO_CLASS,
} from "@/lib/print";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// The top of a bill as it prints from this browser, live as the fields above
// are typed. Which lines print (logo, address, phone, GSTIN, FSSAI) and the
// paper, font and logo size come from the SAVED Bill print section. The gates
// below mirror the header block of components/pos/OrderReceipt.tsx line for
// line and are parity-pinned in lib/bill-header-preview-paths.test.ts.

// Mirrors OrderReceipt's: next/image's intrinsic width/height per
// PRINT_LOGO_CLASS box — the CSS class sets the displayed size.
const LOGO_DIMENSIONS_PX: Record<PrintLogoSize, { width: number; height: number }> = {
  small: { width: 80, height: 36 },
  medium: { width: 120, height: 56 },
  large: { width: 170, height: 80 },
};

export function BillHeaderPreview({
  control,
  settings,
}: {
  control: Control<SettingsInput>;
  settings: Settings;
}) {
  const [logo, restaurantName, tagline, address, mobile, fssaiValue] = useWatch({
    control,
    name: ["logo", "restaurantName", "tagline", "address", "mobile", "fssai"],
  });
  const cfg = printConfigOf(settings).bill;
  const name = restaurantName?.trim();
  const taglineText = tagline?.trim();
  const addressText = address?.trim();
  const mobileText = mobile?.trim();
  const header = settings.receiptHeader?.trim();
  const gstNumber = settings.gstNumber?.trim();
  const fssai = fssaiValue?.trim();
  const logoUrl = productImageUrl(logo, undefined, { fit: true });
  const logoDim = LOGO_DIMENSIONS_PX[cfg.logoSize];
  // The receipt gates GSTIN on the order's GST snapshot; a new order carries
  // GST exactly when GST is on with a rate above 0 (an exclusive-GST order
  // that came to no GST amount prints none — not a case a preview can model).
  const gstShows = settings.gstEnabled && (settings.gstRate ?? 0) > 0;
  const hasLine = Boolean(
    (cfg.showLogo && logoUrl) ||
      name ||
      taglineText ||
      (cfg.showAddress && addressText) ||
      (cfg.showMobile && mobileText) ||
      (cfg.showGstNumber && gstShows && gstNumber) ||
      (cfg.showFssai && fssai) ||
      header,
  );

  return (
    <div className="overflow-x-auto">
      <div
        className={cn(
          PAPER_WIDTH_CLASS[cfg.paperWidth],
          PRINT_FONT_CLASS[cfg.fontSize],
          "mx-auto bg-white p-3 font-mono text-black shadow-sm ring-1 ring-black/5",
        )}
      >
        <div className="text-center">
          {cfg.showLogo && logoUrl && (
            <Image
              src={logoUrl}
              alt=""
              width={logoDim.width}
              height={logoDim.height}
              unoptimized
              className={`${PRINT_LOGO_CLASS[cfg.logoSize]} mx-auto object-contain`}
            />
          )}
          {name && (
            <div className="text-[1.33em] font-bold tracking-wide">{name}</div>
          )}
          {taglineText && <div className="text-[0.83em]">{taglineText}</div>}
          {cfg.showAddress && (
            <>{addressText && <div className="text-[0.83em]">{addressText}</div>}</>
          )}
          {cfg.showMobile && (
            <>{mobileText && <div className="text-[0.83em]">Ph: {mobileText}</div>}</>
          )}
          {cfg.showGstNumber && (
            <>
              {gstShows && gstNumber && (
                <div className="text-[0.83em]">GSTIN: {gstNumber}</div>
              )}
            </>
          )}
          {cfg.showFssai && (
            <>{fssai && <div className="text-[10px]">FSSAI: {fssai}</div>}</>
          )}
          {header && <div className="mt-1 text-[0.83em]">{header}</div>}
          {!hasLine && (
            <p className="text-[0.83em] text-black/60">Add your restaurant&apos;s name to see the top of the bill.</p>
          )}
        </div>
        <div className="my-1 border-t border-dashed border-black" />
        <p className="text-center text-[0.83em] text-black/60">Items print here</p>
      </div>
    </div>
  );
}
