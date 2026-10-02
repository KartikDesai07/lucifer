"use client";

// The Tables (manage) nav row of AppSidebar, mirroring SidebarMenuGroup.tsx.
// Admin only: it holds Setup and QR codes — the live Floor is its own row under
// New Order / Orders. The collapsed rail gets a plain Link to Setup. The group
// owns its open state (so AppSidebar stays under its line ceiling): a manual
// collapse sticks while moving between Setup and QR codes, and the effect only
// forces it open when the route ENTERS the manage paths from outside.
import { useEffect, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import {
  TABLES_MANAGE_SECTIONS,
  TABLES_SETUP_PATH,
  isTableSectionActive,
  isTablesManagePath,
} from "@/lib/table-sections";
import { BRAND_NAV_ITEM_CLASS, BRAND_NAV_SUB_ITEM_CLASS } from "@/components/brand/brand-classes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

interface SidebarTablesGroupProps {
  title: string;
  icon: LucideIcon;
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
}

export function SidebarTablesGroup({
  title,
  icon: Icon,
  collapsed,
  pathname,
  onNavigate,
  tooltip,
}: SidebarTablesGroupProps) {
  const onManage = isTablesManagePath(pathname);
  const [open, setOpen] = useState(onManage);
  useEffect(() => {
    if (onManage) setOpen(true);
  }, [onManage]);

  // Collapsed rail: a single Link to Setup. The row's lit state follows
  // onManage (an admin on /tables/qr with the rail folded still sees the Tables
  // icon lit); aria-current stays on the exact match, the only page this Link
  // points at.
  if (collapsed) {
    const exact = isTableSectionActive(pathname, TABLES_SETUP_PATH);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onManage} tooltip={tooltip} className={BRAND_NAV_ITEM_CLASS}>
          <Link
            href={TABLES_SETUP_PATH}
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
      <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
        {/* A button, not a Link — must not close the mobile Sheet, or the
            sub-items it reveals would be unreachable on a phone. The trigger
            row lights only while the list is folded; the lit sub-row says where
            you are once it's open. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onManage && !open} className={BRAND_NAV_ITEM_CLASS}>
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
            {TABLES_MANAGE_SECTIONS.map((section) => {
              const active = isTableSectionActive(pathname, section.href);
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
