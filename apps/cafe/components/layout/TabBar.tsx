"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { StaffRole } from "@pos/shared/constants";

import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { isActivePath } from "@/lib/nav-active";
import { printConfigOf } from "@/lib/print";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { NAV_SECTIONS, navSubPages, visibleNavSections, type NavItemDef } from "@/components/layout/AppSidebar";
import { GlyphMore } from "@/components/layout/nav-icons";
import { ProfileSheet, isMoreItemActive, type MoreItem } from "@/components/layout/ProfileSheet";

// The phone's nav (the owner's HTML, values 2.6; design 5.4; U0 Task 4): below 720px a glass bar fixed at the foot,
// Home, Floor, Order, Orders and More for both roles (each is open to both), and the More sheet (the profile sheet
// with the grid of every other page this person may open). Everything comes from the nav's own rows (NAV_SECTIONS):
// the words, the glyphs, who sees what, and the pages under Menu, Tables, Reports and Settings.

export { isMoreItemActive };

const TAB_BAR_URLS: readonly string[] = ["/", "/tables", "/pos", "/orders"];

/** The four tabs: the nav's Home, Floor, Order and Orders rows (the HTML's Manager tabs). */
export const TAB_BAR_ITEMS: readonly NavItemDef[] = TAB_BAR_URLS.map((url) => {
  const row = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.url === url);
  if (!row) throw new Error(`The nav has no ${url} row for the tab bar.`);
  return row;
});

/** A tab is lit on its own page (and its sub-pages), as its nav row is: Floor on the floor only, Home on / only. */
export function isTabActive(tab: NavItemDef, pathname: string): boolean {
  return tab.exact ? pathname === tab.url : isActivePath(pathname, tab.url);
}

/** The More grid: every page this person may open that is not a tab, in the nav's order, groups with their pages. */
export function moreItemsFor(role: StaffRole, tokensOn: boolean): MoreItem[] {
  const isAdmin = role === "admin";
  return visibleNavSections(isAdmin, tokensOn)
    .flatMap((section) => section.items)
    .filter((item) => !TAB_BAR_URLS.includes(item.url))
    .map((item) => ({ title: item.title, url: item.url, icon: item.icon, exact: item.exact, sub: navSubPages(item.url, isAdmin) }));
}

/** More is lit while the page is one the More sheet holds (the HTML's moreC), never on a tab's page. */
export function isMoreActive(pathname: string, more: readonly MoreItem[]): boolean {
  return !TAB_BAR_ITEMS.some((tab) => isTabActive(tab, pathname)) && more.some((item) => isMoreItemActive(item, pathname));
}

// A tab: 56px, the 22px glyph 3px over an 11px/500 label; --text-2, the accent on the current page. The HTML's tab
// is a button with the browser's own 1px 6px padding (it sets none), kept here.
const TAB_CLASS = cn(
  "flex h-14 min-w-0 flex-col items-center justify-center gap-[3px] px-1.5 py-px text-[11px] font-medium text-muted-foreground data-[active=true]:text-primary",
  BRAND_PRESS_CLASS,
);

interface TabBarNavProps {
  pathname: string;
  moreActive: boolean;
  moreOpen: boolean;
  onMore: () => void;
}

/** The bar itself (render-tested in lib/tab-bar-paths.test.ts). */
export function TabBarNav({ pathname, moreActive, moreOpen, onMore }: TabBarNavProps) {
  return (
    <nav
      aria-label="Main"
      data-ui="tab-bar"
      className="fixed inset-x-0 bottom-0 z-[12] grid grid-cols-5 border-t border-border bg-glass pt-0.5 pb-[env(safe-area-inset-bottom)] font-sans leading-[normal] [backdrop-filter:saturate(180%)_blur(20px)] [-webkit-backdrop-filter:saturate(180%)_blur(20px)] tab:hidden"
    >
      {TAB_BAR_ITEMS.map((tab) => {
        const active = isTabActive(tab, pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.url}
            href={tab.url}
            prefetch={false}
            data-ui="tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
            className={TAB_CLASS}
          >
            <Icon aria-hidden="true" strokeWidth={1.7} className="size-[22px] flex-none" />
            <span>{tab.title}</span>
          </Link>
        );
      })}
      <button
        type="button"
        data-ui="tab-more"
        data-active={moreActive}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={onMore}
        className={TAB_CLASS}
      >
        <GlyphMore aria-hidden="true" strokeWidth={1.7} className="size-[22px] flex-none" />
        <span>More</span>
      </button>
    </nav>
  );
}

export function TabBar() {
  const pathname = usePathname() ?? "";
  const { isAdmin } = useAuth();
  const settings = useSettings();
  const tokensOn = printConfigOf(settings.data).token.enabled;
  const [open, setOpen] = useState(false);
  const more = moreItemsFor(isAdmin ? "admin" : "staff", tokensOn);

  return (
    <>
      <TabBarNav pathname={pathname} moreActive={isMoreActive(pathname, more)} moreOpen={open} onMore={() => setOpen(true)} />
      <ProfileSheet open={open} onOpenChange={setOpen} more={more} />
    </>
  );
}
