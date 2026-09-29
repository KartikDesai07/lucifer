"use client";

import { PAY_STYLES } from "@/lib/constants";
import { inr, timeAgo, cn } from "@/lib/utils";
import { DashCard } from "@/components/dashboard/DashCard";
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
const ROW_PX = 52;

// "ORD-20260929-009" → "Order #009" (the full id stays in the tooltip and on Orders).
function shortOrderId(orderId: string): string {
  return `Order #${orderId.split("-").pop() ?? orderId}`;
}

// Today's newest orders. Rows open the shared OrderDetailSheet via onSelect
// (the dashboard owns the sheet so its print/complete actions are reused).
export function RecentOrders({ orders, loading, isError, onRetry, onSelect }: RecentOrdersProps) {
  const rows = orders.slice(0, MAX_ROWS);
  const status = loading ? "loading" : isError && orders.length === 0 ? "error" : rows.length === 0 ? "empty" : "ready";

  return (
    <DashCard
      title="Recent orders"
      period="Today · newest first"
      link={{ href: "/orders", label: "View all" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No orders yet today", description: "Orders taken on the POS show up here as they are placed." }}
      bodyMinHeight={MAX_ROWS * ROW_PX}
    >
      <ul className="divide-y divide-brand-rule/70">
        {rows.map((order) => {
          const payStyle = PAY_STYLES[order.payment];
          // A cancelled bill keeps its historical payment mode and total, but the
          // figures above exclude it — so showing the row as an ordinary sale
          // would make the dashboard contradict itself. Mark it and strike the
          // amount instead of hiding the row (the trail stays visible).
          const cancelled = order.status === "Cancelled";
          return (
            <li key={order._id}>
              <button
                type="button"
                onClick={() => onSelect(order)}
                style={{ minHeight: ROW_PX }}
                className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-brand-ink" title={order.orderId}>
                      {shortOrderId(order.orderId)}
                    </span>
                    <span className="shrink-0 text-[12px] text-brand-muted">{order.tableNo ?? "Walk-in"}</span>
                  </div>
                  <div className="truncate text-[12px] text-brand-muted">
                    {order.customerName} · {timeAgo(order.createdAt)}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border border-brand-rule px-2 py-0.5 text-[11.5px] font-medium",
                    cancelled ? "text-brand-muted" : payStyle?.color,
                  )}
                >
                  {cancelled ? "Cancelled" : (payStyle?.label ?? order.payment)}
                </span>
                <span
                  className={cn(
                    "w-[4.5rem] shrink-0 text-right text-[13.5px] font-semibold tabular-nums text-brand-ink",
                    cancelled && "font-normal text-brand-muted line-through",
                  )}
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
