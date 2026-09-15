import { ChefHat, Check, Pencil, Trash2, X } from "lucide-react";

import type { ReservationStatus } from "@/lib/constants";
import { formatDate, formatTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Reservation } from "@/types";

const STATUS_VARIANTS: Record<ReservationStatus, string> = {
  Booked: "border-blue-300 text-blue-700",
  Seated: "border-green-300 text-green-700",
  Completed: "border-gray-300 text-gray-600",
  Cancelled: "border-red-300 text-red-700",
};

interface ReservationRowCardProps {
  reservation: Reservation;
  busy: boolean;
  onSeat: (r: Reservation) => void;
  onComplete: (r: Reservation) => void;
  onCancel: (r: Reservation) => void;
  onEdit: (r: Reservation) => void;
  onDelete: (r: Reservation) => void;
}

/** Card layout for one reservation row — mirrors the table row exactly (same handlers, same conditions). */
export function ReservationRowCard({
  reservation: r,
  busy,
  onSeat,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
}: ReservationRowCardProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{formatDate(r.date)}</div>
          <div className="text-xs text-muted-foreground">{formatTime(r.time)}</div>
        </div>
        <Badge variant="outline" className={cn(STATUS_VARIANTS[r.status])}>
          {r.status}
        </Badge>
      </div>

      <div className="mt-2">
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-muted-foreground">{r.mobile}</div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
        <span>Guests {r.guests}</span>
        <span>Table {r.tableNo ?? "—"}</span>
      </div>

      <div className="mt-2 flex justify-end gap-1">
        {r.status === "Booked" && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onSeat(r)}
            aria-label="Seat guest"
            title="Seat"
          >
            <ChefHat className="h-4 w-4" />
          </Button>
        )}
        {r.status === "Seated" && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onComplete(r)}
            aria-label="Complete reservation"
            title="Complete"
          >
            <Check className="h-4 w-4 text-green-600" />
          </Button>
        )}
        {(r.status === "Booked" || r.status === "Seated") && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onCancel(r)}
            aria-label="Cancel reservation"
            title="Cancel"
          >
            <X className="h-4 w-4 text-destructive" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(r)}
          aria-label="Edit reservation"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(r)}
          aria-label="Delete reservation"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
