"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ShoppingCart, type LucideIcon } from "lucide-react";

import { isActivePath } from "@/lib/nav-active";

// The top bar's two quick tabs (owner, 2026-10-11, PetPooja-style: "New Order" and "Tables" where the cafe name sat —
// the name stays at the top of the sidebar). Same targets as the sidebar's New Order and Floor rows, and the same
// active look (soft blue tint, ink label, blue icon), so the bar and the sidebar always agree on where you are.

export interface HeaderQuickTab {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Lights on this exact path only, like the sidebar's Floor row (not Tables → Setup / QR codes). */
  exact?: boolean;
}

export const HEADER_QUICK_TABS: readonly HeaderQuickTab[] = [
  { title: "New Order", url: "/pos", icon: ShoppingCart },
  { title: "Tables", url: "/tables", icon: LayoutGrid, exact: true },
];

// 36 px on a mouse, 44 px on touch. Below sm the icon hides and the padding / text / gap tighten (and the header
// drops its separator), so both labels fit a 360 px phone even inside the POS app with tokens on — three 44 px
// icon buttons beside them (s89f review). truncate is a last resort: the tabs never push the printer button off.
const TAB_CLASS =
  "inline-flex h-9 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-[13.5px] font-medium text-brand-ink/80 sm:px-2.5 sm:text-[14px] " +
  "transition-colors duration-150 hover:bg-brand-wash hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-brand-accent pointer-coarse:h-11 [&>svg]:hidden [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-brand-muted " +
  "sm:[&>svg]:block data-[active=true]:bg-brand-primary-soft data-[active=true]:font-semibold data-[active=true]:text-brand-ink " +
  "[&[data-active=true]>svg]:text-brand-primary";

export function HeaderQuickTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Quick links" className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1 [contain:inline-size]">
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
            className={TAB_CLASS}
          >
            <Icon aria-hidden />
            <span className="truncate">{tab.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
