"use client";

// Menu B2 — the cart's "the menu moved" notice. Shown when an UNSENT line is
// out of stock, off the menu, repriced or renamed (lib/cart-availability.ts).
// Purely presentational: it lives inside <Cart>, which mounts twice (the
// desktop column and the mobile sheet), so it holds no effect and no query.
// The sentences are the server 409's own (lib/order-availability.ts), so the
// toast after a refused Send and this notice read the same.
//
// Money changes only on the cashier's tap: "Update them" shows old -> new
// first and only re-adds the lines when tapped. U1 Task 5 (design 6.8): the owner's HTML note box in WriteNotice's
// "changed" tone (warn), taken from WriteNotice itself so the two never drift.

import { Button } from "@/components/ui/button";
import { WRITE_NOTICE_TONE, noticeBoxClass } from "@/components/pos/WriteNotice";
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
    <div role="status" data-ui="pos-menu-notice" className={cn("min-w-0 space-y-2", noticeBoxClass(WRITE_NOTICE_TONE.changed))}>
      <div className="min-w-0 space-y-0.5 break-words">
        {notice.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        {shown.length > 0 && (
          <ul className="space-y-0.5 font-medium text-foreground">
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
