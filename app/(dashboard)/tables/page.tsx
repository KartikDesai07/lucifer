"use client";

import { Loader2, Check, Clock, Utensils } from "lucide-react";

import { useTables, useUpdateTable } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Table } from "@/types";

const STATUS_STYLES: Record<
  TableStatus,
  { dot: string; ring: string; label: string }
> = {
  Available: { dot: "bg-green-500", ring: "border-green-200", label: "Available" },
  Occupied: { dot: "bg-red-500", ring: "border-red-200", label: "Occupied" },
  Reserved: { dot: "bg-amber-500", ring: "border-amber-200", label: "Reserved" },
};

export default function TablesPage() {
  const tables = useTables();
  const updateTable = useUpdateTable();

  const setStatus = (table: Table, status: TableStatus) =>
    updateTable.mutate({ tableNo: table.tableNo, data: { status } });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Tables</h2>
        <p className="text-sm text-muted-foreground">
          Live table status. Updates automatically every 30 seconds.
        </p>
      </div>

      {tables.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : tables.isError ? (
        <p className="text-sm text-destructive">
          Failed to load tables. Refresh to retry.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(tables.data ?? []).map((table) => {
            const style = STATUS_STYLES[table.status];
            return (
              <div
                key={table._id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border-2 bg-card p-4",
                  style.ring,
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{table.tableNo}</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
                    {style.label}
                  </span>
                </div>

                <div className="min-h-[2.5rem] text-sm text-muted-foreground">
                  {table.status === "Occupied" && table.currentOrderId ? (
                    <span className="flex items-center gap-1.5">
                      <Utensils className="h-3.5 w-3.5" />
                      {table.currentOrderId}
                    </span>
                  ) : (
                    <span>Seats {table.capacity}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {table.status !== "Available" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={updateTable.isPending}
                      onClick={() => setStatus(table, "Available")}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Free
                    </Button>
                  )}
                  {table.status === "Available" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={updateTable.isPending}
                      onClick={() => setStatus(table, "Reserved")}
                    >
                      <Clock className="mr-1 h-3.5 w-3.5" /> Reserve
                    </Button>
                  )}
                  {table.status === "Reserved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      disabled={updateTable.isPending}
                      onClick={() => setStatus(table, "Occupied")}
                    >
                      Seat
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {updateTable.isPending && (
            <span className="sr-only">
              <Loader2 className="animate-spin" /> Updating
            </span>
          )}
        </div>
      )}
    </div>
  );
}
