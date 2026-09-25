import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { publicOrderStatusPath } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { PublicStatusChip } from "@/components/public/PublicStatusChip";
import { itemNamesPreview } from "@/components/public/public-home-data";
import { PUB_ROW_BUTTON_CLASS, PUB_PRESS_CLASS } from "@/components/public/public-ui";
import type { PastOrder } from "@/components/public/public-orders-grouping";

// CB-6D-B — one row inside the day-grouped tonal card (Home vocabulary: calm,
// one primary action, live orders surfaced separately above). A resolved
// order is a tappable row that opens PublicOrderBillView in the parent; an
// unresolved one (still fetching, or the fetch failed) keeps the Link to the
// live status page instead — it has no bill data to open in place.
//
// F3 (CB-6D-B review fix, MEDIUM) — line 2 used to pack time + "Order #CODE"
// + the status chip into one flex line with no nowrap/shrink guard, so at
// 320-360px the "Waiting for the counter" pill wrapped into a blob. Fix: the
// time/code text is its own block line, and the chip gets its own line with
// a whitespace-nowrap guard.

// HH:MM in the viewer's own clock — this is a "what time did I order" read,
// not a cafe-timezone calendar fact (that is groupOrdersByDate's job).
function orderTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface PublicOrderRowProps {
  order: PastOrder;
  onOpen: (code: string) => void;
}

export function PublicOrderRow({ order, onOpen }: PublicOrderRowProps) {
  if (order.data === null) {
    return (
      <Link
        href={publicOrderStatusPath(order.code)}
        className={cn(PUB_ROW_BUTTON_CLASS, PUB_PRESS_CLASS, "justify-between gap-3 p-4")}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-base font-medium">Your order</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Order #{order.code}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    );
  }

  const { data } = order;

  return (
    <button
      type="button"
      onClick={() => onOpen(order.code)}
      className={cn(PUB_ROW_BUTTON_CLASS, PUB_PRESS_CLASS, "justify-between gap-3 p-4")}
    >
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-base font-medium">
          {itemNamesPreview(data.items) || "Your order"}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {orderTime(data.createdAt)} · Order #{order.code}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <PublicStatusChip status={data.status} className="whitespace-nowrap" />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-base font-semibold tabular-nums">{inr(data.total)}</span>
        <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </span>
    </button>
  );
}
