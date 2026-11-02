"use client";

import Link from "next/link";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { UseQueryResult } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { useDeleteCategory } from "@/hooks/use-categories";
import { itemCountsByCategory } from "@/lib/category-arrange";
import { menuItemsHref } from "@/lib/menu-sections";
import {
  CONFIRM_SHEET_BODY_CLASS,
  CONFIRM_SHEET_BUTTON_CLASS,
  CONFIRM_SHEET_DESTRUCTIVE_CLASS,
  CONFIRM_SHEET_PANEL_CLASS,
  CONFIRM_SHEET_SCRIM_CLASS,
  CONFIRM_SHEET_TITLE_CLASS,
} from "@/lib/sheet-frame";
import { cn } from "@/lib/utils";
import type { Category, Product } from "@/types";

interface CategoryDeleteDialogProps {
  /** The category being deleted; null = closed. */
  category: Category | null;
  /** Close (Cancel, Escape, and after a delete). */
  onClose: () => void;
  /** The two item lists the check reads (the page already holds them). */
  activeProducts: UseQueryResult<Product[]>;
  archivedProducts: UseQueryResult<Product[]>;
}

const CANCEL_CLASS = "border-transparent bg-surface-3 text-foreground";
const LINE_CLASS = "mt-3 text-[14px] leading-[1.5] text-muted-foreground";

// The delete check, in the HTML's confirm-sheet look (U5 Task 4; design 6.10, CONFIRM_SHEET_*): moved out of the page with its
// logic as it was. A category with items left can never actually delete (the server's 409), so rather than let the operator
// hit that failure this dialog says so up front and links straight to the items instead of offering a Delete button that
// would only fail (spec: "instead of letting the delete fail"). Four branches, in this order: checking, couldn't check,
// offline, items remain; Delete shows only when none holds (G16 + N6). The focus lands on Cancel as it opens (Radix).
export function CategoryDeleteDialog({ category: deleting, onClose, activeProducts, archivedProducts }: CategoryDeleteDialogProps) {
  const deleteCategory = useDeleteCategory();
  const counts = itemCountsByCategory(activeProducts.data ?? [], archivedProducts.data ?? []);
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

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCategory.mutateAsync({ id: deleting._id, name: deleting.name });
      onClose();
    } catch {
      // hook toasts on error
    }
  };

  return (
    <AlertDialogPrimitive.Root open={!!deleting} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay data-ui="confirm-sheet" className={CONFIRM_SHEET_SCRIM_CLASS}>
          <AlertDialogPrimitive.Content data-ui="category-delete-check" className={CONFIRM_SHEET_PANEL_CLASS}>
            <div data-ui="confirm-text">
              <AlertDialogPrimitive.Title className={CONFIRM_SHEET_TITLE_CLASS}>Delete category?</AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className={CONFIRM_SHEET_BODY_CLASS}>
                A category can only be deleted once it has no items. Move its items to another category first.
              </AlertDialogPrimitive.Description>
              {countsLoading ? (
                <p className={cn(LINE_CLASS, "flex items-center gap-2")}>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking items…
                </p>
              ) : countsErrored ? (
                <p className={cn(LINE_CLASS, "text-status-bad-ink")}>
                  Couldn&apos;t check this category&apos;s items ·{" "}
                  <button type="button" className="underline" onClick={refetchCounts}>
                    Try again
                  </button>
                </p>
              ) : countsOffline ? (
                <p className={LINE_CLASS}>You&apos;re offline — can&apos;t check this category&apos;s items right now.</p>
              ) : deleting && deletingItemCount > 0 ? (
                <p className={LINE_CLASS}>
                  This category still has {deletingItemCount} item{deletingItemCount === 1 ? "" : "s"}.{" "}
                  <Link href={deletingItemsHref} prefetch={false} className="underline">
                    View {deletingItemCount === 1 ? "it" : "them"}
                  </Link>
                  .
                </p>
              ) : null}
            </div>
            <div data-ui="confirm-buttons" className="flex flex-col gap-2">
              {/* Delete stays hidden while the counts are still loading, failed,
                  offline/paused (all three: we don't yet know it's safe), or
                  items remain (the server would 409 anyway) — G16 + N6. */}
              {countsReady && !countsLoading && !countsErrored && !countsOffline && !(deleting && deletingItemCount > 0) && (
                <AlertDialogPrimitive.Action
                  data-ui="confirm-action"
                  onClick={(e) => {
                    e.preventDefault();
                    confirmDelete();
                  }}
                  disabled={deleteCategory.isPending}
                  className={cn(CONFIRM_SHEET_BUTTON_CLASS, CONFIRM_SHEET_DESTRUCTIVE_CLASS, BRAND_PRESS_CLASS)}
                >
                  {deleteCategory.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </AlertDialogPrimitive.Action>
              )}
              <AlertDialogPrimitive.Cancel
                data-ui="confirm-cancel"
                className={cn(CONFIRM_SHEET_BUTTON_CLASS, CANCEL_CLASS, BRAND_PRESS_CLASS)}
              >
                Cancel
              </AlertDialogPrimitive.Cancel>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
