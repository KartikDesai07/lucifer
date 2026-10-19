"use client";

// The Reports row of the nav, mirroring SidebarSettingsGroup.tsx (its own file for the same reason: AppSidebar.tsx
// stays small). Reports has no hub page of its own (unlike Settings): every slug routes straight to its report, so in
// the wide form, with the list open, the lit sub-row says where you are; in the 76px rail the reports open in a
// flyout to the row's right (design 5.2; components/layout/nav-parts.tsx).
import Link from "next/link";

import { REPORT_SECTIONS, reportSectionPath } from "@/lib/report-sections";
import type { NavIcon } from "@/components/layout/nav-icons";
import { NavGroupRow, NavSubItem } from "@/components/layout/nav-parts";

interface SidebarReportsGroupProps {
  title: string;
  icon: NavIcon;
  /** The nav's current form (useNavWide): sub-rows when wide, the flyout in the rail. */
  wide: boolean;
  pathname: string;
  onReports: boolean;
  reportsOpen: boolean;
  onReportsOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}

export function SidebarReportsGroup({
  title,
  icon,
  wide,
  pathname,
  onReports,
  reportsOpen,
  onReportsOpenChange,
  onNavigate,
}: SidebarReportsGroupProps) {
  return (
    <NavGroupRow title={title} icon={icon} wide={wide} isActive={onReports} open={reportsOpen} onOpenChange={onReportsOpenChange}>
      {(place) =>
        REPORT_SECTIONS.map((section) => {
          const href = reportSectionPath(section.slug);
          const active = pathname === href;
          return (
            <NavSubItem key={section.slug} place={place} isActive={active}>
              <Link href={href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {section.title}
              </Link>
            </NavSubItem>
          );
        })
      }
    </NavGroupRow>
  );
}
