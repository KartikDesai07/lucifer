"use client";

import { CircleUser, ClipboardList, House, Stamp, UtensilsCrossed } from "lucide-react";

import { cn } from "@/lib/utils";
import { TAB_BAR_CLASS, TAB_BAR_HEIGHT_CLASS } from "@/components/public/public-shell-layout";

// CB-4/S6 — the diner shell's bottom tab bar. 3-5 destinations is the
// researched norm for thumb-reachable tab bars (Material/HIG guidance;
// Airbnb measured ~40% faster task completion vs a hamburger), so five is
// the ceiling here, not a mid-point — a sixth would start pushing targets
// out of thumb reach on the cheap Android phones this surface is actually
// used on.
//
// lucide icons, never emoji (this repo's UI rule) — emoji render differently
// on every Android skin and cannot be themed.

export const DINER_TABS = ["home", "menu", "orders", "rewards", "account"] as const;
export type DinerTab = (typeof DINER_TABS)[number];

// EXHAUSTIVE by construction (a Record keyed on the union, not a switch with a
// default) so a fourth tab fails tsc here rather than silently rendering
// unlabelled. Exported (read-only intent) so the S6 pin can runtime-check
// every DINER_TABS entry has a non-empty label and a defined Icon, as a
// complement to the compile-time exhaustiveness this Record already gives.
export const TAB_META: Record<DinerTab, { label: string; Icon: typeof UtensilsCrossed }> = {
  home: { label: "Home", Icon: House },
  menu: { label: "Menu", Icon: UtensilsCrossed },
  orders: { label: "Orders", Icon: ClipboardList },
  rewards: { label: "Rewards", Icon: Stamp },
  account: { label: "Account", Icon: CircleUser },
};

interface PublicTabBarProps {
  active: DinerTab;
  onSelect: (tab: DinerTab) => void;
  // Hidden entirely when the cafe runs neither diner accounts nor loyalty —
  // a one-tab "tab bar" is just clutter on a small screen.
  tabs?: readonly DinerTab[];
  // Items currently in the cart. Badged on the MENU tab so a diner who walks
  // away to Orders/Home/Account can still see one is waiting — the "View
  // cart" bar itself only exists inside the Menu tab.
  cartCount?: number;
}

export function PublicTabBar({ active, onSelect, tabs = DINER_TABS, cartCount = 0 }: PublicTabBarProps) {
  if (tabs.length < 2) return null;
  return (
    // Positioning/safe-area come from TAB_BAR_CLASS — the ONE place the
    // bottom-chrome stack is defined, so this bar and the cart bar that floats
    // above it can never drift back into the same slot (see that file's header
    // for the blocker this prevents). The translucent/blur polish is layered
    // on TOP of it here, never inlined into public-shell-layout.ts itself.
    <nav aria-label="Diner sections" className={cn(TAB_BAR_CLASS, "bg-background/95 backdrop-blur")}>
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((tab) => {
          const { label, Icon } = TAB_META[tab];
          const isActive = tab === active;
          return (
            <li key={tab} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(tab)}
                aria-current={isActive ? "page" : undefined}
                // min-h-14: a real thumb target, not a text-sized one.
                className={cn(
                  "relative flex w-full flex-col items-center justify-center gap-0.5 text-xs",
                  // The thumb target height, from the SAME constant the
                  // content offsets are derived from.
                  TAB_BAR_HEIGHT_CLASS,
                  // NEVER colour alone (review 2026-09-13): a cafe's accent is
                  // owner-configurable and can sit close to the muted tone, so
                  // on a cheap phone in sunlight a colour-only active state is
                  // unreadable. Weight + the indicator bar below carry it too.
                  isActive ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                {/* The active indicator — a second, non-colour signal. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary"
                  />
                )}
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {/* The cart lives inside the MENU tab, and leaving that tab
                      hides its "View cart" bar entirely — so a half-built cart
                      used to become invisible from the other four tabs, with
                      nothing to bring the diner back (review 2026-09-13). This
                      badge is that signal. Count comes from the same
                      localStorage the cart hydrates from, so the shell never
                      has to reach into PublicOrderFlow's state. */}
                  {tab === "menu" && cartCount > 0 && (
                    <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                      {cartCount > 9 ? "9+" : cartCount}
                    </span>
                  )}
                </span>
                {/* truncate: five labels share the width, and a diner's chosen
                    font can be wider than the system one — a long label must
                    clip inside its own cell, never push the row. */}
                <span className="max-w-full truncate px-0.5">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
