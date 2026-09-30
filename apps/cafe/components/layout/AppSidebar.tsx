"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Inbox,
  Coffee,
  Users,
  CalendarClock,
  PartyPopper,
  UserCog,
  Receipt,
  LayoutGrid,
  BarChart3,
  Settings,
  ChefHat,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useWarmRoutes } from "@/hooks/use-warm-routes";
import { useSettings } from "@/hooks/use-settings";
import { brandFontVariables } from "@/lib/brand-fonts";
import { brandingUrl, productImageUrl } from "@/lib/images";
import { APP_NAME } from "@/lib/constants";
import { isActivePath } from "@/lib/nav-active";
import { SETTINGS_BASE_PATH } from "@/lib/settings-sections";
import { REPORTS_BASE_PATH } from "@/lib/report-sections";
import { isMenuPath } from "@/lib/menu-sections";
import { BRAND_NAV_ITEM_CLASS, BRAND_NAV_LABEL_CLASS } from "@/components/brand/brand-classes";
import { brandTooltip } from "@/components/brand/brand-tooltip";
import { RequestCountBadge } from "@/components/orders/RequestCountBadge";
import { SidebarAccount } from "@/components/layout/SidebarAccount";
import { SidebarBrand } from "@/components/layout/SidebarBrand";
import { SidebarSettingsGroup } from "@/components/layout/SidebarSettingsGroup";
import { SidebarReportsGroup } from "@/components/layout/SidebarReportsGroup";
import { SidebarMenuGroup } from "@/components/layout/SidebarMenuGroup";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

// The staff sidebar, on the "Paper & Ink" brand system (tokens in
// app/globals.css — the primitive's --sidebar-* values point at them — row
// styles in components/brand/brand-classes.ts). Widths are the primitive's
// own 16rem / 3rem, which the POS layout matrix depends on: never widen it.
//
// The rows are grouped the way the day runs — taking orders, then the things
// set up behind them, then the owner's tools — each group under a short
// sentence-case heading (Shopify's navigation guidance: group related items
// into sections, and let a title say what the section is).

type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

/** `warm`: the service screens staff hop between all shift — kept fully
 *  prefetched (hooks/use-warm-routes.ts) so opening one never waits for the
 *  network. Setup and admin screens load on click as before. */
type NavSection = { label?: string; warm?: boolean; items: NavItem[] };

const sections: NavSection[] = [
  { warm: true, items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }] },
  {
    label: "Service",
    warm: true,
    items: [
      { title: "New Order", url: "/pos", icon: ShoppingCart },
      // Orders sits right under New Order (owner, 2026-09-29): the two are
      // used back to back — take an order, then find or settle one.
      { title: "Orders", url: "/orders", icon: Receipt },
      { title: "Order Requests", url: "/requests", icon: Inbox },
      { title: "Kitchen", url: "/kitchen", icon: ChefHat },
      { title: "Reservations", url: "/reservations", icon: CalendarClock },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Menu", url: "/products", icon: Coffee },
      { title: "Tables", url: "/tables", icon: LayoutGrid },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Events", url: "/events", icon: PartyPopper },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Staff", url: "/staff", icon: UserCog, adminOnly: true },
      { title: "Reports", url: "/reports", icon: BarChart3, adminOnly: true },
      { title: "Settings", url: "/settings", icon: Settings, adminOnly: true },
    ],
  },
];

