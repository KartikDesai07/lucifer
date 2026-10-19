"use client";

// The Menu row of the nav, mirroring SidebarReportsGroup.tsx (its own file for the same reason). Unlike Reports, Menu
// has a real hub page at its first entry (/products = Items), which staff can also open directly — so when there is
// only one VISIBLE section (staff, since Categories is adminOnly) this renders a single plain row instead of a
// drop-down (D5, a declared deviation from "drop-down for every role"). Otherwise the sections open as sub-rows in the
// wide form and in a flyout in the 76px rail (design 5.2; components/layout/nav-parts.tsx).
import Link from "next/link";

import { MENU_SECTIONS, MENU_ITEMS_PATH, isMenuPath, visibleMenuSections } from "@/lib/menu-sections";
import { isActivePath } from "@/lib/nav-active";
import type { NavIcon } from "@/components/layout/nav-icons";
import { NavGroupRow, NavItem, NavRowContent, NavSubItem } from "@/components/layout/nav-parts";

interface SidebarMenuGroupProps {
  title: string;
  icon: NavIcon;
  /** The nav's current form (useNavWide): sub-rows when wide, the flyout in the rail. */
  wide: boolean;
  pathname: string;
  isAdmin: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}

export function SidebarMenuGroup({
  title,
  icon,
  wide,
  pathname,
  isAdmin,
  menuOpen,
  onMenuOpenChange,
  onNavigate,
}: SidebarMenuGroupProps) {
  const sections = visibleMenuSections(isAdmin);
  const onMenu = isMenuPath(pathname);

  // Staff (who only ever see the one Items section): a single Link straight to
  // Items, same shape as every other flat nav row — nothing to expand. Its lit
  // state follows onMenu (G15); aria-current stays on the exact match, since
  // that is the only page this one Link actually points at.
  if (sections.length <= 1) {
    const exact = isActivePath(pathname, MENU_ITEMS_PATH);
    return (
      <NavItem isActive={onMenu}>
        <Link href={MENU_ITEMS_PATH} prefetch={false} title={title} aria-current={exact ? "page" : undefined} onClick={onNavigate}>
          <NavRowContent icon={icon} title={title} />
        </Link>
      </NavItem>
    );
  }

  return (
    <NavGroupRow title={title} icon={icon} wide={wide} isActive={onMenu} open={menuOpen} onOpenChange={onMenuOpenChange}>
      {(place) =>
        MENU_SECTIONS.filter((section) => sections.includes(section)).map((section) => {
          const active = isActivePath(pathname, section.href);
          return (
            <NavSubItem key={section.href} place={place} isActive={active}>
              <Link href={section.href} prefetch={false} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {section.title}
              </Link>
            </NavSubItem>
          );
        })
      }
    </NavGroupRow>
  );
}
