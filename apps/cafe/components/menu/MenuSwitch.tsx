"use client";

import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";
import { MENU_SWITCH_CLASS, MENU_SWITCH_KNOB_CLASS, MENU_SWITCH_ON_CLASS } from "@/lib/menu-list-layout";

/** The kit Switch (Radix: role=switch, keyboard, disabled) in the HTML's 40x24 look (values 7.2): the stock switch is --ok
 *  when on, the QR switch --accent; off --surface-3; a white 18px knob. */
export function MenuSwitch({
  checked,
  onCheckedChange,
  tone,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  tone: "ok" | "accent";
  disabled?: boolean;
  /** For a <label htmlFor> that wraps the row (the category editor's KOT card). */
  id?: string;
  "aria-label": string;
  /** The id of the row's line under the label (the settings No limit row). */
  "aria-describedby"?: string;
}) {
  return (
    <SwitchPrimitives.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(MENU_SWITCH_CLASS, MENU_SWITCH_ON_CLASS[tone])}
    >
      <SwitchPrimitives.Thumb className={MENU_SWITCH_KNOB_CLASS} />
    </SwitchPrimitives.Root>
  );
}
