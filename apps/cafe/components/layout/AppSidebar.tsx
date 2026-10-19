"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Inbox, Users, PartyPopper, UserCog, Armchair, Printer, Tv, Wallet } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useWarmRoutes } from "@/hooks/use-warm-routes";
import { useSettings } from "@/hooks/use-settings";
import { brandFontVariables } from "@/lib/brand-fonts";
import { productImageUrl } from "@/lib/images";
import { APP_NAME } from "@/lib/constants";
import { isActivePath } from "@/lib/nav-active";
import { litNavRow } from "@/lib/nav-lit-row";
import { printConfigOf } from "@/lib/print";
import { SETTINGS_BASE_PATH, VISIBLE_SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import { REPORTS_BASE_PATH, REPORT_SECTIONS, reportSectionPath } from "@/lib/report-sections";
import { MENU_ITEMS_PATH, isMenuPath, visibleMenuSections } from "@/lib/menu-sections";
import { TABLES_MANAGE_SECTIONS, TABLES_SETUP_PATH } from "@/lib/table-sections";
import {
  BRAND_NAV_CLASS,
  BRAND_NAV_COLLAPSE_CLASS,
  BRAND_NAV_LABEL_CLASS,
  BRAND_NAV_SCROLL_CLASS,
  BRAND_NAV_SEPARATOR_CLASS,
} from "@/components/brand/brand-classes";
import { RequestCountBadge } from "@/components/orders/RequestCountBadge";
import {
  NavBookings,
  NavFloor,
  NavHome,
  NavKitchen,
  NavMenu,
  NavOrder,
  NavOrders,
  NavReports,
  NavSettings,
  type NavIcon,
} from "@/components/layout/nav-icons";
import { NavItem, NavRowContent, useNavWide } from "@/components/layout/nav-parts";
import { SidebarAccount } from "@/components/layout/SidebarAccount";
import { SidebarBrand } from "@/components/layout/SidebarBrand";
import { SidebarSettingsGroup } from "@/components/layout/SidebarSettingsGroup";
import { SidebarReportsGroup } from "@/components/layout/SidebarReportsGroup";
import { SidebarMenuGroup } from "@/components/layout/SidebarMenuGroup";
import { SidebarTablesGroup } from "@/components/layout/SidebarTablesGroup";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";

// The staff nav, the owner's HTML (values 2.3, design 5.2; U0 Task 2): the
// 232px sidebar from 1280px (collapsible to the rail), the 76px rail from
// 720px, and nothing on a phone, where the tab bar and its More sheet take
// over (components/layout/TabBar.tsx, from NAV_SECTIONS). Its classes are in
// components/brand/brand-classes.ts; which form shows is CSS (the `wide`
// variant in app/globals.css), so the server and the first paint already
// agree with the screen. The two groups are the HTML's Operate and Manage,
// with the HTML's words where it has the screen ("Home", "Order", and
// "Bookings" for Reservations in the rail).

export type NavItemDef = {
  title: string;
  url: string;
  icon: NavIcon;
  /** The label in the 76px rail when the full one does not fit (the HTML's "Bookings"). */
  railTitle?: string;
  adminOnly?: boolean;
  /** Shown only while tokens are on (Settings -> Tokens & numbering). */
  tokensOnly?: boolean;
  /** Lights on this exact path only, not its sub-paths (Floor vs Setup / QR). */
  exact?: boolean;
};

/** `warm`: the service screens staff hop between all shift — kept fully
 *  prefetched (hooks/use-warm-routes.ts) so opening one never waits for the
 *  network. Setup and admin screens load on click as before. */
export type NavSection = { label: string; warm?: boolean; items: NavItemDef[] };

/** The nav's rows: the one list the sidebar, the rail and the phone's tab bar and More sheet (TabBar.tsx) read. */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operate",
    warm: true,
    items: [
      { title: "Home", url: "/", icon: NavHome },
      { title: "Floor", url: "/tables", icon: NavFloor, exact: true },
      { title: "Order", url: "/pos", icon: NavOrder },
      { title: "Orders", url: "/orders", icon: NavOrders },
      { title: "Order Requests", url: "/requests", icon: Inbox, railTitle: "Requests" },
      { title: "Kitchen", url: "/kitchen", icon: NavKitchen },
      { title: "Now Serving", url: "/now-serving", icon: Tv, tokensOnly: true, railTitle: "Serving" },
      { title: "Reservations", url: "/reservations", icon: NavBookings, railTitle: "Bookings" },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Menu", url: "/products", icon: NavMenu },
      { title: "Tables", url: "/tables/setup", icon: Armchair, adminOnly: true },
      { title: "Customers", url: "/customers", icon: Users },
      // Open to every role: staff add an expense and see their own from today;
      // the full list, categories and the report stay admin-only inside the page.
      { title: "Expenses", url: "/expenses", icon: Wallet },
      { title: "Events", url: "/events", icon: PartyPopper },
      { title: "Staff", url: "/staff", icon: UserCog, adminOnly: true },
      { title: "Reports", url: "/reports", icon: NavReports, adminOnly: true },
      { title: "Printer setup", url: "/printers", icon: Printer, adminOnly: true, railTitle: "Printers" },
      { title: "Settings", url: "/settings", icon: NavSettings, adminOnly: true },
    ],
  },
];

