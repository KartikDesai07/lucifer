"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FLOOR_REFRESH_STRIP_BUTTON_CLASS,
  FLOOR_REFRESH_STRIP_CLASS,
  FLOOR_REFRESH_STRIP_GLYPH_CLASS,
  FLOOR_REFRESH_STRIP_HIT_CLASS,
  FLOOR_REFRESH_STRIP_MESSAGE_CLASS,
} from "@/lib/floor-layout";

interface FloorRefreshStripProps {
  /** A read of the tables or the open bills failed while tables are on screen (floorRefreshFailed). */
  show: boolean;
  /** Today's Try again: re-read the tables and the open bills. */
  onRetry: () => void;
}

// The Floor's refresh failure (U3 Task 5; design 6.2, owner Q3): a slim strip, the page's first child above the scroller,
// in the U0 order-request strip's look (lib/floor-layout.ts). The grid never blanks on a failed poll (R17): the tiles keep
// their last data and the header line keeps its "Updated {m} min ago"; this strip is where the failure shows, and it
// leaves once a read succeeds. A status region, as today.
export function FloorRefreshStrip({ show, onRetry }: FloorRefreshStripProps) {
  if (!show) return null;
  return (
    <div role="status" data-ui="floor-refresh-strip" className={FLOOR_REFRESH_STRIP_CLASS}>
      <span data-ui="floor-refresh-message" className={FLOOR_REFRESH_STRIP_MESSAGE_CLASS}>
        <TriangleAlert aria-hidden="true" strokeWidth={1.8} className={FLOOR_REFRESH_STRIP_GLYPH_CLASS} />
        Couldn&apos;t refresh the floor. Showing the last update.
      </span>
      <Button
        type="button"
        variant="outline"
        data-ui="floor-refresh-retry"
        className={`${FLOOR_REFRESH_STRIP_BUTTON_CLASS} ${FLOOR_REFRESH_STRIP_HIT_CLASS}`}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
