"use client";

// The Menu nav row of AppSidebar, mirroring SidebarReportsGroup.tsx (its own
// file for the same line-ceiling reason as Settings/Reports). Unlike Reports,
// Menu has a real hub page at its first entry (/products = Items), which
// staff can also open directly — so when there is only one VISIBLE section
// (staff, since Categories is adminOnly) or the rail is collapsed, this
// renders a single plain Link instead of a drop-down (D5, a declared
// deviation from "drop-down for every role").
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { MENU_SECTIONS, MENU_ITEMS_PATH, isMenuPath, visibleMenuSections } from "@/lib/menu-sections";
import { isActivePath } from "@/lib/nav-active";
import { BRAND_NAV_ITEM_CLASS, BRAND_NAV_SUB_ITEM_CLASS } from "@/components/brand/brand-classes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

interface SidebarMenuGroupProps {
  title: string;
  icon: LucideIcon;
  collapsed: boolean;
  pathname: string;
  isAdmin: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onNavigate: () => void;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
}

export function SidebarMenuGroup({
  title,
  icon: Icon,
  collapsed,
  pathname,
  isAdmin,
  menuOpen,
  onMenuOpenChange,
  onNavigate,
  tooltip,
}: SidebarMenuGroupProps) {
  const sections = visibleMenuSections(isAdmin);
  const onMenu = isMenuPath(pathname);

  // Collapsed rail, or staff (who only ever see the one Items section): a
  // single Link straight to Items, same shape as every other flat nav row —
  // no Collapsible, nothing to expand. The row's VISUAL lit state follows
  // onMenu (like SidebarReportsGroup's collapsed branch), so a staff admin
  // viewing /categories on the folded rail still sees the Menu icon lit
  // (G15) -- aria-current stays on the exact match, since that is the only
  // page this one Link actually points at.
  if (collapsed || sections.length <= 1) {
    const exact = isActivePath(pathname, MENU_ITEMS_PATH);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onMenu} tooltip={tooltip} className={BRAND_NAV_ITEM_CLASS}>
          <Link
            href={MENU_ITEMS_PATH}
            prefetch={false}
            aria-current={exact ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            {!collapsed && <span>{title}</span>}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible open={menuOpen} onOpenChange={onMenuOpenChange} className="group/collapsible">
        {/* A button, not a Link — must not close the mobile Sheet, or the
            sub-items it reveals would be unreachable on a phone. Menu has no
            hub page distinct from Items, so (like Reports) the trigger row
            lights only while the list is folded; the lit sub-row says where
            you are once it's open. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onMenu && !menuOpen} className={BRAND_NAV_ITEM_CLASS}>
            <Icon aria-hidden="true" />
            <span>{title}</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto !size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
          <SidebarMenuSub className="mx-0 ml-[18px] mt-0.5 gap-0.5 pl-2.5 pr-0">
            {MENU_SECTIONS.filter((section) => sections.includes(section)).map((section) => {
              const active = isActivePath(pathname, section.href);
              return (
                <SidebarMenuSubItem key={section.href}>
                  <SidebarMenuSubButton asChild isActive={active} className={BRAND_NAV_SUB_ITEM_CLASS}>
                    <Link href={section.href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                      <span>{section.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
