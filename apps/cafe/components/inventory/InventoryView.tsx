"use client";

import { useState } from "react";
import { Boxes, Plus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useStockItems, useUpdateStockItem } from "@/hooks/use-inventory";
import { sortStockItems } from "@/lib/inventory/stock-view";
import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS } from "@/components/brand/brand-classes";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { StockItemSheet } from "@/components/inventory/StockItemSheet";
import { StockList, StockListSkeleton } from "@/components/inventory/StockList";
import type { StockItemDto } from "@/types/inventory";

// The header's Add button is as wide as its label (BRAND_BUTTON_CLASS is full width); in an empty state it fills its box.
const HEADER_ADD_CLASS = "h-10 w-auto shrink-0 px-4 pointer-coarse:h-11";

interface SheetState {
  open: boolean;
  /** Bumped on every open, so the form always starts fresh. */
  key: number;
  item: StockItemDto | null;
}

// The Inventory screen. Everyone sees the stock list (Out and Low first); an admin also adds, edits and archives
// stock items from the sheet. A stock number is never typed here: it moves with sales (and later wastage and counts).
export function InventoryView() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const list = useStockItems();
  const update = useUpdateStockItem();
  const [sheet, setSheet] = useState<SheetState>({ open: false, key: 0, item: null });
  // The one item whose "Archive?" confirm is open over the editor.
  const [archiving, setArchiving] = useState<StockItemDto | null>(null);
  const data = list.data;

  const openAdd = () => setSheet((s) => ({ open: true, key: s.key + 1, item: null }));
  const openEdit = (item: StockItemDto) => setSheet((s) => ({ open: true, key: s.key + 1, item }));

  const confirmArchive = async () => {
    if (!archiving) return;
    try {
      await update.mutateAsync({ id: archiving.id, input: { archived: true } });
      setArchiving(null);
      setSheet((s) => ({ ...s, open: false }));
    } catch {
      // The hook toasts the refusal; the confirm stays open.
    }
  };

  const addButton = (className?: string) => (
    <Button type="button" onClick={openAdd} className={cn(BRAND_BUTTON_CLASS, className)}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add stock item
    </Button>
  );

  const body = () => {
    if (authLoading || (!data && !list.isError && !list.isPaused)) return <StockListSkeleton />;
    if (!data) {
      return (
        <ErrorState
          title={list.isError ? "Couldn't load stock" : "You're offline"}
          description={list.isError ? "Something went wrong while loading. Please try again." : "Reconnect to see your stock."}
          onRetry={() => void list.refetch()}
          retryLabel="Try again"
        />
      );
    }
    if (data.length === 0) {
      return (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="No stock items yet"
          description={
            isAdmin
              ? "Add what you keep in stock, like milk, sugar or packets of chips, and how much you have now."
              : "The owner adds stock items here."
          }
          action={isAdmin ? <div className="mt-2 flex w-full max-w-xs">{addButton()}</div> : undefined}
        />
      );
    }
    return <StockList items={sortStockItems(data)} onOpen={isAdmin ? openEdit : undefined} />;
  };

  return (
    <>
      <PageHeader title="Inventory" className="flex-nowrap" actions={isAdmin ? addButton(HEADER_ADD_CLASS) : undefined} />
      {body()}

      <StockItemSheet
        key={sheet.key}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        item={sheet.item}
        onArchive={setArchiving}
      />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? ""}?`}
        description="It leaves the stock list. Settled bills don't change."
        confirmLabel="Archive"
        isLoading={update.isPending}
        onConfirm={confirmArchive}
      />
    </>
  );
}
