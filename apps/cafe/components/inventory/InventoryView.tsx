"use client";

import { useState } from "react";
import { Boxes, MoreHorizontal, Plus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useStockItems, useSuppliers, useUpdateStockItem } from "@/hooks/use-inventory";
import type { StockAdjustKind } from "@/lib/inventory/stock-adjust-form";
import { sortStockItems } from "@/lib/inventory/stock-view";
import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS } from "@/components/brand/brand-classes";
import { AppLink } from "@/components/layout/AppLink";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EntryList } from "@/components/inventory/EntryList";
import { PurchaseSheet } from "@/components/inventory/PurchaseSheet";
import { StockAdjustSheet } from "@/components/inventory/StockAdjustSheet";
import { StockItemSheet } from "@/components/inventory/StockItemSheet";
import { StockList, StockListSkeleton } from "@/components/inventory/StockList";
import type { StockItemDto } from "@/types/inventory";

// The header's Add button is as wide as its label (BRAND_BUTTON_CLASS is full width); in an empty state it fills its box.
const HEADER_ADD_CLASS = "h-10 w-auto shrink-0 px-4 pointer-coarse:h-11";
const MORE_BUTTON_CLASS = "size-10 shrink-0 border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash pointer-coarse:size-11";
const MENU_ITEM_CLASS = "min-h-9 pointer-coarse:min-h-11";
const SUPPLIERS_PATH = "/inventory/suppliers";

type InventoryTab = "stock" | "history";
const TAB_OPTIONS: { value: InventoryTab; label: string }[] = [
  { value: "stock", label: "Stock" },
  { value: "history", label: "History" },
];

interface SheetState {
  open: boolean;
  /** Bumped on every open, so the form always starts fresh. */
  key: number;
  item: StockItemDto | null;
}

interface AdjustState {
  open: boolean;
  /** Bumped on every open: a fresh form and a fresh clientRef. */
  key: number;
  kind: StockAdjustKind;
  itemId?: string;
}

// The Inventory screen. Everyone sees the stock list (Out and Low first) and can log wastage; an admin also adds, edits
// and archives stock items from the sheet, adds purchases, counts stock, opens Suppliers, and reads the History of
// purchases, wastage and counts. A stock number is never typed on the item editor: it moves with sales, purchases,
// wastage and counts.
export function InventoryView() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const list = useStockItems();
  const update = useUpdateStockItem();
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [sheet, setSheet] = useState<SheetState>({ open: false, key: 0, item: null });
  const [adjust, setAdjust] = useState<AdjustState>({ open: false, key: 0, kind: "waste" });
  // Add purchase: bumped on every open for a fresh form and a fresh clientRef.
  const [purchase, setPurchase] = useState({ open: false, key: 0 });
  // The suppliers list is only fetched for an admin (the purchase sheet picks from it).
  const suppliers = useSuppliers(isAdmin);
  // The one item whose "Archive?" confirm is open over the editor.
  const [archiving, setArchiving] = useState<StockItemDto | null>(null);
  const data = list.data;
  const hasItems = !!data && data.length > 0;

  const openAdd = () => setSheet((s) => ({ open: true, key: s.key + 1, item: null }));
  const openEdit = (item: StockItemDto) => setSheet((s) => ({ open: true, key: s.key + 1, item }));
  const openPurchase = () => setPurchase((p) => ({ open: true, key: p.key + 1 }));
  const openAdjust = (kind: StockAdjustKind, itemId?: string) => setAdjust((a) => ({ open: true, key: a.key + 1, kind, itemId }));
  // From the editor: it closes, the adjust sheet opens for that item.
  const adjustFromEditor = (item: StockItemDto, kind: StockAdjustKind) => {
    setSheet((s) => ({ ...s, open: false }));
    openAdjust(kind, item.id);
  };
  const logWastageFor = (item: StockItemDto) => openAdjust("waste", item.id);

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

  const headerActions = isAdmin ? (
    <div className="flex shrink-0 items-center gap-2">
      {addButton(HEADER_ADD_CLASS)}
      {/* Not modal: its items open a sheet, and a modal menu closing under a dialog opening can leave the page locked. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More" className={MORE_BUTTON_CLASS}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className={MENU_ITEM_CLASS} disabled={!hasItems} onSelect={openPurchase}>
            Add purchase
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} disabled={!hasItems} onSelect={() => openAdjust("waste")}>
            Log wastage
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} disabled={!hasItems} onSelect={() => openAdjust("count")}>
            Count stock
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
            <AppLink href={SUPPLIERS_PATH}>Suppliers</AppLink>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : hasItems && !authLoading ? (
    <Button type="button" variant="outline" onClick={() => openAdjust("waste")} className="h-10 shrink-0 px-4 pointer-coarse:h-11">
      Log wastage
    </Button>
  ) : undefined;

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
              ? "Add what you keep in stock, like milk, sugar or packets of chips. Then open Menu, edit an item and set its Stock use."
              : "The owner adds stock items here."
          }
          action={isAdmin ? <div className="mt-2 flex w-full max-w-xs">{addButton()}</div> : undefined}
        />
      );
    }
    return (
      <StockList
        items={sortStockItems(data)}
        onOpen={isAdmin ? openEdit : logWastageFor}
        rowLabel={isAdmin ? undefined : (item) => `Log wastage for ${item.name}`}
      />
    );
  };

  return (
    <>
      <PageHeader title="Inventory" className="flex-nowrap" actions={headerActions} />
      {isAdmin && <SegmentedControl label="Inventory view" value={tab} options={TAB_OPTIONS} onChange={setTab} className="self-start" />}
      {isAdmin && tab === "history" ? <EntryList /> : body()}

      {/* Admin only: it shows the last purchase price, so a PIN switch to staff must unmount an open editor. */}
      {isAdmin && (
        <StockItemSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
          item={sheet.item}
          onArchive={setArchiving}
          onAdjust={adjustFromEditor}
        />
      )}

      {data && (
        <StockAdjustSheet
          key={adjust.key}
          open={adjust.open}
          onOpenChange={(open) => setAdjust((a) => ({ ...a, open }))}
          kind={adjust.kind}
          items={data}
          initialItemId={adjust.itemId}
        />
      )}

      {data && isAdmin && (
        <PurchaseSheet
          key={purchase.key}
          open={purchase.open}
          onOpenChange={(open) => setPurchase((p) => ({ ...p, open }))}
          items={data}
          suppliers={suppliers.data ?? []}
        />
      )}

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
