"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Tags, Loader2 } from "lucide-react";

import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/hooks/use-categories";
import { useProducts } from "@/hooks/use-products";
import { useStations } from "@/hooks/use-print-setup";
import { StationSelect } from "@/components/print/setup/StationSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { CategoryArrangeList } from "@/components/menu/CategoryArrangeList";
import { nextCategoryOrder, itemCountsByCategory } from "@/lib/category-arrange";
import { menuItemsHref } from "@/lib/menu-sections";
import type { Category } from "@/types";

export default function CategoriesPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <CategoriesPageContent />
      </MenuPageShell>
    </AdminGuard>
  );
}

function CategoriesPageContent() {
  const categories = useCategories();
  const activeProducts = useProducts();
  const archivedProducts = useProducts({ archived: true });
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Category | null>(null);
  // Printing Phase 2 Session 2D (spec §6.2, §11): the category's kitchen station; "" is the default station (it
  // follows a moved default). Every station is listed, the default too, so a category kept on the station that is the
  // default now shows as kept and can be set back to the default (the 2D gate's review, I-2).
  const { stations } = useStations();
  const defaultStation = stations.find((station) => station.isDefault);
  const [stationId, setStationId] = useState("");

  useEffect(() => {
    if (formOpen) setName(editing?.name ?? "");
  }, [formOpen, editing]);
  useEffect(() => {
    // The saved id as it is: a list still loading never turns it into "default" on save.
    if (formOpen) setStationId(editing?.stationId ?? "");
  }, [formOpen, editing]);

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

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (editing) {
        await updateCategory.mutateAsync({
          id: editing._id,
          // null: back to the default station (an absent key would leave the saved one).
          data: { name: trimmed, stationId: stationId === "" ? null : stationId },
        });
      } else {
        await createCategory.mutateAsync({ name: trimmed, order: nextCategoryOrder(list), ...(stationId !== "" ? { stationId } : {}) });
      }
      setFormOpen(false);
    } catch {
      // hook toasts on error
    }
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

  // Full ErrorState only when there is nothing on screen to keep showing
  // (R15) — a failed background refetch with data already loaded shows an
  // inline notice instead, further down.
  if (categories.isError && categories.data === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader title="Categories" eyebrow="Menu" />
        <ErrorState
          title="Couldn't load categories"
          description="Something went wrong while loading. Please try again."
          onRetry={() => categories.refetch()}
          retryLabel="Try again"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories" eyebrow="Menu"
        description={`${list.length} categor${list.length === 1 ? "y" : "ies"} · Drag a row or use the arrows — New Order and the QR menu follow this order.`}
        actions={
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add category
          </Button>
        }
      />

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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Rename category" : "Add category"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Items keep their link to this category, so the new name shows everywhere."
                : "Categories group menu items in the POS."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-2"
          >
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Beverages"
            />
            <Label htmlFor="category-station">Kitchen station</Label>
            <StationSelect
              id="category-station"
              value={stationId}
              onChange={setStationId}
              stations={stations}
              inheritLabel={`Default station (${defaultStation?.name ?? "Kitchen"})`}
            />
            <p className="text-xs text-muted-foreground">Where this category&apos;s KOTs print once printers are set up (Printer setup).</p>
            <DialogFooter className="pt-2">
              <Button type="submit" disabled={!name.trim() || createCategory.isPending || updateCategory.isPending}>
                {(createCategory.isPending || updateCategory.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editing ? "Save" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
