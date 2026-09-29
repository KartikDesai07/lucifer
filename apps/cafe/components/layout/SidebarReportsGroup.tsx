"use client";

// The Reports nav row of AppSidebar, mirroring SidebarSettingsGroup.tsx (kept
// as its own file for the same reason: AppSidebar.tsx must stay under the
// line ceiling). Reports has no hub page of its own (unlike Settings) — every
// slug routes straight to its report, so the trigger row lights only while the
// section list is folded away; the lit sub-row below says where you are once
// it's open. The icon-collapsed rail renders one Link straight to the first
// section, since the primitive hides sub-menus there anyway.
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { REPORT_SECTIONS, reportSectionPath } from "@/lib/report-sections";
import { BRAND_NAV_ITEM_CLASS, BRAND_NAV_SUB_ITEM_CLASS } from "@/components/brand/brand-classes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

interface SidebarReportsGroupProps {
  title: string;
  icon: LucideIcon;
  collapsed: boolean;
  pathname: string;
  onReports: boolean;
  reportsOpen: boolean;
  onReportsOpenChange: (open: boolean) => void;
  onNavigate: () => void;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
}

export function SidebarReportsGroup({
  title,
  icon: Icon,
  collapsed,
  pathname,
  onReports,
  reportsOpen,
  onReportsOpenChange,
  onNavigate,
  tooltip,
}: SidebarReportsGroupProps) {
  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onReports} tooltip={tooltip} className={BRAND_NAV_ITEM_CLASS}>
          <Link
            href={reportSectionPath(REPORT_SECTIONS[0].slug)}
            prefetch={false}
            aria-current={pathname === reportSectionPath(REPORT_SECTIONS[0].slug) ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible open={reportsOpen} onOpenChange={onReportsOpenChange} className="group/collapsible">
        {/* The trigger is a button, not a Link — it must NOT close the mobile
            Sheet, or the sub-items it reveals would be unreachable on a phone.
            There is no Reports hub page, so (unlike Settings) the row lights
            only while the list is folded; open, the lit sub-row says where
            you are. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onReports && !reportsOpen} className={BRAND_NAV_ITEM_CLASS}>
            <Icon aria-hidden="true" />
            <span>{title}</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto !size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
          {/* ml-[18px]: the guide line runs straight down from the Reports
              icon's centre (row padding 10px + half the 18px icon). */}
          <SidebarMenuSub className="mx-0 ml-[18px] mt-0.5 gap-0.5 pl-2.5 pr-0">
            {REPORT_SECTIONS.map((section) => {
              const href = reportSectionPath(section.slug);
              const active = pathname === href;
              return (
                <SidebarMenuSubItem key={section.slug}>
                  <SidebarMenuSubButton asChild isActive={active} className={BRAND_NAV_SUB_ITEM_CLASS}>
                    <Link href={href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
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
