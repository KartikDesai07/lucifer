"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SettlePointsView } from "@/hooks/use-settle-points";
import { POINTS_ASKED_HINT } from "@/lib/settle-points-view";
import { inr } from "@/lib/utils";

// CB-7 S6 (§2.7, owner O3) — the payment popup's one points row: ONE switch that uses ALL the customer's usable points,
// up to the food total. No typed amount. The bill then reads "Reward" (owner O1). When it cannot be used, one plain line
// says why. The row is at least 44px tall so it is an easy tap.
const POINTS_SWITCH_ID = "use-points";
const POINTS_REASON_ID = "use-points-reason";
// Session 2 (owner O2): the QR diner asked for points, so the switch started ON — this line says why.
const POINTS_ASKED_ID = "use-points-asked";

interface PaymentPointsProps {
  points: SettlePointsView;
  // The popup is in flight or frozen on an unconfirmed send: nothing may change.
  disabled: boolean;
}

export function PaymentPoints({ points, disabled }: PaymentPointsProps) {
  const { row, on, asked, onToggle } = points;
  const describedBy = [asked ? POINTS_ASKED_ID : null, row.reason ? POINTS_REASON_ID : null].filter(Boolean).join(" ");
  // U1 Task 9 (design 6.11): the payment sheet's box (the HTML's 1px --border, radius 10, 0 12px), 13.5px; the lines under
  // the switch 12px (the ask in --accent-i, a reason in --text-2). Our own control: the 44px row stays.
  return (
    <div data-ui="pay-points" className="rounded-[10px] border border-border px-3 text-[13.5px]">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor={POINTS_SWITCH_ID} className="flex min-h-11 flex-1 cursor-pointer items-center text-[13.5px] font-medium text-foreground">
          {row.amount > 0 ? `Use ${row.amount} points (−${inr(row.amount)})` : "Use points"}
        </Label>
        <Switch
          id={POINTS_SWITCH_ID}
          checked={on}
          disabled={disabled || !row.usable}
          onCheckedChange={onToggle}
          aria-describedby={describedBy || undefined}
        />
      </div>
      {asked && (
        <p id={POINTS_ASKED_ID} className="pb-2.5 text-[12px] font-medium text-accent-foreground">
          {POINTS_ASKED_HINT}
        </p>
      )}
      {row.reason && (
        <p id={POINTS_REASON_ID} className="pb-2.5 text-[12px] text-muted-foreground">
          {row.reason}
        </p>
      )}
    </div>
  );
}
