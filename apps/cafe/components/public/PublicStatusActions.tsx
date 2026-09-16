"use client";

import { RefreshCw } from "lucide-react";

import { DINER_CANCELLED_REASON, type PublicOrderRequestStatusData } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PublicStatusTimeline } from "@/components/public/PublicStatusTimeline";

// Shown when the SERVER turns a refresh away (429). Without it the button just
// silently re-disabled with a countdown and the diner had no idea why — they
// tap a dead control instead (review 2026-09-13). Plain English, no blame.
export const TOO_SOON_MESSAGE = "You're checking a bit too often — please wait a moment.";

// The LONGEST wait the refresh button will ever DISPLAY. A server Retry-After
// counts down the whole fixed window (~600s), and a timestamp stored by a
// phone whose clock was wrong could be further out still; neither should
// present as a permanently dead control to a diner who has no account to sign
// out of. The server remains the real fence either way — this caps only the
// countdown a diner reads (review 2026-09-13).
export const MAX_DISPLAYED_COOLDOWN_MS = 60_000;

// CB-6A S5 split — the status screen's summary card and its two controls
// (manual Refresh, and the diner's own confirm-then-cancel), extracted out of
// PublicOrderStatus.tsx to keep that file inside this repo's ~300-line budget.
//
// PURELY PRESENTATIONAL by design: every piece of state here is owned by
// PublicOrderStatus (the refresh cooldown, the 429 handling, the cancel CAS
// and the poll-staleness guard all live in ONE component, deliberately — a
// state machine split across files is how those guards silently desync).
// This file renders what it is handed and calls back; it decides nothing.

interface PublicStatusActionsProps {
  data: PublicOrderRequestStatusData;
  // Refresh — offered only while the order can still change; the caller owns
  // that rule (TERMINAL_STATUSES) and passes the result here.
  canRefresh: boolean;
  refreshing: boolean;
  cooling: boolean;
  remainingSeconds: number;
  onRefresh: () => void;
  // Cancel — the caller owns the two-tap confirm state and the 409 copy.
  cancellable: boolean;
  confirmingCancel: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => void;
  onDismissCancel: () => void;
}

export function PublicStatusActions({
  data,
  canRefresh,
  refreshing,
  cooling,
  remainingSeconds,
  onRefresh,
  cancellable,
  confirmingCancel,
  cancelling,
  cancelError,
  onCancel,
  onDismissCancel,
}: PublicStatusActionsProps) {
  return (
    <>
      {/* Order total + charge line — unchanged from before this slice. */}
      <div className="rounded-lg border p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">For</span>
          <span className="font-medium">{data.parcel ? "Parcel" : (data.tableLabel ?? "—")}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Items</span>
          <span className="font-medium">{data.itemCount}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium">{inr(data.total)}</span>
        </div>
      </div>

      {/* Manual refresh — offered only while the order can still change; a
          settled (terminal) order has nothing left to check. The countdown
          text is the SERVER's cooldown, surfaced by the caller. */}
      {canRefresh && (
        <Button
          type="button"
          variant="outline"
          className={PUBLIC_TOUCH_TARGET_CLASS}
          aria-label="Refresh order status"
          disabled={cooling || refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className="h-4 w-4" />
          {refreshing ? "Refreshing…" : cooling ? `Refresh in ${remainingSeconds}s` : "Refresh"}
        </Button>
      )}

      {/* Cancel — only while the counter hasn't touched it yet. */}
      {cancellable && (
        <div className="space-y-2">
          {cancelError && <p className="text-xs text-destructive">{cancelError}</p>}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={confirmingCancel ? "destructive" : "outline"}
              size="sm"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? "Cancelling…" : confirmingCancel ? "Really cancel?" : "Cancel this order"}
            </Button>
            {confirmingCancel && !cancelling && (
              <button
                type="button"
                onClick={onDismissCancel}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Never mind
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// The screen's HEAD: the order code, and the one status that keeps its own
// red card instead of the timeline. Extracted here (CB-6A review round) to
// keep PublicOrderStatus.tsx inside the ~300-line budget after the ticker fix.
export function PublicStatusHead({ data }: { data: PublicOrderRequestStatusData }) {
  return (
    <>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Order</p>
        <h1 className="text-2xl font-bold tabular-nums">{data.shortCode}</h1>
      </div>

      {/* rejected keeps its own red card — NO timeline (staff reason,
          diner-cancel special case, unchanged from before the timeline). */}
      {data.status === "rejected" ? (
        <div className="rounded-lg border p-4">
          <p className="text-base font-semibold text-destructive">{statusLine(data)}</p>
          {/* The diner's OWN cancel reads back as "Cancelled by you" above —
              repeating the raw DINER_CANCELLED_REASON sentence here would be
              redundant at best. A staff-entered reason still shows in full. */}
          {data.rejectedReason && data.rejectedReason !== DINER_CANCELLED_REASON && (
            <p className="mt-1 text-sm text-muted-foreground">{data.rejectedReason}</p>
          )}
        </div>
      ) : (
        <PublicStatusTimeline status={data.status} acceptedAt={data.acceptedAt} />
      )}
    </>
  );
}

// Red-card copy for a rejected request — the ONE status that keeps its own
// text instead of the Timeline (pending/accepting/accepted all render via
// PublicStatusTimeline now). The diner's own cancel reuses "rejected" (see
// the cancel route's own comment); this exact reason is how the two are told
// apart, so a diner's own cancel never reads as the scarier staff-rejected copy.
function statusLine(data: PublicOrderRequestStatusData): string {
  return data.rejectedReason === DINER_CANCELLED_REASON ? "Cancelled by you" : "Couldn't be taken";
}