/** The rows this person sees: the admin-only ones for an admin, Now Serving while tokens are on; empty groups go. */
export function visibleNavSections(isAdmin: boolean, tokensOn: boolean): NavSection[] {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isAdmin).filter((item) => !item.tokensOnly || tokensOn),
    }))
    .filter((section) => section.items.length > 0);
}

/** A sub-page of a row with sub-pages. */
export type NavSubPage = { title: string; href: string };

/** The sub-pages of a row with sub-pages (Menu, Tables, Reports, Settings), from the lists their nav rows render;
 *  none for a plain row, or for Menu when staff see only Items (that row is then a plain link). */
export function navSubPages(url: string, isAdmin: boolean): NavSubPage[] {
  switch (url) {
    case MENU_ITEMS_PATH: {
      const sections = visibleMenuSections(isAdmin);
      return sections.length <= 1 ? [] : sections.map((s) => ({ title: s.title, href: s.href }));
    }
    case TABLES_SETUP_PATH:
      return TABLES_MANAGE_SECTIONS.filter((s) => isAdmin || !s.adminOnly).map((s) => ({ title: s.title, href: s.href }));
    case REPORTS_BASE_PATH:
      return REPORT_SECTIONS.map((s) => ({ title: s.title, href: reportSectionPath(s.slug) }));
    case SETTINGS_BASE_PATH:
      return VISIBLE_SETTINGS_SECTIONS.map((s) => ({ title: s.title, href: settingsSectionPath(s.slug) }));
    default:
      return [];
  }
}

/** Just longer than the Settings list's open animation (0.2s). */
const SCROLL_AFTER_OPEN_MS = 250;

