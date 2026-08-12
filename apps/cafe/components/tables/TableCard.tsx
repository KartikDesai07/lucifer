import { Check, Clock, Pencil, Trash2, Utensils } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import type { Table } from "@/types";

const STATUS_STYLES: Record<
  TableStatus,
  { dot: string; ring: string; label: string }
> = {
  Available: { dot: "bg-green-500", ring: "border-green-200", label: "Available" },
  Occupied: { dot: "bg-red-500", ring: "border-red-200", label: "Occupied" },
  Reserved: { dot: "bg-amber-500", ring: "border-amber-200", label: "Reserved" },
};

interface TableCardProps {
  table: Table;
  isAdmin: boolean;
  statusPending: boolean;
  onSetStatus: (table: Table, status: TableStatus) => void;
  onEdit: (table: Table) => void;
  onDelete: (table: Table) => void;
}

// One table's live status card on the overview grid, plus (admin-only) the
// rename/re-seat/remove config controls layered on top of the same tile.
export function TableCard({
  table,
  isAdmin,
  statusPending,
  onSetStatus,
  onEdit,
  onDelete,
}: TableCardProps) {
  const style = STATUS_STYLES[table.status];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border-2 bg-card p-4",
        style.ring,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-lg font-bold">{table.tableNo}</span>
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
            disabled={statusPending}
            onClick={() => onSetStatus(table, "Available")}
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Free
          </Button>
        )}
        {table.status === "Available" && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={statusPending}
            onClick={() => onSetStatus(table, "Reserved")}
          >
            <Clock className="mr-1 h-3.5 w-3.5" /> Reserve
          </Button>
        )}
        {table.status === "Reserved" && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            disabled={statusPending}
            onClick={() => onSetStatus(table, "Occupied")}
          >
            Seat
          </Button>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-1.5 border-t pt-2">
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={() => onEdit(table)}
            aria-label="Edit table"
          >
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={() => onDelete(table)}
            aria-label="Delete table"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" /> Delete
          </Button>
        </div>
      )}
    </div>
  );
}
