"use client";

import type { ProductBulkAction } from "@pos/shared/schemas";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BulkBar } from "@/components/menu/BulkBar";
import { MoveItemsDialog } from "@/components/menu/MoveItemsDialog";
import type { Category } from "@/types";

interface ItemsBulkSectionProps {
  count: number;
  isAdmin: boolean;
  archived: boolean;
  isPending: boolean;
  onAction: (action: ProductBulkAction) => void;
  onClear: () => void;
  categories: Category[];
  movingIds: string[] | null;
  onMoveOpenChange: (open: boolean) => void;
  onMove: () => void;
  onConfirmMove: (categoryId: string) => void;
  archivingCount: number;
  archivingOpen: boolean;
  onArchiveOpenChange: (open: boolean) => void;
  onArchive: () => void;
  onConfirmArchive: () => void;
}

// The bulk bar plus its two dialogs (Move, Archive-many) — grouped so the
// Items page only wires one component for all of it.
export function ItemsBulkSection({
  count,
  isAdmin,
  archived,
  isPending,
  onAction,
  onClear,
  categories,
  movingIds,
  onMoveOpenChange,
  onMove,
  onConfirmMove,
  archivingCount,
  archivingOpen,
  onArchiveOpenChange,
  onArchive,
  onConfirmArchive,
}: ItemsBulkSectionProps) {
  return (
    <>
      <BulkBar
        count={count}
        isAdmin={isAdmin}
        archived={archived}
        isPending={isPending}
        onAction={onAction}
        onMove={onMove}
        onArchive={onArchive}
        onClear={onClear}
      />

      <MoveItemsDialog
        open={!!movingIds}
        onOpenChange={onMoveOpenChange}
        categories={categories}
        isPending={isPending}
        onConfirm={onConfirmMove}
      />

      <ConfirmDialog
        open={archivingOpen}
        onOpenChange={onArchiveOpenChange}
        title={`Archive ${archivingCount} item${archivingCount === 1 ? "" : "s"}?`}
        description="They will be hidden from the menu. You can restore them from the Archived view."
        confirmLabel="Archive"
        isLoading={isPending}
        onConfirm={onConfirmArchive}
      />
    </>
  );
}
