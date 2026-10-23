"use client";

import { PAY_STYLES } from "@/lib/constants";
import { inr, timeAgo, cn } from "@/lib/utils";
import { PAY_PILL_KIND, STATUS_CLASSES, type StatusKind } from "@/lib/ui";
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { plural } from "@/lib/dashboard/format";
import { channelOf } from "@/lib/dashboard/channel";
import { recentOrderCode } from "@/lib/orders-row";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { DASH_PILL_CLASS, DashCard } from "@/components/dashboard/DashCard";
import type { Order } from "@/types";

interface RecentOrdersProps {
  orders: Order[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onSelect: (order: Order) => void;
}

// At most five — the dashboard is a glance, the full list lives on Orders
// (owner, 2026-09-29: "recent order max 5 hi hona chahiye").
const MAX_ROWS = 5;
/** A row (values 3.7): 10px + the 40px tile + 10px, over its 1px rule. */
const ROW_PX = 61;

/** Our payment kinds in the HTML's pill colours: Online the HTML's UPI blue, Cash ok, Split the HTML's Card purple, Due
 *  bill, Credit and an open tab warn, a cancelled bill bad (the HTML's Refunded). */
function payPill(order: Order): { label: string; kind: StatusKind } {
  if (order.status === "Cancelled") return { label: "Cancelled", kind: "bad" };
  return { label: PAY_STYLES[order.payment]?.label ?? order.payment, kind: PAY_PILL_KIND[order.payment] ?? "neutral" };
}

const ROW_CLASS = cn(
  "-mx-2 grid grid-cols-[40px_minmax(0,1fr)_auto] @min-[560px]:grid-cols-[40px_minmax(0,1fr)_auto_84px] items-center gap-3 rounded-[10px] border-t border-border-2 px-2 py-2.5 text-left text-foreground hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-ring",
  HTML_PRESS_CLASS,
);

/**
 * Today's newest orders as the owner's HTML list (values 3.7, ruling R17): the code tile, "#NNN · {table | Walk-in}",
 * "{type} · {n} items · {ago}", the payment pill (gone below a 560px content width, as the HTML's) and the amount.
 * Every status of today stays: a cancelled bill keeps its row with its amount struck through, since the figures above
 * exclude it. Rows open the shared OrderDetailSheet via onSelect (the dashboard owns the sheet so its print/complete
 * actions are reused).
 */
export function RecentOrders({ orders, loading, isError, onRetry, onSelect }: RecentOrdersProps) {
  const rows = orders.slice(0, MAX_ROWS);
  const status = loading ? "loading" : isError && orders.length === 0 ? "error" : rows.length === 0 ? "empty" : "ready";

  return (
    <DashCard
      variant="dashboard"
      ui="recent-card"
      className="pb-2"
      bodyGap={10}
      title="Recent orders"
      period="Today · newest first"
      link={{ href: "/orders", label: "All orders" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No orders yet today", description: "Orders taken on the POS show up here as they are placed." }}
      bodyMinHeight={MAX_ROWS * ROW_PX}
    >
      <ul data-ui="recent-list" className="flex flex-col">
        {rows.map((order) => {
          const cancelled = order.status === "Cancelled";
          const pill = payPill(order);
          const items = order.items.reduce((n, line) => n + line.qty, 0);
          return (
            <li key={order._id} className="flex flex-col">
              <button type="button" data-ui="recent-row" title={order.orderId} onClick={() => onSelect(order)} className={ROW_CLASS}>
                <span data-ui="recent-code" className="flex size-10 items-center justify-center rounded-[10px] bg-surface-3 text-[12.5px] font-semibold">
                  {recentOrderCode(order)}
                </span>
                <span className="min-w-0">
                  <span data-ui="recent-title" className="block text-[14px] font-semibold">
                    {`#${order.orderId.split("-").pop() ?? order.orderId} · ${order.tableNo || "Walk-in"}`}
                  </span>
                  <span data-ui="recent-meta" className="mt-0.5 block truncate text-[12.5px] text-subtle-foreground">
                    {`${CHANNEL_LABELS[channelOf(order)]} · ${plural(items, "item")} · ${timeAgo(order.createdAt)}`}
                  </span>
                </span>
                <span data-ui="recent-pay" className={cn(DASH_PILL_CLASS, "hidden @min-[560px]:flex [justify-self:start]", STATUS_CLASSES[pill.kind].pill)}>
                  {pill.label}
                </span>
                <span
                  data-ui="recent-amount"
                  className={cn("text-right font-mono text-[14px] font-semibold", cancelled && "text-subtle-foreground line-through")}
                >
                  {inr(order.total)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}
