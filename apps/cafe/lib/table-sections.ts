// Single source of truth for the Tables drop-down (Tables redesign, 2026-09-30).
// NO React/lucide import here — node:test suites import this file directly, as
// do the sidebar group and the three Tables pages. Mirrors lib/menu-sections.ts.
import { isActivePath } from "@/lib/nav-active";

export interface TableSection {
  title: string;
  href: string;
  // Admin-only sections are hidden from staff in the sidebar; their hrefs are
  // also in ADMIN_ROUTES (middleware) and the pages are wrapped in AdminGuard.
  adminOnly?: boolean;
}

export const TABLES_FLOOR_PATH = "/tables";
export const TABLES_SETUP_PATH = "/tables/setup";
export const TABLES_QR_PATH = "/tables/qr";

// Order here is also the sidebar sub-menu order.
export const TABLE_SECTIONS: readonly TableSection[] = [
  { title: "Floor", href: TABLES_FLOOR_PATH },
  { title: "Setup", href: TABLES_SETUP_PATH, adminOnly: true },
  { title: "QR codes", href: TABLES_QR_PATH, adminOnly: true },
];

export function isTablesPath(pathname: string): boolean {
  return pathname === TABLES_FLOOR_PATH || pathname.startsWith(`${TABLES_FLOOR_PATH}/`);
}

// The Floor row lights ONLY on /tables itself: every other section is a
// sub-path of it, so the prefix rule would light Floor on Setup and QR too.
export function isTableSectionActive(pathname: string, href: string): boolean {
  if (href === TABLES_FLOOR_PATH) return pathname === TABLES_FLOOR_PATH;
  return isActivePath(pathname, href);
}

export function visibleTableSections(isAdmin: boolean): readonly TableSection[] {
  return TABLE_SECTIONS.filter((s) => isAdmin || !s.adminOnly);
}
