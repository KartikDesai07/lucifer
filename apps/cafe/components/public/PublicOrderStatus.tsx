"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  DINER_CANCELLED_REASON,
  isPublicCode,
  PUBLIC_MENU_PATH,
  type PublicOrderRequestStatusData,
} from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { readLastMenuPath } from "@/components/public/public-cart-store";
import { PublicMyOrdersChips, PublicStatusTimeline } from "@/components/public/PublicStatusTimeline";
import { PublicStatusItems } from "@/components/public/PublicStatusItems";

// Polls fast right after the diner submits (staff typically act within a
// minute), then backs off to spare the M0 for an order left open on a phone
// screen for the rest of the meal.
const POLL_FAST_MS = 5_000;
const POLL_FAST_WINDOW_MS = 60_000;
const POLL_SLOW_MS = 30_000;

const TERMINAL_STATUSES = new Set<PublicOrderRequestStatusData["status"]>(["accepted", "rejected"]);

const ORDER_NOT_FOUND_MESSAGE = "We couldn't find that order.";
const RECONNECTING_MESSAGE = "Can't reach the counter right now — showing your last known status.";
const CANCEL_CONFLICT_MESSAGE = "This order is already being prepared — ask at the counter.";
const CANCEL_FAILED_MESSAGE = "Couldn't cancel — please try again.";

interface PublicOrderStatusProps {
  code: string;
}

// The diner's post-submit poll target — GET /api/public/order-request/[code],
// fetched with PLAIN fetch, never apiGet: apiGet collapses a 404 envelope and
// a network throw into the SAME Error, but this screen must tell a diner "we
// can't find that order" (terminal — stop polling) apart from "can't reach
// the counter" (transient — keep the last known status and keep trying).
export function PublicOrderStatus({ code }: PublicOrderStatusProps) {
  const [data, setData] = useState<PublicOrderRequestStatusData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const mountedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the last successful save landed — any poll ISSUED before this is a
  // stale read of items/total and must not be applied (see poll() below).
  const adoptedAt = useRef(0);
  // Confirm-then-cancel state for the diner's own "Cancel this order" button.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Bumped on a successful cancel — OR a 409 from PublicStatusItems' own
  // Save — to force the poll effect below to re-run (and so re-fetch
  // immediately) rather than waiting for its next tick.
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    if (!isPublicCode(code)) {
      setNotFound(true);
      return;
    }
    let cancelled = false;

    function schedule() {
      const elapsed = Date.now() - mountedAt.current;
      const delay = elapsed < POLL_FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      timerRef.current = setTimeout(poll, delay);
    }

    async function poll() {
      // Stamped BEFORE the request leaves: a poll issued before a save
      // committed may still land AFTER its 200, and applying it would revert
      // the just-saved lines/total on screen until the next tick — up to 30s
      // in the slow phase (review 2026-08-20).
      const issuedAt = Date.now();
      try {
        const res = await fetch(`/api/public/order-request/${encodeURIComponent(code)}`);
        if (res.status === 404) {
          if (!cancelled) {
            setNotFound(true);
            setOffline(false);
          }
          return;
        }
        if (!res.ok) throw new Error("request failed");
        const envelope = (await res.json().catch(() => null)) as {
          success: true;
          data: PublicOrderRequestStatusData;
        } | null;
        if (!envelope?.success) throw new Error("bad envelope");
        if (cancelled) return;
        setOffline(false);
        setNotFound(false);
        if (issuedAt < adoptedAt.current) {
          // Stale read from before the last successful save — its STATUS may
          // still be useful, but its items/total are known-outdated, so drop
          // the body entirely and just keep the loop alive.
          if (!TERMINAL_STATUSES.has(envelope.data.status)) schedule();
          return;
        }
        setData(envelope.data);
        if (TERMINAL_STATUSES.has(envelope.data.status)) return; // reached a terminal state — stop polling
        schedule();
      } catch {
        // A fetch throw (or a non-404 non-OK response) is a connectivity
        // blip, not proof the order is gone — keep the last known status on
        // screen and keep trying; never fall back to "not found" here.
        if (!cancelled) {
          setOffline(true);
          schedule();
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // refetchToken is a deliberate re-run trigger, not a value read inside —
    // bumping it after a successful cancel restarts this whole poll loop
    // (clearing any pending timer first) so the new status lands immediately
    // instead of waiting out the current backoff.
  }, [code, refetchToken]);

  // Lets PublicStatusItems' own "Save changes" adopt the PATCH response's
  // total/itemCount immediately (the summary card below reads off `data`,
  // never a second source of truth) instead of waiting on the next poll tick.
  function handleAdopt(total: number, itemCount: number) {
    adoptedAt.current = Date.now();
    setData((prev) => (prev ? { ...prev, total, itemCount } : prev));
  }

  // A 409 mid-save means the request just left "pending" out from under the
  // diner — re-fetch right away so the Timeline/red-card catches up now.
  function handleForceRepoll() {
    setRefetchToken((t) => t + 1);
  }

  // First tap arms the confirm state; second tap actually cancels. A 409
  // means staff already have it — surfaced inline, never re-armed.
  async function handleCancel() {
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/public/order-request/${encodeURIComponent(code)}/cancel`, {
        method: "POST",
      });
      if (res.status === 409) {
        setCancelError(CANCEL_CONFLICT_MESSAGE);
        setConfirmingCancel(false);
        setCancelling(false);
        return;
      }
      if (!res.ok) throw new Error("cancel failed");
      setConfirmingCancel(false);
      setCancelling(false);
      setRefetchToken((t) => t + 1); // re-fetch now rather than on the next poll tick
    } catch {
      setCancelError(CANCEL_FAILED_MESSAGE);
      setCancelling(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <EmptyState title="Order not found" description={ORDER_NOT_FOUND_MESSAGE} />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-28">
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

      <PublicStatusItems
        shortCode={code}
        items={data.items}
        note={data.note}
        promoCode={data.promoCode}
        quotedDiscount={data.quotedDiscount}
        status={data.status}
        onAdopt={handleAdopt}
        onForceRepoll={handleForceRepoll}
      />

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

      {offline && <p className="text-xs text-muted-foreground">{RECONNECTING_MESSAGE}</p>}

      {/* Cancel — only while the counter hasn't touched it yet. */}
      {data.status === "pending" && (
        <div className="space-y-2">
          {cancelError && <p className="text-xs text-destructive">{cancelError}</p>}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={confirmingCancel ? "destructive" : "outline"}
              size="sm"
              disabled={cancelling}
              onClick={handleCancel}
            >
              {cancelling ? "Cancelling…" : confirmingCancel ? "Really cancel?" : "Cancel this order"}
            </Button>
            {confirmingCancel && !cancelling && (
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Never mind
              </button>
            )}
          </div>
        </div>
      )}

      {/* "Your orders on this visit" (§17.B point 5) — owns its own state/
          fetch; hidden entirely when empty. */}
      <PublicMyOrdersChips currentCode={code} />

      {/* Order more — always offered, any status — back to wherever this
          order was placed from (readLastMenuPath), or the bare menu. */}
      <Button asChild variant="secondary" size="lg" className="w-full">
        <Link href={readLastMenuPath() ?? PUBLIC_MENU_PATH}>+ Order more items</Link>
      </Button>
    </main>
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
