"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";

import {
  useArchiveProduct,
  useRestoreProduct,
  useSetProductAvailability,
  useSetProductQrVisibility,
  useBulkProducts,
} from "@/hooks/use-products";
import { useAuth } from "@/hooks/use-auth";
import { useItemsPageState } from "@/hooks/use-items-page-state";
import { menuStripShows, MENU_STRIP_MESSAGE } from "@/lib/menu-view";
import { categoryHueMap } from "@/lib/pos-categories";
import { MENU_BODY_CLASS, MENU_LIST_SCROLLER_CLASS, MENU_PAGE_CLASS } from "@/lib/menu-layout";
import type { ProductBulkAction } from "@pos/shared/schemas";
import { RefreshStrip } from "@/components/shared/RefreshStrip";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CategoryRail } from "@/components/menu/CategoryRail";
import { ItemsToolbar } from "@/components/menu/ItemsToolbar";
import { ItemsTitleRow } from "@/components/menu/ItemsTitleRow";
import { ItemsListSection } from "@/components/menu/ItemsListSection";
import { ItemsBulkSection } from "@/components/menu/ItemsBulkSection";
import { MenuPageHeader } from "@/components/menu/MenuPageHeader";
import { ProductFormSheet } from "@/components/products/ProductFormSheet";
import type { Product } from "@/types";

// PapaParse (~45 kB) lives inside this dialog — keep it out of the page's
// initial bundle (loaded only when the import wizard is used).
const ImportProductsDialog = dynamic(
  () =>
    import("@/components/products/ImportProductsDialog").then(
      (m) => m.ImportProductsDialog,
    ),
  { ssr: false },
);

