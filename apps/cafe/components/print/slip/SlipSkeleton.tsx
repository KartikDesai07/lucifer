import type { ReactNode, Ref } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { PaperWidth } from "@/lib/constants";
import { PAPER_WIDTH_CLASS } from "@/lib/print";
import { SlipPreviewContext } from "./slip-view";

const SKELETON_LINE_WIDTHS = ["w-1/2", "w-2/3", "w-full", "w-full", "w-3/4", "w-1/3"] as const;

/** Marks its receipts as an on-screen preview: they show SlipSkeleton while a design loads (slip-view.ts). */
export function SlipPreview({ children }: { children: ReactNode }) {
  return <SlipPreviewContext.Provider value={true}>{children}</SlipPreviewContext.Provider>;
}

// R6: what a PREVIEW shows while its design's lazy code loads. Never on a print surface: there the receipt renders
// its legacy slip until the code is in (slip-view.ts), so a print is never blank.
export function SlipSkeleton({ paperWidth, ref }: { paperWidth: PaperWidth; ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={`${PAPER_WIDTH_CLASS[paperWidth]} space-y-2 bg-white p-3`}
      role="status"
      aria-busy="true"
      aria-label="Loading the slip design"
    >
      {SKELETON_LINE_WIDTHS.map((width, index) => (
        <Skeleton key={index} className={`h-3 ${width}`} />
      ))}
    </div>
  );
}
