// Single source of truth for the Menu drop-down (Menu redesign, 2026-09-30).
// NO React/lucide import here — node:test suites import this file directly, as
// do the sidebar group and both Menu pages. Mirrors lib/report-sections.ts.
// URLs stay /products and /categories (inbound links and pins keep working).

export interface MenuSection {
  title: string;
  href: string;
  // Admin-only sections are hidden from staff in the sidebar; "/categories" is
  // also in ADMIN_ROUTES (middleware) and wrapped in AdminGuard.
  adminOnly?: boolean;
}

export const MENU_ITEMS_PATH = "/products";
export const MENU_CATEGORIES_PATH = "/categories";

// Order here is also the sidebar sub-menu order.
export const MENU_SECTIONS: readonly MenuSection[] = [
  { title: "Items", href: MENU_ITEMS_PATH },
  { title: "Categories", href: MENU_CATEGORIES_PATH, adminOnly: true },
];

export function isMenuPath(pathname: string): boolean {
  return MENU_SECTIONS.some((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}

export function visibleMenuSections(isAdmin: boolean): readonly MenuSection[] {
  return MENU_SECTIONS.filter((s) => isAdmin || !s.adminOnly);
}

// Items page deep links (read ONCE on mount by the Items page, validated there):
//   ?status=<MenuStatusFilter>  — e.g. the Dashboard's "N items out of stock" chip
//   ?category=<category id>     — e.g. a Categories row's "N items" count
export const MENU_STATUS_PARAM = "status";
export const MENU_CATEGORY_PARAM = "category";

export function menuItemsHref(params: { status?: string; categoryId?: string } = {}): string {
  const q = new URLSearchParams();
  if (params.status) q.set(MENU_STATUS_PARAM, params.status);
  if (params.categoryId) q.set(MENU_CATEGORY_PARAM, params.categoryId);
  const s = q.toString();
  return s ? `${MENU_ITEMS_PATH}?${s}` : MENU_ITEMS_PATH;
}
