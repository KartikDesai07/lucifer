"use client";

// The Tables nav row of AppSidebar, mirroring SidebarMenuGroup.tsx. Staff see
// one section (the Floor) and so get a plain Link, not a drop-down with a
// single child; so does the collapsed rail. The group owns its open state (so
// AppSidebar stays under its line ceiling): a manual collapse sticks while
// moving between the Tables pages, and the effect only forces it open when the
// route ENTERS /tables from outside.
import { useEffect, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import {
  TABLE_SECTIONS,
  TABLES_FLOOR_PATH,
  isTableSectionActive,
  isTablesPath,
  visibleTableSections,
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
  isAdmin: boolean;
  onNavigate: () => void;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
}

export function SidebarTablesGroup({
  title,
  icon: Icon,
  collapsed,
  pathname,
  isAdmin,
  onNavigate,
  tooltip,
}: SidebarTablesGroupProps) {
  const sections = visibleTableSections(isAdmin);
  const onTables = isTablesPath(pathname);
  const [open, setOpen] = useState(onTables);
  useEffect(() => {
    if (onTables) setOpen(true);
  }, [onTables]);

  // Collapsed rail, or staff (who only ever see the Floor): a single Link to
  // the Floor. The row's lit state follows onTables (an admin on /tables/setup
  // with the rail folded still sees the Tables icon lit); aria-current stays on
  // the exact match, the only page this Link points at.
  if (collapsed || sections.length <= 1) {
    const exact = isTableSectionActive(pathname, TABLES_FLOOR_PATH);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onTables} tooltip={tooltip} className={BRAND_NAV_ITEM_CLASS}>
          <Link
            href={TABLES_FLOOR_PATH}
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
          <SidebarMenuButton isActive={onTables && !open} className={BRAND_NAV_ITEM_CLASS}>
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
            {TABLE_SECTIONS.filter((section) => sections.includes(section)).map((section) => {
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
