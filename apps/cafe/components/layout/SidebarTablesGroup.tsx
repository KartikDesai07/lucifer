"use client";

// The Tables (manage) row of the nav, mirroring SidebarMenuGroup.tsx. Admin only: it holds Setup and QR codes — the
// live Floor is its own row in Operate. The sections open as sub-rows in the wide form and in a flyout in the 76px
// rail (design 5.2; components/layout/nav-parts.tsx). The group owns its open state (so AppSidebar stays small): a
// manual collapse sticks while moving between Setup and QR codes, and the effect only forces it open when the route
// ENTERS the manage paths from outside.
import { useEffect, useState } from "react";
import Link from "next/link";

import { TABLES_MANAGE_SECTIONS, isTableSectionActive, isTablesManagePath } from "@/lib/table-sections";
import type { NavIcon } from "@/components/layout/nav-icons";
import { NavGroupRow, NavSubItem } from "@/components/layout/nav-parts";

interface SidebarTablesGroupProps {
  title: string;
  icon: NavIcon;
  /** The nav's current form (useNavWide): sub-rows when wide, the flyout in the rail. */
  wide: boolean;
  pathname: string;
  onNavigate: () => void;
}

export function SidebarTablesGroup({ title, icon, wide, pathname, onNavigate }: SidebarTablesGroupProps) {
  const onManage = isTablesManagePath(pathname);
  const [open, setOpen] = useState(onManage);
  useEffect(() => {
    if (onManage) setOpen(true);
  }, [onManage]);

  // Lit on ANY manage page (never on the Floor, which has its own row).
  return (
    <NavGroupRow
      title={title}
      icon={icon}
      wide={wide}
      isActive={onManage}
      open={open}
      onOpenChange={setOpen}
      subRows={(place) =>
        TABLES_MANAGE_SECTIONS.map((section) => {
          const active = isTableSectionActive(pathname, section.href);
          return (
            <NavSubItem key={section.href} place={place} isActive={active}>
              <Link href={section.href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {section.title}
              </Link>
            </NavSubItem>
          );
        })}
    />
  );
}
