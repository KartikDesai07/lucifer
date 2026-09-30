"use client";

// Menu B2 — the cart's "the menu moved" notice. Shown when an UNSENT line is
// out of stock, off the menu, repriced or renamed (lib/cart-availability.ts).
// Purely presentational: it lives inside <Cart>, which mounts twice (the
// desktop column and the mobile sheet), so it holds no effect and no query.
// The sentences are the server 409's own (lib/order-availability.ts), so the
// toast after a refused Send and this notice read the same.
//
// Money changes only on the cashier's tap: "Update them" shows old -> new
// first and only re-adds the lines when tapped. Amber = the same "changed" tone
// as WriteNotice.tsx.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  changedRowText,
  changedRowsShown,
  type CartMenuNotice,
} from "@/lib/cart-availability";

export interface CartMenuNoticeProps extends CartMenuNotice {
  onRemoveUnavailable: () => void;
  onUpdateChanged: () => void;
}

// WriteNotice.tsx's "changed" tone, verbatim (pinned).
const NOTICE_TONE = "bg-amber-100 text-amber-800";

// Touch size: 44px below md, the compact button from md up.
const NOTICE_BUTTON_CLASS = "min-h-11 md:min-h-8";

export function CartUnavailableNotice({
  notice,
  disabled,
}: {
  notice: CartMenuNoticeProps | null | undefined;
  disabled?: boolean;
}) {
  if (!notice) return null;
  const { shown, more } = changedRowsShown(notice.changed);
  return (
    <div role="status" className={cn("min-w-0 space-y-2 rounded-md p-3 text-sm", NOTICE_TONE)}>
      <div className="min-w-0 space-y-0.5 break-words">
        {notice.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        {shown.length > 0 && (
          <ul className="space-y-0.5 font-medium">
            {shown.map((row) => (
              <li key={row.lineId}>{changedRowText(row)}</li>
            ))}
            {more > 0 && <li>and {more} more</li>}
          </ul>
        )}
        <p>{notice.action}</p>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {notice.unavailable.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={NOTICE_BUTTON_CLASS}
            disabled={disabled}
            onClick={notice.onRemoveUnavailable}
          >
            Remove them
          </Button>
        )}
        {notice.changed.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={NOTICE_BUTTON_CLASS}
            disabled={disabled}
            onClick={notice.onUpdateChanged}
          >
            Update them
          </Button>
        )}
      </div>
    </div>
  );
}
