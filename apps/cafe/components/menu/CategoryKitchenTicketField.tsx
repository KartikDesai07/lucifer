"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KITCHEN_CATEGORY_OFF_HINT, KITCHEN_CATEGORY_SWITCH_LABEL } from "@/lib/kitchen-lines";

interface CategoryKitchenTicketFieldProps {
  id: string;
  /** True when this category's items never go on a kitchen ticket (the stored `noKot`). */
  noKot: boolean;
  onChange: (noKot: boolean) => void;
}

// Skip-KOT (owner F1): the category's "Send to the kitchen (KOT)" switch. ON (the default, and every category
// that has no stored flag) = today's behaviour; OFF = its items stay off the KOT and the Kitchen screen. The
// whole row is the label, so a tap anywhere on it toggles (a 44px target at 400px). The hint shows only while off.
export function CategoryKitchenTicketField({ id, noKot, onChange }: CategoryKitchenTicketFieldProps) {
  return (
    <div className="space-y-1.5 pt-1">
      <Label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <span className="text-sm font-medium">{KITCHEN_CATEGORY_SWITCH_LABEL}</span>
        <Switch id={id} checked={!noKot} onCheckedChange={(sendToKitchen) => onChange(!sendToKitchen)} />
      </Label>
      {noKot && <p className="text-xs text-muted-foreground">{KITCHEN_CATEGORY_OFF_HINT}</p>}
    </div>
  );
}
