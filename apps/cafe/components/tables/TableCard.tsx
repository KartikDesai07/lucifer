import {
  Check,
  Clock,
  IndianRupee,
  Pencil,
  TriangleAlert,
  Trash2,
  Utensils,
} from "lucide-react";

import { cn, inr } from "@/lib/utils";
import { tableChargeOf } from "@/lib/receipt";
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
  const charge = tableChargeOf(table);
  // Configured an amount but never named it — the POS and the order route both
  // treat that as no charge, so this table is silently free.
  const unnamedCharge = (table.chargeAmount ?? 0) > 0 && charge.amount === 0;

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

      {/* What this table adds to every bill. Shown under the cafe's own name for
          it, so the floor plan answers "why is this table dearer" at a glance. */}
      {charge.amount > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <IndianRupee className="h-3 w-3 shrink-0" />
          <span className="truncate" title={charge.label}>
            {charge.label}
          </span>
          <span className="ml-auto shrink-0 font-medium">{inr(charge.amount)}</span>
        </span>
      )}

      {/* An amount with no name is not chargeable (lib/receipt.tableChargeOf) —
          say so here rather than letting an admin believe a charge is live
          while every bill quietly comes out without it. */}
      {unnamedCharge && (
        <span className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Charge needs a name before it will apply</span>
        </span>
      )}

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