export function AppSidebar() {
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  // The collapsed state is remembered on this device; a phone has no nav.
  const collapsed = state === "collapsed" && !isMobile;
  const wide = useNavWide(collapsed);
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const labelId = useId();
  const navRef = useRef<HTMLElement>(null);

  // The rows' tap hook. It closed the phone's nav sheet; a phone has no nav
  // since the tab bar (U0 Task 4: components/ui/sidebar.tsx renders nothing
  // below 720px), so it never finds one open now.
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Settings expands in place instead of navigating away: the section list
  // is a Collapsible sub-menu under the Settings row. Open state is
  // controlled so a manual collapse sticks while navigating between section
  // pages; the effect only forces it open when the route ENTERS /settings
  // from outside (deps on the boolean, never on pathname, so an in-settings
  // collapse is not re-opened by every sub-page navigation).
  const onSettings = pathname === SETTINGS_BASE_PATH || pathname.startsWith(`${SETTINGS_BASE_PATH}/`);
  const [settingsOpen, setSettingsOpen] = useState(onSettings);
  useEffect(() => {
    if (onSettings) setSettingsOpen(true);
  }, [onSettings]);

  // Reports and Menu expand the same way, but neither has a hub page of its
  // own distinct from its first section, so `onReports`/`onMenu` alone (no
  // `onHub` branch) decide each trigger row's lit state.
  const onReports = pathname === REPORTS_BASE_PATH || pathname.startsWith(`${REPORTS_BASE_PATH}/`);
  const [reportsOpen, setReportsOpen] = useState(onReports);
  useEffect(() => {
    if (onReports) setReportsOpen(true);
  }, [onReports]);

  const onMenu = isMenuPath(pathname);
  const [menuOpen, setMenuOpen] = useState(onMenu);
  useEffect(() => {
    if (onMenu) setMenuOpen(true);
  }, [onMenu]);

  // Keep the lit row in view: on a short screen (or with Settings'/Reports'
  // list open) it can sit below the fold. Waits out the list's open animation.
  // In the rail a sub-page's own row is not rendered, so litNavRow falls back
  // to the lit group row (lib/nav-lit-row.ts).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (navRef.current) litNavRow(navRef.current)?.scrollIntoView({ block: "nearest" });
    }, SCROLL_AFTER_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, settingsOpen, reportsOpen, menuOpen]);

  // Brand name comes from the cafe's own Settings (Settings.restaurantName),
  // configured on the Settings page — generic fallback before it's set.
  const settings = useSettings();
  const brandName = settings.data?.restaurantName?.trim() || APP_NAME;
  const tokensOn = printConfigOf(settings.data).token.enabled;
  // The brand tile shows the cafe's own uploaded logo, else the cafe's initial
  // on the brand red (design 5.2, ruling R3). The product's logo stays the tab
  // icon and the login page's mark; it never stands in for the cafe here.
  const logoUrl = productImageUrl(settings.data?.logo, undefined, { fit: true });

  const visibleSections = visibleNavSections(isAdmin, tokensOn);
  const warmHrefs = visibleSections
    .filter((section) => section.warm)
    .flatMap((section) => section.items.map((item) => item.url));
  useWarmRoutes(warmHrefs);

  // No nav Link prefetches on its own: a warm row's ONLY warmer is the
  // hook above, which waits for a working line. A Link prefetch fires on sight
  // and on hover — on a line still waking up it can fail, and a failed
  // prefetch turns the next click on that row into a full page load.
  const renderItem = (item: NavItemDef) => {
    switch (item.url) {
      case "/settings":
        return (
          <SidebarSettingsGroup
            key={item.url} url={item.url} title={item.title} icon={item.icon} wide={wide}
            pathname={pathname} onSettings={onSettings} settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen} onNavigate={closeMobile}
          />
        );
      case "/reports":
        return (
          <SidebarReportsGroup
            key={item.url} title={item.title} icon={item.icon} wide={wide} pathname={pathname}
            onReports={onReports} reportsOpen={reportsOpen} onReportsOpenChange={setReportsOpen}
            onNavigate={closeMobile}
          />
        );
      case "/products":
        return (
          <SidebarMenuGroup
            key={item.url} title={item.title} icon={item.icon} wide={wide} pathname={pathname}
            isAdmin={isAdmin} menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} onNavigate={closeMobile}
          />
        );
      case "/tables/setup":
        return (
          <SidebarTablesGroup
            key={item.url} title={item.title} icon={item.icon} wide={wide} pathname={pathname}
            onNavigate={closeMobile}
          />
        );
    }

    const active = item.exact ? pathname === item.url : isActivePath(pathname, item.url);
    return (
      <NavItem key={item.url} isActive={active}>
        <Link
          href={item.url}
          prefetch={false}
          title={item.title}
          aria-current={active ? "page" : undefined}
          onClick={closeMobile}
        >
          <NavRowContent icon={item.icon} title={item.title} railTitle={item.railTitle}>
            {item.url === "/requests" && <RequestCountBadge />}
          </NavRowContent>
        </Link>
      </NavItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <div className={`${brandFontVariables} flex min-h-0 flex-1 flex-col`}>
        <nav ref={navRef} aria-label="Main" data-ui="nav" className={BRAND_NAV_CLASS}>
          <SidebarBrand key={logoUrl ?? "initial"} brandName={brandName} logoUrl={logoUrl} onNavigate={closeMobile} />

          <div className={BRAND_NAV_SCROLL_CLASS}>
            {visibleSections.map((section, index) => {
              const id = `${labelId}-${index}`;
              return (
                <div key={section.label} className="flex flex-none flex-col gap-0.5">
                  <div id={id} data-ui="nav-group-label" className={BRAND_NAV_LABEL_CLASS}>
                    {section.label}
                  </div>
                  {index > 0 && <div aria-hidden="true" data-ui="nav-separator" className={BRAND_NAV_SEPARATOR_CLASS} />}
                  <ul className="flex flex-col gap-0.5" aria-labelledby={id}>
                    {section.items.map((item) => renderItem(item))}
                  </ul>
                </div>
              );
            })}
            {/* The HTML's spacer: at least 16px between the last row and Collapse. */}
            <div aria-hidden="true" className="h-4 flex-none" />
          </div>

          {/* Collapse / Expand: 1280px and up only; the choice is remembered on this device. */}
          <button
            type="button"
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            data-ui="nav-collapse"
            onClick={toggleSidebar}
            className={BRAND_NAV_COLLAPSE_CLASS}
          >
            <ChevronRight aria-hidden="true" strokeWidth={1.8} className="size-[18px] flex-none wide:rotate-180" />
            <span className="hidden wide:inline">Collapse</span>
          </button>
          <div aria-hidden="true" data-ui="nav-divider" className="mx-1 my-1.5 h-px flex-none bg-nav-2" />
          <SidebarAccount />
        </nav>
      </div>
    </Sidebar>
  );
}
