"use client";

import { useState } from "react";
import { Plus, Tags } from "lucide-react";

import { useCategories } from "@/hooks/use-categories";
import { useProducts } from "@/hooks/use-products";
import { useStations } from "@/hooks/use-print-setup";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { RefreshStrip } from "@/components/shared/RefreshStrip";
import { KitchenOrderPanel } from "@/components/menu/KitchenOrderPanel";
import { CategoryDeleteDialog } from "@/components/menu/CategoryDeleteDialog";
import { CategoryEditorDialog } from "@/components/menu/CategoryEditorDialog";
import { MenuPageHeader } from "@/components/menu/MenuPageHeader";
import { MENU_LIST_SCROLLER_CLASS, MENU_PAGE_CLASS } from "@/lib/menu-layout";
import { CATEGORY_NOTE_CLASS, CATEGORY_SKELETON_CLASS } from "@/lib/menu-categories-layout";
import { MENU_STRIP_MESSAGE, categoriesHeaderLine, menuStripShows } from "@/lib/menu-view";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

export default function CategoriesPage() {
  return (
    <AdminGuard>
      <CategoriesPageContent />
    </AdminGuard>
  );
}

// The page's frame (U5 Task 1; design 5, 6.10): the Menu frame like /products, the body the page's one scroller.
const BODY_CLASS = cn(MENU_LIST_SCROLLER_CLASS, "flex-1");

function CategoriesPageContent() {
  const categories = useCategories();
  const activeProducts = useProducts();
  const archivedProducts = useProducts({ archived: true });
  // The rows' station chips: the same read the editor makes (one query key, one request).
  const { stations } = useStations();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const list = categories.data ?? [];
  const active = activeProducts.data ?? [];
  const archived = archivedProducts.data ?? [];

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (category: Category) => {
    setEditing(category);
    setFormOpen(true);
  };

  // The header's line is the Menu's on both routes (design 6.1): the active items, the categories, the sold-out ones; a
  // first-load items error leaves the shell's default line, as on the Items page.
  const headerLine = categoriesHeaderLine({ products: activeProducts, categories: list.length, categoriesLoading: categories.isLoading });
  // Full ErrorState only when there is nothing on screen to keep showing
  // (R15) — a failed background refetch with data already loaded shows the
  // shared strip instead, at the page's top.
  if (categories.isError && categories.data === undefined) {
    return (
      <div data-ui="menu-page" className={MENU_PAGE_CLASS}>
        <div data-ui="categories-body" className={BODY_CLASS}>
          {/* No actions on a first-load error, as before (the title and the default line only). */}
          <MenuPageHeader current="categories" isAdmin={false} onAdd={openAdd} />
          <ErrorState
            title="Couldn't load categories"
            description="Something went wrong while loading. Please try again."
            onRetry={() => categories.refetch()}
            retryLabel="Try again"
          />
        </div>
      </div>
    );
  }

  return (
    <div data-ui="menu-page" className={MENU_PAGE_CLASS}>
      {/* A failed or paused read with the list on screen (design 6.8; U4's pattern); Try again re-reads the list. */}
      <RefreshStrip
        ui="menu"
        show={menuStripShows({ hasData: categories.data !== undefined, isError: categories.isError, isPaused: categories.isPaused })}
        message={MENU_STRIP_MESSAGE}
        onRetry={() => void categories.refetch()}
      />
      <div data-ui="categories-body" className={BODY_CLASS}>
        {/* Admin only (the page is behind AdminGuard): the switch and Add. */}
        <MenuPageHeader current="categories" line={headerLine} isAdmin onAdd={openAdd} />

        <p data-ui="categories-note" className={CATEGORY_NOTE_CLASS}>
          Drag a row or use the arrows — New Order and the QR menu follow this order.
        </p>

        {categories.isLoading ? (
          <div className={CATEGORY_SKELETON_CLASS}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Tags className="h-8 w-8" />}
            title="No categories yet"
            description="Add your first category to group menu items."
            action={
              <Button onClick={openAdd} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Add category
              </Button>
            }
          />
        ) : (
          // The owner's KOT kitchen order (main 56fde33): the Menu order / Kitchen order switch over the same list.
          <KitchenOrderPanel
            categories={list}
            activeProducts={active}
            archivedProducts={archived}
            stations={stations}
            onEdit={openEdit}
            onDelete={setDeleting}
          />
        )}
      </div>

      <CategoryEditorDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} categories={list} />
      <CategoryDeleteDialog
        category={deleting}
        onClose={() => setDeleting(null)}
        activeProducts={activeProducts}
        archivedProducts={archivedProducts}
      />
    </div>
  );
}
