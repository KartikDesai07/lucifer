"use client";

import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { KITCHEN_CATEGORY_OFF_HINT, KITCHEN_CATEGORY_SWITCH_LABEL } from "@/lib/kitchen-lines";
import {
  MENU_EDITOR_CARD_CLASS,
  MENU_EDITOR_HINT_CLASS,
  MENU_EDITOR_ROW_LABEL_CLASS,
  MENU_EDITOR_ROW_SUB_CLASS,
  MENU_EDITOR_ROW_TEXT_CLASS,
} from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";

interface CategoryKitchenTicketFieldProps {
  id: string;
  /** True when this category's items never go on a kitchen ticket (the stored `noKot`). */
  noKot: boolean;
  onChange: (noKot: boolean) => void;
}

// Skip-KOT (owner F1): the category's "Send to the kitchen (KOT)" switch, in the HTML's card (values 10: padding 12px 14px, a
// 1px --border, radius 12, the 13.5px 600 title over the 12px --text-3 sub, the 40x24 --accent switch). ON (the default, and
// every category that has no stored flag) = today's behaviour; OFF = its items stay off the KOT and the Kitchen screen. The
// whole card is the label, so a tap anywhere on it toggles (a 44px target at 400px). The HTML's sub is true for us; today's
// longer hint shows under the card only while off.
export function CategoryKitchenTicketField({ id, noKot, onChange }: CategoryKitchenTicketFieldProps) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        data-ui="category-kot-card"
        className={cn(MENU_EDITOR_CARD_CLASS, "min-h-11 cursor-pointer flex-row items-center gap-3 px-3.5 py-3")}
      >
        <span className={MENU_EDITOR_ROW_TEXT_CLASS}>
          <span className={MENU_EDITOR_ROW_LABEL_CLASS}>{KITCHEN_CATEGORY_SWITCH_LABEL}</span>
          <span className={MENU_EDITOR_ROW_SUB_CLASS}>Turn off for ready items like bottled drinks.</span>
        </span>
        <MenuSwitch
          id={id}
          tone="accent"
          checked={!noKot}
          onCheckedChange={(sendToKitchen) => onChange(!sendToKitchen)}
          aria-label={KITCHEN_CATEGORY_SWITCH_LABEL}
        />
      </label>
      {noKot && <p className={MENU_EDITOR_HINT_CLASS}>{KITCHEN_CATEGORY_OFF_HINT}</p>}
    </div>
  );
}
