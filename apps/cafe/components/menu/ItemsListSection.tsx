"use client";

import { Archive as ArchiveIcon, Plus, Tags, UtensilsCrossed } from "lucide-react";

import { MENU_EMPTY_SUB, menuEmptyTitle } from "@/lib/menu-view";
import { MENU_SKELETON_LIST_CLASS, MENU_SKELETON_ROW_CLASS } from "@/lib/menu-layout";
import { MENU_CARDS_SSR_CLASS, MENU_LIST_BOX_CLASS, MENU_TABLE_QUERY, MENU_TABLE_SSR_CLASS } from "@/lib/menu-list-layout";
import type { ProductSort, ProductSortKey } from "@/lib/products-sort";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { MagnifierIcon } from "@/components/menu/menu-icons";
import { MenuEmptyBox } from "@/components/menu/MenuEmptyBox";
import { ItemsTable } from "@/components/menu/ItemsTable";
import { ItemCards } from "@/components/menu/ItemCards";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Category, Product } from "@/types";

// The skeleton in the list's shape (design 6.8): the white list box (radius 12, 1px --border) of rows, each a 34px art tile
// and two lines, as Task 2's rows.
function ListSkeleton() {
  return (
    <div data-ui="menu-skeleton" aria-hidden="true" className={MENU_SKELETON_LIST_CLASS}>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className={MENU_SKELETON_ROW_CLASS}>
          <Skeleton className="size-[34px] flex-none rounded-[8px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-14 flex-none" />
        </div>
      ))}
    </div>
  );
}

interface ItemsListSectionProps {
  isLoading: boolean;
  showFullError: boolean;
  onRetry: () => void;
  noCategories: boolean;
  hasProducts: boolean;
  isArchived: boolean;
  isAdmin: boolean;
  /** The search text: the filtered empty names it (values 4.7). */
  search: string;
  filtered: Product[];
  categoryMap: Map<string, Category>;
  /** Each category's dot hue by _id (the rail's). */
  hues: Map<string, string>;
  /** A category is picked: the table has no Category column. */
  categoryPicked: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (product: Product) => void;
  onToggleAvailable: (id: string, available: boolean) => void;
  onToggleQrVisible: (id: string, visible: boolean) => void;
  pendingAvailabilityId?: string;
  pendingQrId?: string;
  selectMode: boolean;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
  onAddItem: () => void;
  onClearFilters: () => void;
}

// The Items page's body: skeleton -> error -> every guided empty state (R16) in the HTML's empty box (U5 Task 1) -> the
// table (816px and up) / cards (below) pair, one mounted. Pulled out of the page itself to keep that file under its line budget.
export function ItemsListSection({
  isLoading,
  showFullError,
  onRetry,
  noCategories,
  hasProducts,
  isArchived,
  isAdmin,
  search,
  filtered,
  categoryMap,
  hues,
  categoryPicked,
  selected,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onToggleAvailable,
  onToggleQrVisible,
  pendingAvailabilityId,
  pendingQrId,
  selectMode,
  sort,
  onSortChange,
  onAddItem,
  onClearFilters,
}: ItemsListSectionProps) {
  const wide = useMediaQuery(MENU_TABLE_QUERY);
  if (isLoading) return <ListSkeleton />;
  if (showFullError) {
    return (
      <ErrorState
        title="Couldn't load items"
        description="Something went wrong while loading the menu. Please try again."
        retryLabel="Try again"
        onRetry={onRetry}
      />
    );
  }

  if (noCategories && !isArchived) {
    return (
      <MenuEmptyBox
        icon={<Tags className="size-5" />}
        title="No categories yet"
        description={isAdmin ? "Add a category before adding items." : "Ask an admin to add items."}
        action={
          isAdmin ? (
            <Button asChild className="mt-2">
              <a href="/categories">Add a category</a>
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!hasProducts) {
    return isArchived ? (
      <MenuEmptyBox
        icon={<ArchiveIcon className="size-5" />}
        title="No archived items"
        description="Items you archive will appear here and can be restored."
      />
    ) : (
      <MenuEmptyBox
        icon={<UtensilsCrossed className="size-5" />}
        title="No items on the menu yet"
        description={isAdmin ? "Add your first menu item to start taking orders." : "Ask an admin to add them."}
        action={
          isAdmin ? (
            <Button onClick={onAddItem} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <MenuEmptyBox
        icon={<MagnifierIcon size={20} />}
        title={menuEmptyTitle(search)}
        description={MENU_EMPTY_SUB}
        action={
          <Button variant="outline" size="sm" className="mt-2" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }

  // Only the list for the current width mounts (null = unknown: both, the page box picks one).
  const gate = wide === null;
  return (
    <div data-ui="menu-list-box" className={MENU_LIST_BOX_CLASS}>
      {wide !== false && (
        <div className={gate ? MENU_TABLE_SSR_CLASS : undefined}>
          <ItemsTable
            products={filtered}
            archived={isArchived}
            isAdmin={isAdmin}
            categoryMap={categoryMap}
            hues={hues}
            categoryPicked={categoryPicked}
            selected={selected}
            onToggleSelect={onToggleSelect}
            onToggleAll={onToggleAll}
            onEdit={onEdit}
            onToggleAvailable={onToggleAvailable}
            onToggleQrVisible={onToggleQrVisible}
            pendingAvailabilityId={pendingAvailabilityId}
            pendingQrId={pendingQrId}
            sort={sort}
            onSortChange={onSortChange}
          />
        </div>
      )}
      {wide !== true && (
        <div className={gate ? MENU_CARDS_SSR_CLASS : undefined}>
          <ItemCards
            products={filtered}
            archived={isArchived}
            isAdmin={isAdmin}
            categoryMap={categoryMap}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={onToggleSelect}
            onEdit={onEdit}
            onToggleAvailable={onToggleAvailable}
            pendingAvailabilityId={pendingAvailabilityId}
          />
        </div>
      )}
    </div>
  );
}
