"use client";

import Link from "next/link";
import { ArrowRight, Utensils } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Order, Table } from "@/types";

interface LiveFloorPanelProps {
  tables: Table[];
  orders: Order[]; // today's orders — used to open an occupied table's order
  loading?: boolean;
  isError?: boolean;
  onSelectOrder: (order: Order) => void;
}

const STATUS_STYLES: Record<TableStatus, { dot: string; ring: string }> = {
  Available: { dot: "bg-green-500", ring: "border-green-200" },
  Occupied: { dot: "bg-red-500", ring: "border-red-200" },
  Reserved: { dot: "bg-amber-500", ring: "border-amber-200" },
};

// "ORD-20260623-007" -> "#007" for a compact tile label (full id in the title).
function shortOrderId(orderId: string): string {
  return `#${orderId.split("-").pop() ?? orderId}`;
}

// Compact, live floor overview for the dashboard. Read-only status with one
// affordance: clicking an occupied table opens its order in the shared detail
// sheet (the page owns the sheet). Status changes live on the Tables page.
export function LiveFloorPanel({
  tables,
  orders,
  loading,
  isError,
  onSelectOrder,
}: LiveFloorPanelProps) {
  const occupied = tables.filter((t) => t.status === "Occupied").length;
  const ordersById = new Map(orders.map((o) => [o.orderId, o]));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Live floor</CardTitle>
          {!loading && !isError && tables.length > 0 && (
            <span className="text-xs font-medium text-muted-foreground">
              {occupied}/{tables.length} occupied
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/tables">
            Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Failed to load tables. It will retry automatically.
          </p>
        ) : tables.length === 0 ? (
          <EmptyState
            title="No tables configured"
            description="Add tables to see live floor status here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {tables.map((table) => {
              const style = STATUS_STYLES[table.status];
              const order =
                table.status === "Occupied" && table.currentOrderId
                  ? ordersById.get(table.currentOrderId)
                  : undefined;

              const body = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{table.tableNo}</span>
                    <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {table.status === "Occupied" && table.currentOrderId ? (
                      <span className="flex items-center gap-1">
                        <Utensils className="h-3 w-3 shrink-0" />
                        {shortOrderId(table.currentOrderId)}
                      </span>
                    ) : (
                      <span>Seats {table.capacity}</span>
                    )}
                  </div>
                </>
              );

              const className = cn(
                "flex flex-col rounded-lg border bg-card p-2.5 text-left",
                style.ring,
              );

              // Clickable only when we can resolve the order to open the sheet.
              return order ? (
                <button
                  key={table._id}
                  type="button"
                  onClick={() => onSelectOrder(order)}
                  title={`View ${order.orderId}`}
                  className={cn(
                    className,
                    "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {body}
                </button>
              ) : (
                <div
                  key={table._id}
                  className={className}
                  title={
                    table.currentOrderId
                      ? table.currentOrderId
                      : `${table.tableNo} · ${table.status}`
                  }
                >
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
