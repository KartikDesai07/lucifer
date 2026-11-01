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
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  tone: "ok" | "accent";
  disabled?: boolean;
  "aria-label": string;
}) {
  return (
    <SwitchPrimitives.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(MENU_SWITCH_CLASS, MENU_SWITCH_ON_CLASS[tone])}
    >
      <SwitchPrimitives.Thumb className={MENU_SWITCH_KNOB_CLASS} />
    </SwitchPrimitives.Root>
  );
}