export default function ProductsPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  // The view, the query, the filters, the selection and the derived rows and counts (U5 ruling M1: their own hook).
  const state = useItemsPageState({ isAdmin, authLoading });
  const { isArchived, products, categoryMap, categories, categoryId, status, effectiveSelected, clearSelection } = state;
  const setAvailability = useSetProductAvailability();
  const setQrVisibility = useSetProductQrVisibility();
  const bulkProducts = useBulkProducts();
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();

  const hues = useMemo(() => categoryHueMap(categories), [categories]);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [movingIds, setMovingIds] = useState<string[] | null>(null);
  const [archivingIds, setArchivingIds] = useState<string[] | null>(null);
  // The one item whose "Archive item?" confirm is open over the editor (Archive item lives in the editor, design 6.9).
  const [archiving, setArchiving] = useState<Product | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (product: Product) => {
    setEditing(product);
    setFormOpen(true);
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    try {
      await archiveProduct.mutateAsync(archiving._id);
      setArchiving(null);
      // The item leaves this view (the HTML closes the editor on Archive / Restore, values 9.2 #6).
      setFormOpen(false);
    } catch {
      // hook toasts on error
    }
  };

  // Restore fires at once, as the old row menu did (no confirm); the editor closes when it worked.
  const restoreItem = (product: Product) => restoreProduct.mutate(product._id, { onSuccess: () => setFormOpen(false) });

  // Bulk actions: the two stock toggles + restore fire straight away; move
  // and archive open a confirming dialog first (BulkBar's onAction never
  // receives "move" or "archive" — those use its own onMove/onArchive).
  const runBulk = (action: ProductBulkAction) => {
    const ids = Array.from(effectiveSelected);
    if (ids.length === 0) return;
    if (action === "out-of-stock" || action === "in-stock" || action === "restore") {
      bulkProducts.mutate({ action, ids }, { onSuccess: clearSelection });
    }
  };

  const confirmBulkArchive = () => {
    if (!archivingIds) return;
    bulkProducts.mutate(
      { action: "archive", ids: archivingIds },
      { onSuccess: () => { clearSelection(); setArchivingIds(null); } },
    );
  };

  const confirmMove = (targetCategoryId: string) => {
    if (!movingIds) return;
    bulkProducts.mutate(
      { action: "move", ids: movingIds, categoryId: targetCategoryId },
      { onSuccess: () => { clearSelection(); setMovingIds(null); } },
    );
  };

  return (
    <div data-ui="menu-page" className={MENU_PAGE_CLASS}>
      {/* A failed or paused read with the list on screen: the shared strip at the page's top (design 6.8; U4's pattern). */}
      <RefreshStrip
        ui="menu"
        show={menuStripShows({ hasData: products.data !== undefined, isError: products.isError, isPaused: products.isPaused })}
        message={MENU_STRIP_MESSAGE}
        onRetry={() => void products.refetch()}
      />
      <div data-ui="menu-body" className={MENU_BODY_CLASS}>
        <CategoryRail
          categories={categories}
          counts={state.categoryTotals.byId}
          allCount={state.categoryTotals.all}
          allSoldOut={state.categoryTotals.allSoldOut}
          selectedId={categoryId}
          onSelect={state.pickCategory}
        />
        <div data-ui="menu-list" className={MENU_LIST_SCROLLER_CLASS}>
          <MenuPageHeader current="items" line={state.headerLine} isAdmin={isAdmin} onAdd={openAdd} />

          <ItemsToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            categoryId={categoryId}
            onCategoryChange={state.pickCategory}
            categories={categories}
            categoryCounts={state.categoryTotals}
            status={isArchived ? "archived" : status}
            onStatusChange={state.handleStatusChange}
            counts={state.counts}
            isArchived={isArchived}
            isAdmin={isAdmin}
            selectMode={state.selectMode}
            onToggleSelectMode={state.toggleSelectMode}
            onImport={() => setImportOpen(true)}
          />

          {products.data !== undefined && (
            <ItemsTitleRow
              title={(categoryId && categoryMap.get(categoryId)?.name) || "All items"}
              count={state.filtered.length}
              filter={isArchived ? "archived" : status}
            />
          )}

          <ItemsListSection
            isLoading={products.isLoading}
            showFullError={products.isError && products.data === undefined}
            onRetry={() => products.refetch()}
            noCategories={categories.length === 0}
            hasProducts={(products.data?.length ?? 0) > 0}
            isArchived={isArchived}
            isAdmin={isAdmin}
            search={state.search}
            filtered={state.filtered}
            categoryMap={categoryMap}
            selected={effectiveSelected}
            hues={hues}
            categoryPicked={categoryId !== null}
            onToggleSelect={state.toggleSelect}
            onToggleAll={state.toggleSelectAll}
            onEdit={openEdit}
            onToggleAvailable={(id, available) => setAvailability.mutate({ id, available })}
            onToggleQrVisible={(id, visible) => setQrVisibility.mutate({ id, visible })}
            pendingAvailabilityId={setAvailability.isPending ? setAvailability.variables?.id : undefined}
            pendingQrId={setQrVisibility.isPending ? setQrVisibility.variables?.id : undefined}
            selectMode={state.selectMode}
            sort={state.sort}
            onSortChange={state.changeSort}
            onAddItem={openAdd}
            onClearFilters={state.clearFilters}
          />

          <ItemsBulkSection
            count={effectiveSelected.size}
            isAdmin={isAdmin}
            archived={isArchived}
            isPending={bulkProducts.isPending}
            onAction={runBulk}
            onClear={clearSelection}
            categories={categories}
            movingIds={movingIds}
            onMoveOpenChange={(o) => !o && setMovingIds(null)}
            onMove={() => setMovingIds(Array.from(effectiveSelected))}
            onConfirmMove={confirmMove}
            archivingCount={archivingIds?.length ?? 0}
            archivingOpen={!!archivingIds}
            onArchiveOpenChange={(o) => !o && setArchivingIds(null)}
            onArchive={() => setArchivingIds(Array.from(effectiveSelected))}
            onConfirmArchive={confirmBulkArchive}
          />
        </div>
      </div>

      <ProductFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
        onArchive={setArchiving}
        onRestore={restoreItem}
        restoring={restoreProduct.isPending}
      />

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title="Archive item?"
        description={`"${archiving?.name}" will be hidden from the menu. You can restore it from the Archived view.`}
        confirmLabel="Archive"
        isLoading={archiveProduct.isPending}
        onConfirm={confirmArchive}
      />
    </div>
  );
}
