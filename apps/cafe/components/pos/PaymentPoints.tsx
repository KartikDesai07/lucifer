"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SettlePointsView } from "@/hooks/use-settle-points";
import { inr } from "@/lib/utils";

// CB-7 S6 (§2.7, owner O3) — the payment popup's one points row: ONE switch that uses ALL the customer's usable points,
// up to the food total. No typed amount. The bill then reads "Reward" (owner O1). When it cannot be used, one plain line
// says why. The row is at least 44px tall so it is an easy tap.
const POINTS_SWITCH_ID = "use-points";
const POINTS_REASON_ID = "use-points-reason";

interface PaymentPointsProps {
  points: SettlePointsView;
  // The popup is in flight or frozen on an unconfirmed send: nothing may change.
  disabled: boolean;
}

export function PaymentPoints({ points, disabled }: PaymentPointsProps) {
  const { row, on, onToggle } = points;
  return (
    <div className="rounded-lg border px-3 text-sm">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor={POINTS_SWITCH_ID} className="flex min-h-11 flex-1 cursor-pointer items-center font-medium">
          {row.amount > 0 ? `Use ${row.amount} points (−${inr(row.amount)})` : "Use points"}
        </Label>
        <Switch
          id={POINTS_SWITCH_ID}
          checked={on}
          disabled={disabled || !row.usable}
          onCheckedChange={onToggle}
          aria-describedby={row.reason ? POINTS_REASON_ID : undefined}
        />
      </div>
      {row.reason && (
        <p id={POINTS_REASON_ID} className="pb-2 text-xs text-muted-foreground">
          {row.reason}
        </p>
      )}
    </div>
  );
}
