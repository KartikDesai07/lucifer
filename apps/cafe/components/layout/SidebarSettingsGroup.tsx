"use client";

// The Settings nav row of AppSidebar, extracted to keep AppSidebar.tsx under
// the file's line ceiling. Settings expands in place: a Collapsible sub-menu
// lists every visible section (VISIBLE_SETTINGS_SECTIONS) under the Settings row (icon-collapsed
// mode instead renders a plain link straight to the hub, since the primitive
// hides sub-menus there anyway). Row styles are the brand nav classes, shared
// with every other sidebar row; the list slides open (motion-safe only).
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { VISIBLE_SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import { BRAND_NAV_ITEM_CLASS, BRAND_NAV_SUB_ITEM_CLASS } from "@/components/brand/brand-classes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

interface SidebarSettingsGroupProps {
  url: string;
  title: string;
  icon: LucideIcon;
  collapsed: boolean;
  pathname: string;
  onSettings: boolean;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onNavigate: () => void;
  tooltip: ComponentProps<typeof SidebarMenuButton>["tooltip"];
}

export function SidebarSettingsGroup({
  url,
  title,
  icon: Icon,
  collapsed,
  pathname,
  onSettings,
  settingsOpen,
  onSettingsOpenChange,
  onNavigate,
  tooltip,
}: SidebarSettingsGroupProps) {
  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onSettings} tooltip={tooltip} className={BRAND_NAV_ITEM_CLASS}>
          <Link href={url} prefetch={false} aria-current={pathname === url ? "page" : undefined} onClick={onNavigate}>
            <Icon aria-hidden="true" />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // The Settings hub itself (/settings, the card grid) has no section row of
  // its own, so there the Settings row stays lit and announces the page.
  const onHub = pathname === url;

  return (
    <SidebarMenuItem>
      <Collapsible open={settingsOpen} onOpenChange={onSettingsOpenChange} className="group/collapsible">
        {/* The trigger is a button, not a Link — it must NOT close the
            mobile Sheet, or the sub-items it reveals would be unreachable
            on a phone. On a section page it lights up only while the list is
            folded away; open, the lit sub-row below says where you are. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={onHub || (onSettings && !settingsOpen)}
            aria-current={onHub ? "page" : undefined}
            className={BRAND_NAV_ITEM_CLASS}
          >
            <Icon aria-hidden="true" />
            <span>{title}</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto !size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
          {/* ml-[18px]: the guide line runs straight down from the Settings
              icon's centre (row padding 10px + half the 18px icon). */}
          <SidebarMenuSub className="mx-0 ml-[18px] mt-0.5 gap-0.5 pl-2.5 pr-0">
            {VISIBLE_SETTINGS_SECTIONS.map((section) => {
              const href = settingsSectionPath(section.slug);
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
