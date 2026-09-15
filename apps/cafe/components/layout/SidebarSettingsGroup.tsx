"use client";

// The Settings nav row of AppSidebar, extracted to keep AppSidebar.tsx under
// the file's line ceiling. Settings expands in place: a Collapsible sub-menu
// lists every SETTINGS_SECTIONS entry under the Settings row (icon-collapsed
// mode instead renders a plain link straight to the hub, since the primitive
// hides sub-menus there anyway).
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
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
}: SidebarSettingsGroupProps) {
  if (collapsed) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onSettings} tooltip={title}>
          <Link href={url} className="flex items-center gap-2" onClick={onNavigate}>
            <Icon className="h-4 w-4" />
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible open={settingsOpen} onOpenChange={onSettingsOpenChange} className="group/collapsible">
        {/* The trigger is a button, not a Link — it must NOT close the
            mobile Sheet, or the sub-items it reveals would be unreachable
            on a phone. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={onSettings} tooltip={title}>
            <Icon className="h-4 w-4" />
            <span>{title}</span>
            <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {SETTINGS_SECTIONS.map((section) => (
              <SidebarMenuSubItem key={section.slug}>
                <SidebarMenuSubButton asChild isActive={pathname === settingsSectionPath(section.slug)}>
                  <Link href={settingsSectionPath(section.slug)} onClick={onNavigate}>
                    <span>{section.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
