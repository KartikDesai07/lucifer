"use client";

import { cn } from "@/lib/utils";
import { MENU_CHECK_CLASS, MENU_CHECK_OFF_CLASS, MENU_CHECK_ON_CLASS } from "@/lib/menu-list-layout";

/** The HTML's 18px check (values 5.1, 5.2): a button with a white tick, "✓" ticked and "–" for a partial select-all; an
 *  empty box shows nothing. A checkbox to assistive tech (aria-checked, "mixed" for a partial). */
export function MenuCheck({
  state,
  label,
  onToggle,
  stopClick,
}: {
  state: "off" | "on" | "some";
  label: string;
  onToggle: () => void;
  /** A card's box: its tap must not also reach the card (which toggles the same selection). */
  stopClick?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "some" ? "mixed" : state === "on"}
      aria-label={label}
      title={label}
      onClick={(e) => {
        if (stopClick) e.stopPropagation();
        onToggle();
      }}
      className={cn(MENU_CHECK_CLASS, state === "off" ? MENU_CHECK_OFF_CLASS : MENU_CHECK_ON_CLASS)}
    >
      {state === "on" ? "✓" : state === "some" ? "–" : ""}
    </button>
  );
}
