// Pure category-grouping helper extracted out of PublicMenu.tsx (S1 split —
// that file had grown past the ~300-line cap). Zero React here, same
// discipline as public-cart-math.ts: PublicMenu calls this inside a thin
// useMemo rather than owning the grouping logic inline.
import type { PublicGstConfig } from "@pos/shared/public";
import type { PublicMenuCategoryInfo, PublicMenuProduct } from "@/components/public/PublicMenuItem";

export interface PublicMenuGroup {
  name: string;
  items: PublicMenuProduct[];
}

// Grouped by category in `order`, only while browsing "All" (selectedCategory
// === allSentinel); a single selected category passes its already-filtered
// items straight through as one group. An item whose category has no entry in
// `categories` sorts LAST (Number.POSITIVE_INFINITY), never first/silently.
export function groupItemsByCategory(
  items: PublicMenuProduct[],
  selectedCategory: string,
  categories: PublicMenuCategoryInfo[],
  allSentinel: string,
): PublicMenuGroup[] {
  if (selectedCategory !== allSentinel) {
    return [{ name: selectedCategory, items }];
  }
  const categoryOrder = new Map<string, number>();
  categories.forEach((c) => categoryOrder.set(c.name, c.order));

  const byCategory = new Map<string, PublicMenuProduct[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  return [...byCategory.entries()]
    .sort(
      ([a], [b]) =>
        (categoryOrder.get(a) ?? Number.POSITIVE_INFINITY) -
        (categoryOrder.get(b) ?? Number.POSITIVE_INFINITY),
    )
    .map(([name, items]) => ({ name, items }));
}

// ── The public menu payload + its cache guard ──────────────────────────────
// The shape PublicMenu renders off, and the structural guard the cache-first
// paint validates with. Both live here rather than in PublicMenu.tsx so that
// component stays inside the ~300-line budget.
export interface PublicMenuData {
  restaurantName: string;
  // Diner-pickable-table toggle — read in PublicMenu, not a prop, to avoid a 2nd fetch.
  allowTableChange: boolean;
  // FIX1 — so the diner cart can show a tax-exclusive total matching the bill.
  gst: PublicGstConfig;
  categories: PublicMenuCategoryInfo[];
  items: PublicMenuProduct[];
}

// public-cart-store.ts stores the cached menu blob as `unknown` BY DESIGN (it
// refuses to interpret menu shape — that would couple the storage layer to a
// schema it does not own), so the CONSUMER validates before painting.
// Structural only: it checks the fields PublicMenu actually renders off, so a
// stale-but-valid payload paints instantly and a corrupt or legacy one is
// ignored rather than crashing the menu. The live fetch replaces whatever
// this admits moments later.
export function isPublicMenuData(value: unknown): value is PublicMenuData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.restaurantName === "string" &&
    typeof v.allowTableChange === "boolean" &&
    typeof v.gst === "object" &&
    v.gst !== null &&
    Array.isArray(v.categories) &&
    Array.isArray(v.items)
  );
}
