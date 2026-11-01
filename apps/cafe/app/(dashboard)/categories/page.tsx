"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Tags, Loader2 } from "lucide-react";

import { useCategories, useDeleteCategory } from "@/hooks/use-categories";
import { useProducts } from "@/hooks/use-products";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { CategoryArrangeList } from "@/components/menu/CategoryArrangeList";
import { CategoryEditorDialog } from "@/components/menu/CategoryEditorDialog";
import { MenuPageHeader } from "@/components/menu/MenuPageHeader";
import { itemCountsByCategory } from "@/lib/category-arrange";
import { MENU_LIST_SCROLLER_CLASS, MENU_PAGE_CLASS } from "@/lib/menu-layout";
import { menuItemsHref } from "@/lib/menu-sections";
import { MENU_LOADING_LINE, menuHeaderCounts, menuHeaderLine } from "@/lib/menu-view";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

export default function CategoriesPage() {
  return (
    <AdminGuard>
      <CategoriesPageContent />
    </AdminGuard>
  );
}

// The page's frame (U5 Task 1; design 5, 6.10): the Menu frame like /products, the body the page's one scroller; Task 4
// restyles the rows.
const BODY_CLASS = cn(MENU_LIST_SCROLLER_CLASS, "flex-1");

function CategoriesPageContent() {
  const categories = useCategories();
  const activeProducts = useProducts();
  const archivedProducts = useProducts({ archived: true });
  const deleteCategory = useDeleteCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const list = categories.data ?? [];
  const active = activeProducts.data ?? [];
  const archived = archivedProducts.data ?? [];
  const counts = itemCountsByCategory(active, archived);
  const deletingCounts = deleting ? counts.get(deleting._id) : undefined;
  const deletingItemCount = (deletingCounts?.active ?? 0) + (deletingCounts?.archived ?? 0);
  // Until both item lists are in, the count is unknown — offer no Delete yet
  // (the server's 409 would still refuse, but the dialog must not guess).
  const countsReady = activeProducts.data !== undefined && archivedProducts.data !== undefined;
  const countsLoading = activeProducts.isLoading || archivedProducts.isLoading;
  const countsErrored = activeProducts.isError || archivedProducts.isError;
  // N6: a paused (offline) query with no data yet is neither loading nor
  // errored -- it never got an answer to fail. Without this, the dialog fell
  // through to "no items" silently, with no Delete and no explanation.
  const isPausedNoData = (q: { fetchStatus: string; data: unknown }) => q.fetchStatus === "paused" && q.data === undefined;
  const countsOffline = !countsErrored && (isPausedNoData(activeProducts) || isPausedNoData(archivedProducts));
  const refetchCounts = () => {
    activeProducts.refetch();
    archivedProducts.refetch();
  };
  // Only archived items left -> open the Items page on the Archived view,
  // where they actually are (the default view lists active items only).
  const deletingItemsHref = deleting
    ? menuItemsHref({
        categoryId: deleting._id,
        status: (deletingCounts?.active ?? 0) === 0 ? "archived" : undefined,
      })
    : "";

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (category: Category) => {
    setEditing(category);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCategory.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  // The header's line is the Menu's on both routes (design 6.1): the active items, the categories, the sold-out ones.
  const headerCounts = menuHeaderCounts(activeProducts.data);
  const headerLine = headerCounts && !categories.isLoading ? menuHeaderLine({ ...headerCounts, categories: list.length }) : MENU_LOADING_LINE;
  // Full ErrorState only when there is nothing on screen to keep showing
  // (R15) — a failed background refetch with data already loaded shows an
  // inline notice instead, further down.
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
      <div data-ui="categories-body" className={BODY_CLASS}>
        {/* Admin only (the page is behind AdminGuard): the switch and Add. */}
        <MenuPageHeader current="categories" line={headerLine} isAdmin onAdd={openAdd} />

        <p className="flex-none text-[13px] text-muted-foreground">
          Drag a row or use the arrows — New Order and the QR menu follow this order.
        </p>

        {categories.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t refresh ·{" "}
            <button type="button" className="underline" onClick={() => categories.refetch()}>
              Try again
            </button>
          </p>
        )}

        {categories.isLoading ? (
          <div className="space-y-2 rounded-lg border p-4">
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
          <CategoryArrangeList
            categories={list}
            activeProducts={active}
            archivedProducts={archived}
            onEdit={openEdit}
            onDelete={setDeleting}
          />
        )}
      </div>

      <CategoryEditorDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} categories={list} />

      {/* A category with items left can never actually delete (the server's
          409), so rather than let the operator hit that failure this dialog
          says so up front and links straight to the items instead of
          offering a Delete button that would only fail (spec: "instead of
          letting the delete fail"). ConfirmDialog's description is a plain
          string, so this case is hand-built on the same AlertDialog
          primitives it composes. */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              A category can only be deleted once it has no items. Move its items to another category first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {countsLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking items…
            </p>
          ) : countsErrored ? (
            <p className="text-sm text-destructive">
              Couldn&apos;t check this category&apos;s items ·{" "}
              <button type="button" className="underline" onClick={refetchCounts}>
                Try again
              </button>
            </p>
          ) : countsOffline ? (
            <p className="text-sm text-muted-foreground">You&apos;re offline — can&apos;t check this category&apos;s items right now.</p>
          ) : deleting && deletingItemCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              This category still has {deletingItemCount} item{deletingItemCount === 1 ? "" : "s"}.{" "}
              <Link href={deletingItemsHref} prefetch={false} className="underline">
                View {deletingItemCount === 1 ? "it" : "them"}
              </Link>
              .
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Delete stays hidden while the counts are still loading, failed,
                offline/paused (all three: we don't yet know it's safe), or
                items remain (the server would 409 anyway) — G16 + N6. */}
            {countsReady && !countsLoading && !countsErrored && !countsOffline && !(deleting && deletingItemCount > 0) && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
                disabled={deleteCategory.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteCategory.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
