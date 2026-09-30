import { Check, Pencil, Trash2, Wallet, X } from "lucide-react";

import type { EventStatus } from "@/lib/constants";
import { formatDate, formatTime, inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BRAND_PANEL_CLASS, BRAND_ROW_ACTION_CLASS } from "@/components/brand/brand-classes";
import type { Event } from "@/types";

export const STATUS_VARIANTS: Record<EventStatus, string> = {
  Booked: "border-blue-300 text-blue-700",
  Completed: "border-green-300 text-green-700",
  Cancelled: "border-red-300 text-red-700",
};

interface EventRowCardProps {
  event: Event;
  busy: boolean;
  onReceiveBalance: (e: Event) => void;
  onComplete: (e: Event) => void;
  onCancel: (e: Event) => void;
  onEdit: (e: Event) => void;
  onDelete: (e: Event) => void;
}

/** Card layout for one event row — mirrors the table row exactly (same handlers, same conditions). */
export function EventRowCard({
  event: e,
  busy,
  onReceiveBalance,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
}: EventRowCardProps) {
  const balance = Math.max(0, e.payable - e.advance);

  return (
    <div className={cn("rounded-lg border p-3", BRAND_PANEL_CLASS)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium">{e.eventName}</div>
        <Badge variant="outline" className={cn(STATUS_VARIANTS[e.status])}>
          {e.status}
        </Badge>
      </div>

      <div className="mt-1 text-sm text-muted-foreground">
        {formatDate(e.date)} · {formatTime(e.time)}
      </div>

      <div className="mt-2">
        <div>{e.name}</div>
        <div className="text-xs text-muted-foreground">{e.mobile}</div>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span>Total {inr(e.payable)}</span>
        {balance > 0 ? (
          <Badge variant="destructive">Due {inr(balance)}</Badge>
        ) : (
          <span className="text-green-700">Paid</span>
        )}
      </div>

      <div className="mt-2 flex justify-end gap-1">
        {balance > 0 && e.status === "Booked" && (
          <Button
            variant="ghost"
            size="icon"
            className={BRAND_ROW_ACTION_CLASS}
            disabled={busy}
            onClick={() => onReceiveBalance(e)}
            aria-label="Receive balance"
            title="Receive balance"
          >
            <Wallet className="h-4 w-4 text-green-600" />
          </Button>
        )}
        {e.status === "Booked" && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={BRAND_ROW_ACTION_CLASS}
              disabled={busy}
              onClick={() => onComplete(e)}
              aria-label="Complete event"
              title="Complete"
            >
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={BRAND_ROW_ACTION_CLASS}
              disabled={busy}
              onClick={() => onCancel(e)}
              aria-label="Cancel event"
              title="Cancel"
            >
              <X className="h-4 w-4 text-destructive" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={BRAND_ROW_ACTION_CLASS}
          onClick={() => onEdit(e)}
          aria-label="Edit event"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={BRAND_ROW_ACTION_CLASS}
          onClick={() => onDelete(e)}
          aria-label="Delete event"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
