"use client";

import { Archive as ArchiveIcon, Plus } from "lucide-react";

import type { MenuStatusFilter } from "@/lib/menu-items";
import type { ProductSort, ProductSortKey } from "@/lib/products-sort";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ItemsTable } from "@/components/menu/ItemsTable";
import { ItemCards } from "@/components/menu/ItemCards";
import { useMediaQuery, LG_UP_QUERY } from "@/hooks/use-media-query";
import type { Category, Product } from "@/types";

// R16 — a per-status message when one applies; otherwise the generic
// "No items match." (search/category filters with no status narrowing).
function emptyMatchTitle(status: MenuStatusFilter): string {
  if (status === "out-of-stock") return "Nothing is out of stock.";
  if (status === "hidden") return "No items are hidden from the QR menu.";
  return "No items match.";
}

function ListSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
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
  status: MenuStatusFilter;
  filtered: Product[];
  categoryMap: Map<string, Category>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
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

// The Items page's body: skeleton -> error -> every guided empty state (R16)
// -> the table (lg+) / cards (below lg) pair. Pulled out of the page itself
// to keep that file under its line budget.
export function ItemsListSection({
  isLoading,
  showFullError,
  onRetry,
  noCategories,
  hasProducts,
  isArchived,
  isAdmin,
  status,
  filtered,
  categoryMap,
  selected,
  onToggleSelect,
  onEdit,
  onArchive,
  onRestore,
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
  // Only the list for the current width mounts (null = unknown: both, CSS-gated).
  const wide = useMediaQuery(LG_UP_QUERY);
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
      <EmptyState
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
      <EmptyState
        icon={<ArchiveIcon className="h-8 w-8" />}
        title="No archived items"
        description="Items you archive will appear here and can be restored."
      />
    ) : (
      <EmptyState
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
      <EmptyState
        title={emptyMatchTitle(status)}
        action={
          <Button variant="outline" size="sm" className="mt-2" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }

  return (
    <>
      {wide !== false && <div className="hidden overflow-x-auto rounded-lg [contain:inline-size] lg:block">
        <ItemsTable
          products={filtered}
          archived={isArchived}
          isAdmin={isAdmin}
          categoryMap={categoryMap}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
          onToggleAvailable={onToggleAvailable}
          onToggleQrVisible={onToggleQrVisible}
          pendingAvailabilityId={pendingAvailabilityId}
          pendingQrId={pendingQrId}
          sort={sort}
          onSortChange={onSortChange}
        />
      </div>}
      {wide !== true && <div className="lg:hidden">
        <ItemCards
          products={filtered}
          archived={isArchived}
          isAdmin={isAdmin}
          categoryMap={categoryMap}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
          onToggleAvailable={onToggleAvailable}
          pendingAvailabilityId={pendingAvailabilityId}
        />
      </div>}
    </>
  );
}
