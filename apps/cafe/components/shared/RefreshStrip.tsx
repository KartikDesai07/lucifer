"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  REFRESH_STRIP_BUTTON_CLASS,
  REFRESH_STRIP_CLASS,
  REFRESH_STRIP_GLYPH_CLASS,
  REFRESH_STRIP_HIT_CLASS,
  REFRESH_STRIP_MESSAGE_CLASS,
} from "@/lib/ui/refresh-strip";

interface RefreshStripProps {
  /** The page's last good answer is too old (a failed poll, an offline device) while its data is on screen. */
  show: boolean;
  /** The page's words: "Couldn't refresh the {what}. Showing the last update." */
  message: string;
  /** Today's Try again: re-read what the page shows. */
  onRetry: () => void;
  /** The page, for the data-ui names: floor-refresh-strip / -message / -retry, kitchen-refresh-strip / … */
  ui: "floor" | "kitchen";
}

// A live page's refresh failure (U3 Task 5 for the Floor, design 6.2; shared with the Kitchen in U4 Task 2, Kitchen design
// 6.2): a slim strip, the page's first child above its scroller, in the U0 order-request strip's look
// (lib/ui/refresh-strip.ts). The page never blanks on a failed poll: its content keeps the last data and the header line
// its "Updated {m} min ago"; this strip is where the failure shows, and it leaves once a read succeeds. A status region.
export function RefreshStrip({ show, message, onRetry, ui }: RefreshStripProps) {
  if (!show) return null;
  return (
    <div role="status" data-ui={`${ui}-refresh-strip`} className={REFRESH_STRIP_CLASS}>
      <span data-ui={`${ui}-refresh-message`} className={REFRESH_STRIP_MESSAGE_CLASS}>
        <TriangleAlert aria-hidden="true" strokeWidth={1.8} className={REFRESH_STRIP_GLYPH_CLASS} />
        {message}
      </span>
      <Button
        type="button"
        variant="outline"
        data-ui={`${ui}-refresh-retry`}
        className={`${REFRESH_STRIP_BUTTON_CLASS} ${REFRESH_STRIP_HIT_CLASS}`}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
