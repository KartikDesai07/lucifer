"use client";

import { Utensils } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import { DashCard } from "@/components/dashboard/DashCard";
import type { Order, Table } from "@/types";

interface LiveFloorPanelProps {
  tables: Table[];
  orders: Order[]; // today's orders + open tabs — to open an occupied table's order
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onSelectOrder: (order: Order) => void;
}

// Status colours are the product's table vocabulary (unchanged).
const STATUS_STYLES: Record<TableStatus, { dot: string; ring: string }> = {
  Available: { dot: "bg-green-500", ring: "border-green-200" },
  Occupied: { dot: "bg-red-500", ring: "border-red-200" },
  Reserved: { dot: "bg-amber-500", ring: "border-amber-200" },
};
const TILE_MIN_PX = 84;
const TILE_PX = 64;
const MIN_TILE_ROWS = 2;
const TILE_GAP_PX = 8;

// "ORD-20260623-007" -> "#007" for a compact tile label (full id in the title).
function shortOrderId(orderId: string): string {
  return `#${orderId.split("-").pop() ?? orderId}`;
}

// Compact, live floor overview for the dashboard. Read-only status with one
// affordance: clicking an occupied table opens its order in the shared detail
// sheet (the page owns the sheet). Status changes live on the Tables page.
// Tiles auto-fill the card's width, so the same panel works as a third of a
// desktop row and as a full-width phone card.
export function LiveFloorPanel({ tables, orders, loading, isError, onRetry, onSelectOrder }: LiveFloorPanelProps) {
  const occupied = tables.filter((t) => t.status === "Occupied").length;
  const ordersById = new Map(orders.map((o) => [o.orderId, o]));
  const status = loading ? "loading" : isError && tables.length === 0 ? "error" : tables.length === 0 ? "empty" : "ready";

  return (
    <DashCard
      title="Live tables"
      period={tables.length > 0 ? `${occupied} of ${tables.length} occupied · right now` : "Right now"}
      link={{ href: "/tables", label: "Manage" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No tables set up", description: "Add tables on the Tables screen to see who is seated here." }}
      bodyMinHeight={MIN_TILE_ROWS * TILE_PX + TILE_GAP_PX}
    >
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN_PX}px, 1fr))` }}>
        {tables.map((table) => {
          const style = STATUS_STYLES[table.status];
          const order =
            table.status === "Occupied" && table.currentOrderId ? ordersById.get(table.currentOrderId) : undefined;

          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-semibold text-brand-ink">{table.tableNo}</span>
                <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} aria-hidden />
              </div>
              <div className="mt-1 truncate text-[12px] text-brand-muted">
                {table.status === "Occupied" && table.currentOrderId ? (
                  <span className="flex items-center gap-1">
                    <Utensils className="h-3 w-3 shrink-0" aria-hidden />
                    {shortOrderId(table.currentOrderId)}
                  </span>
                ) : (
                  <span>{table.capacity} seats</span>
                )}
              </div>
              {table.status !== "Occupied" && (
                <div className="truncate text-[12px] font-medium text-brand-muted">{table.status}</div>
              )}
            </>
          );

          const className = cn(
            "flex flex-col justify-center rounded-lg border bg-brand-slip px-2.5 py-2 text-left",
            style.ring,
          );

          // Clickable only when we can resolve the order to open the sheet.
          return order ? (
            <button
              key={table._id}
              type="button"
              onClick={() => onSelectOrder(order)}
              title={`View ${order.orderId}`}
              style={{ minHeight: TILE_PX }}
              className={cn(
                className,
                "transition-colors hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
              )}
            >
              {body}
            </button>
          ) : (
            <div
              key={table._id}
              style={{ minHeight: TILE_PX }}
              className={className}
              title={table.currentOrderId ? table.currentOrderId : `${table.tableNo} · ${table.status}`}
            >
              {body}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}
