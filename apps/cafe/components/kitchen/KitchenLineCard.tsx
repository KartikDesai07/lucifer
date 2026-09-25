"use client";

import { AlertTriangle, Clock, QrCode } from "lucide-react";

import { kitchenAgeBand, type KitchenRow } from "@/lib/kitchen-board";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// P4-A — one row of the kitchen board. Every status channel (self-order,
// age) pairs an icon + a colour + literal text, never colour alone (cafe.md
// UI rule); no emoji anywhere, lucide only.
const AGE_ICON = {
  none: null,
  Clock,
  AlertTriangle,
} as const;

interface KitchenLineCardProps {
  row: KitchenRow;
  now: Date;
  onToggle: (row: KitchenRow, done: boolean) => void;
  pending: boolean;
}

export function KitchenLineCard({ row, now, onToggle, pending }: KitchenLineCardProps) {
  const band = kitchenAgeBand(row.firedAt, now);
  const AgeIcon = AGE_ICON[band.icon];
  // `row.firedAt` is an ISO string off the wire — parsed at the use site.
  const ageMinutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(row.firedAt).getTime()) / 60_000),
  );
  const ageText = `${row.firedAtApprox ? "~" : ""}${ageMinutes}m`;

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div className="grid min-h-11 min-w-11 shrink-0 place-items-center">
        <Checkbox
          checked={false}
          disabled={pending}
          onCheckedChange={(checked) => onToggle(row, checked === true)}
          aria-label={`Mark ${row.name} done`}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-bold">
          {row.qty} × {row.name}
          {row.variation ? ` (${row.variation})` : ""}
        </div>

        {row.modifiers.length > 0 && (
          <div className="text-sm text-muted-foreground">+ {row.modifiers.join(", ")}</div>
        )}

        {row.instructions && (
          <div className="text-sm font-semibold italic">{row.instructions}</div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Round {row.round}</span>
          {/* The order number always shows: ticket numbering is optional per
              cafe, so `#{ticketNumber}` alone can leave a row with no way
              back to the paper slip the kitchen is holding. */}
          <span>{row.orderNo}</span>
          {row.ticketNumber !== undefined && <span>#{row.ticketNumber}</span>}
          <span>{row.tableLabel}</span>

          {row.selfOrder && (
            <span className="flex items-center gap-1 text-blue-600">
              <QrCode className="h-3.5 w-3.5" />
              Self-order
            </span>
          )}

          <span
            className={cn(
              "flex items-center gap-1",
              band.key === "late" && "font-semibold text-red-600",
              band.key === "warn" && "text-amber-600",
            )}
            title={row.firedAtApprox ? "approximate — fired before age tracking" : undefined}
          >
            {AgeIcon && <AgeIcon className="h-3.5 w-3.5" />}
            {ageText}
            {band.key === "late" && " Late"}
          </span>
        </div>
      </div>
    </div>
  );
}
