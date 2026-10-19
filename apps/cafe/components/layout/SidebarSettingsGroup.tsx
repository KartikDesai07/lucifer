"use client";

// The Settings row of the nav, extracted to keep AppSidebar.tsx small. Settings expands in place: in the wide form
// its visible sections (VISIBLE_SETTINGS_SECTIONS) open as sub-rows under the row, and in the 76px rail they open in
// a flyout to its right (design 5.2; the row, the sub-rows and the flyout are components/layout/nav-parts.tsx).
import Link from "next/link";

import { VISIBLE_SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import type { NavIcon } from "@/components/layout/nav-icons";
import { NavGroupRow, NavSubItem } from "@/components/layout/nav-parts";

interface SidebarSettingsGroupProps {
  url: string;
  title: string;
  icon: NavIcon;
  /** The nav's current form (useNavWide): sub-rows when wide, the flyout in the rail. */
  wide: boolean;
  pathname: string;
  onSettings: boolean;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}

export function SidebarSettingsGroup({
  url,
  title,
  icon,
  wide,
  pathname,
  onSettings,
  settingsOpen,
  onSettingsOpenChange,
  onNavigate,
}: SidebarSettingsGroupProps) {
  // The Settings hub itself (/settings, the card grid) has no section row of
  // its own, so there the Settings row stays lit and announces the page.
  const onHub = pathname === url;

  // On a section page the row is lit in the rail and while its list is
  // folded away; with the list open in the wide form the lit sub-row says
  // where you are (nav-parts: data-sub-current).
  return (
    <NavGroupRow
      title={title}
      icon={icon}
      wide={wide}
      isActive={onSettings}
      aria-current={onHub ? "page" : undefined}
      open={settingsOpen}
      onOpenChange={onSettingsOpenChange}
      subRows={(place) =>
        VISIBLE_SETTINGS_SECTIONS.map((section) => {
          const href = settingsSectionPath(section.slug);
          const active = pathname === href;
          return (
            <NavSubItem key={section.slug} place={place} isActive={active}>
              <Link href={href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {section.title}
              </Link>
            </NavSubItem>
          );
        })}
    />
  );
}
