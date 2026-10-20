"use client";

// The staff nav's shared pieces (the owner's HTML, values 2.3; U0 Task 2): a row's inside (the active bar, the icon,
// the label), a flat row and a sub-page row (each lends its look and lit state to the Link inside it), and a row with
// sub-pages, which opens its sub-rows under it in the wide form and a flyout to its right in the rail (design 5.2).
// Which form shows is CSS (the `wide` variant); JS only needs it to decide what a tap on a row with sub-pages does.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";

import { NAV_WIDE_MIN_PX } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";
import {
  BRAND_NAV_BAR_CLASS,
  BRAND_NAV_FLYOUT_CLASS,
  BRAND_NAV_FLYOUT_ITEM_CLASS,
  BRAND_NAV_GROUP_ROW_CLASS,
  BRAND_NAV_ITEM_CLASS,
  BRAND_NAV_SUB_BAR_CLASS,
  BRAND_NAV_SUB_ITEM_CLASS,
  BRAND_NAV_TEXT_CLASS,
} from "@/components/brand/brand-classes";
import type { NavIcon } from "@/components/layout/nav-icons";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const WIDE_QUERY = `(min-width: ${NAV_WIDE_MIN_PX}px)`;

function subscribeWide(onChange: () => void): () => void {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Whether the nav shows its wide form now: at 1280 px and up unless collapsed.
 *  The server and the first client render say "rail" (no media query there); nothing visual reads this. */
export function useNavWide(collapsed: boolean): boolean {
  const xl = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);
  return !collapsed && xl;
}

/** A row's inside: the active bar, the 20px icon, and the label ("Bookings"-style rail label when it has one). */
export function NavRowContent({
  icon: Icon,
  title,
  railTitle,
  children,
}: {
  icon: NavIcon;
  title: string;
  railTitle?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <span aria-hidden="true" data-ui="nav-bar" className={BRAND_NAV_BAR_CLASS} />
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-5 flex-none" />
      <span className={BRAND_NAV_TEXT_CLASS}>
        {railTitle ? (
          <>
            <span className="wide:hidden">{railTitle}</span>
            <span className="hidden wide:inline">{title}</span>
          </>
        ) : (
          title
        )}
      </span>
      {children}
    </>
  );
}

/** A flat row: lends the row look and its lit state (data-active) to the Link inside it. */
export function NavItem({ isActive, children }: { isActive: boolean; children: ReactNode }) {
  return (
    <li className="relative">
      <Slot data-ui="nav-item" data-active={isActive} className={BRAND_NAV_ITEM_CLASS}>
        {children}
      </Slot>
    </li>
  );
}

export type NavSubPlace = "rows" | "fly";

/** A sub-page row: under its parent in the wide form ("rows"), or in the rail's flyout ("fly"). */
export function NavSubItem({ place, isActive, children }: { place: NavSubPlace; isActive: boolean; children: ReactNode }) {
  return (
    <li className="relative">
      <Slot data-active={isActive} className={place === "rows" ? BRAND_NAV_SUB_ITEM_CLASS : BRAND_NAV_FLYOUT_ITEM_CLASS}>
        {children}
      </Slot>
      {place === "rows" && <span aria-hidden="true" className={BRAND_NAV_SUB_BAR_CLASS} />}
    </li>
  );
}

interface NavGroupRowProps {
  title: string;
  icon: NavIcon;
  /** The row is lit: the current page is one of its pages. In the wide form, while the sub-rows are open, the lit
   *  sub-row shows instead (unless the row's own page is current, like the Settings hub: aria-current). */
  isActive: boolean;
  "aria-current"?: "page";
  /** The nav's current form (useNavWide): the wide form expands the sub-rows, the rail opens the flyout. */
  wide: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the sub-page rows, for either place. */
  subRows: (place: NavSubPlace) => ReactNode;
}

/** A row with sub-pages (Menu, Tables, Reports, Settings). The row is a button, never a Link: a tap opens the
 *  sub-rows (wide) or the flyout (rail). */
export function NavGroupRow({
  title,
  icon,
  isActive,
  "aria-current": ariaCurrent,
  wide,
  open,
  onOpenChange,
  subRows,
}: NavGroupRowProps) {
  const [flyOpen, setFlyOpen] = useState(false);
  // The flyout belongs to the rail: a nav that turns wide (a wider window, Expand) closes it.
  useEffect(() => {
    if (wide) setFlyOpen(false);
  }, [wide]);

  // One row: in the wide form a plain disclosure for the sub-rows under it; in the rail the flyout's trigger (the
  // Popover trigger adds aria-haspopup and its own aria-expanded there only). The server and the first client render
  // know no form, so they render the rail's; the visuals are CSS either way.
  const row = (
    <button
      type="button"
      title={title}
      data-ui="nav-item"
      data-active={isActive}
      data-sub-current={isActive && ariaCurrent !== "page"}
      aria-current={ariaCurrent}
      aria-expanded={wide ? open : flyOpen}
      className={BRAND_NAV_GROUP_ROW_CLASS}
      onClick={wide ? () => onOpenChange(!open) : undefined}
    >
      <NavRowContent icon={icon} title={title}>
        <ChevronRight
          aria-hidden="true"
          className="hidden size-4 flex-none text-nav-t2 transition-transform duration-200 wide:block group-data-[state=open]/collapsible:rotate-90"
        />
      </NavRowContent>
    </button>
  );

  return (
    <li className="relative">
      <Collapsible open={open} onOpenChange={onOpenChange} className="group/collapsible">
        <Popover open={flyOpen} onOpenChange={setFlyOpen}>
          {wide ? row : <PopoverTrigger asChild>{row}</PopoverTrigger>}
          <PopoverContent
            side="right"
            align="start"
            sideOffset={16}
            className={BRAND_NAV_FLYOUT_CLASS}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setFlyOpen(false);
            }}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold text-muted-foreground">{title}</p>
            <ul className="flex flex-col">{subRows("fly")}</ul>
          </PopoverContent>
        </Popover>
        <CollapsibleContent
          className={cn(
            "-ml-2.5 hidden overflow-hidden pl-2.5 wide:block",
            "motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down",
          )}
        >
          <ul className="mt-0.5 flex flex-col gap-0.5">{subRows("rows")}</ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
