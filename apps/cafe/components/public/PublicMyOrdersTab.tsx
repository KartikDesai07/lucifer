"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ClipboardList } from "lucide-react";

import {
  publicOrderStatusPath,
  type PublicGstConfig,
  type PublicOrderRequestStatusData,
  type PublicStatusItem,
} from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { readMyCodes } from "@/components/public/public-cart-store";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { groupOrdersByDate, type PastOrder } from "@/components/public/public-orders-grouping";
import { PublicOrderBillView } from "@/components/public/PublicOrderBillView";
import { cn } from "@/lib/utils";

// CB-4 — the diner's "My Orders" tab.
//
// Reads the DEVICE's own order-code history (localStorage, written at submit
// time), not a server-side per-account list. That is deliberate for this
// slice: the codes are already there, each one is capability-scoped (holding
// the code IS the authorization, the same model the status page uses), and it
// works for a diner who has never made an account. An account-keyed server
// history is a strictly larger change — it needs its own authorization story
// on the order-request read path — and belongs with the redemption work.
//
// S8 — rebuilt into a LIST-or-DETAIL container: the list is date-grouped
// (public-orders-grouping.ts) and tapping a row opens a read-only bill
// (PublicOrderBillView) with an explicit BACK control, instead of linking out
// to the standalone status page.

// How many past orders to resolve. Each is one request, so this bounds the
// fan-out on a cheap phone and a 512MB M0 alike. The per-shortCode read-rate
// bucket on GET /api/public/order-request/[shortCode] makes this fan-out safe
// to keep exactly as-is — every code has its own bucket.
const MAX_SHOWN = 8;

export type { PastOrder };

interface PublicMyOrdersTabProps {
  signedIn: boolean;
  dinerName: string;
  onSignIn: () => void;
  onSignOut: () => void;
  // "Order this again" — the shell owns the cart write and the tab switch,
  // because the cart lives in PublicOrderFlow's tree, not this one.
  onRepeat: (items: PublicStatusItem[]) => void;
  // Menu-only mode (Settings selfOrderMode === "menu"): the server already
  // 403s an order attempt, so the "Order this again" affordance is hidden
  // rather than left to fail.
  orderingAllowed: boolean;
  // The bill view derives GST for display via billFromStatusData(data, gst).
  // This tab does not fetch the menu itself — see PublicOrderBillView's own
  // comment on why gst is threaded in as a prop instead.
  gst: PublicGstConfig;
  // Fires once the mount-time fan-out settles, so another tab can show a
  // "last order" summary without a second fan-out of its own.
  onOrdersResolved?: (orders: PastOrder[]) => void;
}

export function PublicMyOrdersTab({
  signedIn,
  dinerName,
  onSignIn,
  onSignOut,
  onRepeat,
  orderingAllowed,
  gst,
  onOrdersResolved,
}: PublicMyOrdersTabProps) {
  const [orders, setOrders] = useState<PastOrder[] | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => {
    const codes = readMyCodes().slice(0, MAX_SHOWN);
    if (codes.length === 0) {
      setOrders([]);
      return;
    }
    setOrders(codes.map((code) => ({ code, data: null })));
    // Guards every in-flight resolve against a setState after unmount (the
    // diner switching tabs mid-fetch is the normal case here, not the edge).
    let cancelled = false;
    let remaining = codes.length;
    for (const code of codes) {
      fetch(`/api/public/order-request/${encodeURIComponent(code)}`)
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const envelope = (await res.json().catch(() => null)) as
            | { success: true; data: PublicOrderRequestStatusData }
            | null;
          if (!envelope?.success || cancelled) return;
          setOrders((prev) =>
            prev ? prev.map((o) => (o.code === code ? { ...o, data: envelope.data } : o)) : prev,
          );
        })
        .catch(() => {
          // Leave the row with a null payload — it still renders its code and
          // its bill view stays reachable (grouped into the trailing bucket).
        })
        .finally(() => {
          remaining -= 1;
          if (remaining === 0 && !cancelled) {
            // Read the latest resolved snapshot rather than closing over the
            // stale `codes`-only placeholder list built above.
            setOrders((prev) => {
              if (prev) onOrdersResolved?.(prev);
              return prev;
            });
          }
        });
    }
    return () => {
      cancelled = true;
    };
    // onOrdersResolved is intentionally excluded — this fan-out is mount-time
    // only (same as before S8) and must not re-fire on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (orders === null) {
    return (
      <div className="space-y-pub-gap p-pub-pad">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const openOrder = openCode ? orders.find((o) => o.code === openCode) ?? null : null;

  if (openOrder?.data) {
    return (
      <div className="space-y-pub-gap p-pub-pad">
        <Button
          variant="ghost"
          className={cn("gap-1 px-2", PUBLIC_TOUCH_TARGET_CLASS)}
          onClick={() => setOpenCode(null)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <PublicOrderBillView
          data={openOrder.data}
          gst={gst}
          orderingAllowed={orderingAllowed}
          onRepeat={onRepeat}
        />
      </div>
    );
  }

  const groups = groupOrdersByDate(orders, new Date());

  return (
    <div className="space-y-pub-gap p-pub-pad">
      {signedIn && (
        <div className="flex items-center justify-between gap-pub-gap rounded-lg border p-pub-pad">
          <p className="text-sm">
            Signed in{dinerName.length > 0 ? ` as ${dinerName}` : ""}
          </p>
          <Button variant="ghost" className={PUBLIC_TOUCH_TARGET_CLASS} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" aria-hidden="true" />}
          title="No orders yet"
          description="Orders you place from this menu will show up here."
          action={
            signedIn ? undefined : (
              <Button variant="outline" className={PUBLIC_TOUCH_TARGET_CLASS} onClick={onSignIn}>
                Sign in
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="space-y-pub-gap">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{group.label}</p>
              <ul className="space-y-pub-gap">
                {group.orders.map((order) => (
                  <li key={order.code} className="rounded-lg border">
                    {order.data ? (
                      <button
                        type="button"
                        onClick={() => setOpenCode(order.code)}
                        className="flex w-full items-center justify-between gap-pub-gap p-pub-pad text-left"
                      >
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-sm font-medium">{statusWord(order.data.status)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {order.data.itemCount} {order.data.itemCount === 1 ? "item" : "items"}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums">{inr(order.data.total)}</span>
                      </button>
                    ) : (
                      <Link
                        href={publicOrderStatusPath(order.code)}
                        className="flex items-center justify-between gap-pub-gap p-pub-pad"
                      >
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-sm font-medium">Your order</span>
                          <span className="block text-xs text-muted-foreground">Code {order.code}</span>
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// EXHAUSTIVE by construction — a new request status fails tsc here rather than
// rendering a raw enum value to a diner.
const STATUS_WORDS: Record<PublicOrderRequestStatusData["status"], string> = {
  pending: "Waiting for the counter",
  accepting: "Being prepared",
  accepted: "Accepted",
  rejected: "Cancelled",
};

function statusWord(status: PublicOrderRequestStatusData["status"]): string {
  return STATUS_WORDS[status];
}