/** Just longer than the Settings list's open animation (0.2s). */
const SCROLL_AFTER_OPEN_MS = 250;

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // The phone sheet always shows full rows, whatever the desktop rail was
  // last left as (the collapsed state is remembered per browser).
  const collapsed = state === "collapsed" && !isMobile;
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const labelId = useId();
  const navRef = useRef<HTMLElement>(null);

  // Closes the phone Sheet after any nav tap — shadcn/ui's sidebar primitive
  // leaves this to the consumer (research brief, PR #8402).
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
  useEffect(() => {
    const timer = window.setTimeout(() => {
      navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    }, SCROLL_AFTER_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, settingsOpen, reportsOpen, menuOpen]);

  // Brand name comes from the cafe's own Settings (Settings.restaurantName),
  // configured on the Settings page — generic fallback before it's set.
  const settings = useSettings();
  const brandName = settings.data?.restaurantName?.trim() || APP_NAME;
  const logoUrl = productImageUrl(settings.data?.logo, undefined, { fit: true });
  // A cafe that hasn't uploaded its own mark yet should see the PRODUCT's mark
  // rather than a generic glyph — restaurant logo takes priority, then the saved
  // product logo, then the unversioned branding URL, which the route answers with
  // the product's built-in mark. Same chain the login screen renders, so the two
  // never disagree about what an unbranded cafe looks like.
  const productLogoUrl = productImageUrl(settings.data?.productLogo, undefined, { fit: true });
  const displayLogoUrl = logoUrl ?? productLogoUrl ?? brandingUrl("productLogo");

  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.adminOnly || isAdmin) }))
    .filter((section) => section.items.length > 0);
  const warmHrefs = visibleSections
    .filter((section) => section.warm)
    .flatMap((section) => section.items.map((item) => item.url));
  useWarmRoutes(warmHrefs);

  // No sidebar Link prefetches on its own: a warm row's ONLY warmer is the
  // hook above, which waits for a working line. A Link prefetch fires on sight
  // and on hover — on a line still waking up it can fail, and a failed
  // prefetch turns the next click on that row into a full page load.
  const renderItem = (item: NavItem) => {
    switch (item.url) {
      case "/settings":
        return (
          <SidebarSettingsGroup
            key={item.url} url={item.url} title={item.title} icon={item.icon} collapsed={collapsed}
            pathname={pathname} onSettings={onSettings} settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen} onNavigate={closeMobile} tooltip={brandTooltip(item.title)}
          />
        );
      case "/reports":
        return (
          <SidebarReportsGroup
            key={item.url} title={item.title} icon={item.icon} collapsed={collapsed} pathname={pathname}
            onReports={onReports} reportsOpen={reportsOpen} onReportsOpenChange={setReportsOpen}
            onNavigate={closeMobile} tooltip={brandTooltip(item.title)}
          />
        );
      case "/products":
        return (
          <SidebarMenuGroup
            key={item.url} title={item.title} icon={item.icon} collapsed={collapsed} pathname={pathname}
            isAdmin={isAdmin} menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} onNavigate={closeMobile}
            tooltip={brandTooltip(item.title)}
          />
        );
    }

    const active = isActivePath(pathname, item.url);
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={active} tooltip={brandTooltip(item.title)} className={BRAND_NAV_ITEM_CLASS}>
          <Link
            href={item.url}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            onClick={closeMobile}
          >
            <item.icon aria-hidden="true" />
            {!collapsed && <span>{item.title}</span>}
          </Link>
        </SidebarMenuButton>
        {item.url === "/requests" && <RequestCountBadge />}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      {/* Brand fonts for everything in the sidebar — on desktop AND in the
          phone sheet, which renders these children but not this className. */}
      <div className={`${brandFontVariables} flex min-h-0 flex-1 flex-col font-brand-sans`}>
        {/* h-14 lines its bottom rule up with the page header's. */}
        <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border px-3 py-0 group-data-[collapsible=icon]:px-2">
          <SidebarBrand
            key={displayLogoUrl}
            brandName={brandName}
            logoUrl={displayLogoUrl}
            collapsed={collapsed}
            onNavigate={closeMobile}
          />
        </SidebarHeader>

        <SidebarContent className="gap-0 py-2 [scrollbar-color:var(--brand-rule)_transparent] [scrollbar-width:thin]">
          <nav ref={navRef} aria-label="Main">
            {visibleSections.map((section, index) => {
              const id = `${labelId}-${index}`;
              return (
                <SidebarGroup key={section.label ?? "home"} className="px-3 py-1 group-data-[collapsible=icon]:px-2">
                  {section.label && (
                    <SidebarGroupLabel id={id} className={BRAND_NAV_LABEL_CLASS}>
                      {section.label}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5" aria-labelledby={section.label ? id : undefined}>
                      {section.items.map((item) => renderItem(item))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </nav>
        </SidebarContent>

        <SidebarFooter className="shrink-0 border-t border-sidebar-border px-3 py-2 group-data-[collapsible=icon]:px-2">
          <SidebarAccount collapsed={collapsed} />
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
