"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActivePath } from "@/lib/nav-active";
import { isOrdersPath } from "@/lib/orders-layout";
import { isPosPath } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { GlyphPlus, NavFloor, type NavIcon } from "@/components/layout/nav-icons";
import { HEADER_OUTLINE_BUTTON_CLASS, HEADER_PRIMARY_BUTTON_CLASS } from "@/components/layout/header-classes";

// The header's two quick links (owner, 2026-10-11): the Floor and a new order, the same targets as the sidebar's
// Floor and Order rows. U0 Task 3 (values 2.5, design 5.3) draws them as the HTML's header buttons, after the page's
// own actions: Tables (outline, the floor grid; hidden on a phone, where the tab bar has Floor) and New order (the
// HTML's primary button and word; its plus only on a phone, except on /orders: U2 Task 1, the Orders values 1.2 and
// design 6.1, the HTML's Orders header keeps the label at every width). The current page is marked for screen readers
// as in the sidebar; the HTML's header buttons have no lit look. Not on /pos (U1 Task 1, design 6.1): the HTML's Order
// header has no place for them; the Floor is in the nav and behind the cart's table cell, and a new order starts from
// the cart.

export interface HeaderQuickTab {
  title: string;
  url: string;
  icon: NavIcon;
  /** Marks this exact path only, like the sidebar's Floor row (not Tables → Setup / QR codes). */
  exact?: boolean;
  /** The accent button (New order); the other is outline. */
  primary?: boolean;
}

export const HEADER_QUICK_TABS: readonly HeaderQuickTab[] = [
  { title: "Tables", url: "/tables", icon: NavFloor, exact: true },
  { title: "New order", url: "/pos", icon: GlyphPlus, primary: true },
];

export function HeaderQuickTabs() {
  const pathname = usePathname() ?? "";
  if (isPosPath(pathname)) return null;
  const labelClass = isOrdersPath(pathname) ? "inline" : "hidden tab:inline";
  return (
    <>
      {HEADER_QUICK_TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.url : isActivePath(pathname, tab.url);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.url}
            href={tab.url}
            // Never on its own: /pos and /tables are warmed by useWarmRoutes only once the line answers (lib/warm-routes.ts).
            prefetch={false}
            data-active={active}
            aria-current={active ? "page" : undefined}
            aria-label={tab.title}
            data-ui={tab.primary ? "header-new-order" : "header-tables"}
            className={cn(
              buttonVariants({ variant: tab.primary ? "default" : "outline" }),
              tab.primary ? HEADER_PRIMARY_BUTTON_CLASS : HEADER_OUTLINE_BUTTON_CLASS,
              tab.primary ? "inline-flex" : "hidden tab:inline-flex",
            )}
          >
            <Icon aria-hidden="true" strokeWidth={tab.primary ? 2.4 : 1.8} />
            <span className={labelClass}>{tab.title}</span>
          </Link>
        );
      })}
    </>
  );
}
