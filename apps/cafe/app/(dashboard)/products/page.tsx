"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Upload } from "lucide-react";

import {
  useProducts,
  useArchiveProduct,
  useRestoreProduct,
  useSetProductAvailability,
  useSetProductQrVisibility,
  useBulkProducts,
} from "@/hooks/use-products";
import { useCategoryMap } from "@/hooks/use-category-map";
import { useAuth } from "@/hooks/use-auth";
import { MENU_STATUS_PARAM, MENU_CATEGORY_PARAM } from "@/lib/menu-sections";
import {
  isMenuStatusFilter,
  filterItems,
  statusCounts,
  type MenuStatusFilter,
} from "@/lib/menu-items";
import {
  DEFAULT_PRODUCT_SORT,
  nextProductSort,
  sortProducts,
  type ProductSort,
  type ProductSortKey,
} from "@/lib/products-sort";
import type { ProductBulkAction } from "@pos/shared/schemas";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { ItemsToolbar } from "@/components/menu/ItemsToolbar";
import { ItemsListSection } from "@/components/menu/ItemsListSection";
import { ItemsBulkSection } from "@/components/menu/ItemsBulkSection";
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

const countLabel = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ProductsPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<"active" | "archived">("active");
  const isArchived = view === "archived";

  const products = useProducts(isArchived ? { archived: true } : {});
  const { map: categoryMap, categories } = useCategoryMap();
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();
  const setAvailability = useSetProductAvailability();
  const setQrVisibility = useSetProductQrVisibility();
  const bulkProducts = useBulkProducts();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<MenuStatusFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const [movingIds, setMovingIds] = useState<string[] | null>(null);
  const [archivingIds, setArchivingIds] = useState<string[] | null>(null);
  const [sort, setSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT);

  // Read ?status= — but only once isAdmin is KNOWN (useAuth().isLoading
  // false), so a staff link to an admin-only "archived" deep link is ignored
  // rather than raced against a session that hasn't resolved yet, and an
  // admin's own link still applies once that resolution lands (not just on
  // whatever the first render happened to be).
  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get(MENU_STATUS_PARAM);
    if (!s || !isMenuStatusFilter(s)) return;
    if (s === "archived") {
      if (isAdmin) setView("archived");
      return;
    }
    setStatus(s);
  }, [authLoading, isAdmin]);

  useEffect(() => {
    if (categories.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get(MENU_CATEGORY_PARAM);
    if (c && categories.some((cat) => cat._id === c)) setCategoryId(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length > 0]);

  // Selection clears on an active/archived switch.
  useEffect(() => setSelected(new Set()), [view]);

  const filtered = useMemo(() => {
    const rows = filterItems(products.data ?? [], { search, categoryId, status: isArchived ? "all" : status });
    return sortProducts(rows, sort, categoryMap);
  }, [products.data, search, categoryId, status, isArchived, sort, categoryMap]);

  // Selection intersected with the visible rows — a filter/search change can
  // only ever shrink the checked set, never leave a phantom id behind.
  const effectiveSelected = useMemo(() => {
    const visible = new Set(filtered.map((p) => p._id));
    return new Set([...selected].filter((id) => visible.has(id)));
  }, [selected, filtered]);

  const counts = useMemo(
    () => statusCounts(products.data ?? [], search, categoryId),
    [products.data, search, categoryId],
  );

  // The ONE segmented control drives both the status filter and the
  // active/archived view (G5/G6, M1 fidelity — no separate view toggle):
  // picking "Archived" switches the query view; any other value switches
  // back to the active view with that status filter applied.
  const handleStatusChange = (next: MenuStatusFilter) => {
    if (next === "archived") {
      setView("archived");
      return;
    }
    setView("active");
    setStatus(next);
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

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
    } catch {
      // hook toasts on error
    }
  };

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
    <MenuPageShell>
      {/* flex-wrap: at 360px the admin buttons wrap below the title (measured 6px overflow). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Menu</p>
          <h1 className="text-2xl font-bold tracking-tight">Items</h1>
          <p className="text-sm text-muted-foreground">
            {countLabel(products.data?.length ?? 0, "item")} · {countLabel(categories.length, "category", "categories")}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import CSV
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          </div>
        )}
      </div>

      <ItemsToolbar
        search={search}
        onSearchChange={setSearch}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        categories={categories}
        status={isArchived ? "archived" : status}
        onStatusChange={handleStatusChange}
        counts={counts}
        isArchived={isArchived}
        isAdmin={isAdmin}
        selectMode={selectMode}
        onToggleSelectMode={() => setSelectMode((v) => !v)}
      />

      {products.isError && products.data !== undefined && (
        <p className="text-sm text-destructive">
          Couldn&apos;t refresh ·{" "}
          <button type="button" className="underline" onClick={() => products.refetch()}>
            Try again
          </button>
        </p>
      )}

      <ItemsListSection
        isLoading={products.isLoading}
        showFullError={products.isError && products.data === undefined}
        onRetry={() => products.refetch()}
        noCategories={categories.length === 0}
        hasProducts={(products.data?.length ?? 0) > 0}
        isArchived={isArchived}
        isAdmin={isAdmin}
        status={isArchived ? "all" : status}
        filtered={filtered}
        categoryMap={categoryMap}
        selected={effectiveSelected}
        onToggleSelect={toggleSelect}
        onEdit={openEdit}
        onArchive={setArchiving}
        onRestore={(p) => restoreProduct.mutate(p._id)}
        onToggleAvailable={(id, available) => setAvailability.mutate({ id, available })}
        onToggleQrVisible={(id, visible) => setQrVisibility.mutate({ id, visible })}
        pendingAvailabilityId={setAvailability.isPending ? setAvailability.variables?.id : undefined}
        pendingQrId={setQrVisibility.isPending ? setQrVisibility.variables?.id : undefined}
        selectMode={selectMode}
        sort={sort}
        onSortChange={(key: ProductSortKey) => setSort((current) => nextProductSort(current, key))}
        onAddItem={openAdd}
        onClearFilters={() => { setSearch(""); setCategoryId(null); setStatus("all"); }}
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

      <ProductFormSheet open={formOpen} onOpenChange={setFormOpen} product={editing} categories={categories} />

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
    </MenuPageShell>
  );
}
