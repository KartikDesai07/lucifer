"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Search, Coffee, Upload, Archive } from "lucide-react";

import {
  useProducts,
  useArchiveProduct,
  useRestoreProduct,
  useSetProductAvailability,
} from "@/hooks/use-products";
import { useCategories } from "@/hooks/use-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProductFormSheet } from "@/components/products/ProductFormSheet";
import { ProductsTable } from "@/components/products/ProductsTable";
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

const ALL = "all";
type View = "active" | "archived";

export default function ProductsPage() {
  const [view, setView] = useState<View>("active");
  const isArchived = view === "archived";

  const products = useProducts(isArchived ? { archived: true } : {});
  const categories = useCategories();
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();
  const setAvailability = useSetProductAvailability();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiving, setArchiving] = useState<Product | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products.data ?? []).filter((p) => {
      const inCategory = category === ALL || p.category === category;
      const matches = q === "" || p.name.toLowerCase().includes(q);
      return inCategory && matches;
    });
  }, [products.data, search, category]);

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

  const hasProducts = (products.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Menu</h2>
          <p className="text-sm text-muted-foreground">
            Manage products served at the cafe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add product
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="pl-8"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(categories.data ?? []).map((c) => (
              <SelectItem key={c._id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={view} onValueChange={(v) => setView(v as View)}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {products.isLoading ? (
        <TableSkeleton />
      ) : products.isError ? (
        <p className="text-sm text-destructive">
          Failed to load products. Refresh to retry.
        </p>
      ) : !hasProducts ? (
        isArchived ? (
          <EmptyState
            icon={<Archive className="h-8 w-8" />}
            title="No archived products"
            description="Products you archive will appear here and can be restored."
          />
        ) : (
          <EmptyState
            icon={<Coffee className="h-8 w-8" />}
            title="No products yet"
            description="Add your first menu item to start taking orders."
            action={
              <Button onClick={openAdd} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Add product
              </Button>
            }
          />
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No products found"
          description="Try a different category or search term."
        />
      ) : (
        <ProductsTable
          products={filtered}
          archived={isArchived}
          onEdit={openEdit}
          onArchive={setArchiving}
          onRestore={(id) => restoreProduct.mutate(id)}
          onToggleAvailable={(id, available) =>
            setAvailability.mutate({ id, available })
          }
          restorePending={restoreProduct.isPending}
          pendingAvailabilityId={
            setAvailability.isPending ? setAvailability.variables?.id : undefined
          }
        />
      )}

      <ProductFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories.data ?? []}
      />

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title="Archive product?"
        description={`"${archiving?.name}" will be hidden from the menu. You can restore it from the Archived view.`}
        confirmLabel="Archive"
        isLoading={archiveProduct.isPending}
        onConfirm={confirmArchive}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
