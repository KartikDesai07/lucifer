"use client";

import { useState } from "react";
import { ArrowLeft, Plus, Truck } from "lucide-react";

import { SUPPLIERS_MAX } from "@pos/shared/inventory";
import { useAuth } from "@/hooks/use-auth";
import { useSuppliers, useUpdateSupplier } from "@/hooks/use-inventory";
import { dueLabel, supplierSubLine, type DueTone } from "@/lib/inventory/supplier-form";
import {
  SETTINGS_HUB_ITEM_CLASS,
  SETTINGS_HUB_LIST_CLASS,
  SETTINGS_HUB_ROW_CLASS,
  SETTINGS_HUB_ROW_SUB_CLASS,
  SETTINGS_HUB_ROW_TITLE_CLASS,
} from "@/lib/settings-card-layout";
import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS } from "@/components/brand/brand-classes";
import { AppLink } from "@/components/layout/AppLink";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplierSheet } from "@/components/inventory/SupplierSheet";
import type { SupplierDto } from "@/types/inventory";

const INVENTORY_PATH = "/inventory";
const SKELETON_ROWS = 5;
const SKELETON_ROW_CLASS = "h-16 w-full rounded-none border-t border-border-2 first:border-t-0";
const HEADER_ADD_CLASS = "h-10 w-auto shrink-0 px-4 pointer-coarse:h-11";
const ROW_BUTTON_CLASS = cn(SETTINGS_HUB_ROW_CLASS, "w-full cursor-pointer text-left");
// Red only when something is owed; paid-ahead and settled stay quiet.
const DUE_TONE_CLASS: Record<DueTone, string> = {
  owed: "text-status-bad-ink",
  ahead: "text-foreground",
  settled: "text-muted-foreground",
};

interface SheetState {
  open: boolean;
  /** Bumped on every open, so the form always starts fresh. */
  key: number;
  supplier: SupplierDto | null;
}

function SuppliersSkeleton() {
  return (
    <div className={SETTINGS_HUB_LIST_CLASS} aria-busy aria-label="Loading suppliers">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <Skeleton key={i} className={SKELETON_ROW_CLASS} />
      ))}
    </div>
  );
}

// The Suppliers screen (admin): who you buy from and what is still owed to each. Tap a row to edit or archive; adding a
// supplier is here, and a purchase picks one from the same list. Staff never reach it (ADMIN_ROUTES + the page guard),
// and the list is only fetched for an admin.
export function SuppliersView() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const list = useSuppliers(isAdmin);
  const update = useUpdateSupplier();
  const [sheet, setSheet] = useState<SheetState>({ open: false, key: 0, supplier: null });
  // The one supplier whose "Archive?" confirm is open over the editor.
  const [archiving, setArchiving] = useState<SupplierDto | null>(null);
  const data = list.data;
  const atLimit = !!data && data.length >= SUPPLIERS_MAX;

  const openAdd = () => setSheet((s) => ({ open: true, key: s.key + 1, supplier: null }));
  const openEdit = (supplier: SupplierDto) => setSheet((s) => ({ open: true, key: s.key + 1, supplier }));

  const confirmArchive = async () => {
    if (!archiving) return;
    try {
      await update.mutateAsync({ id: archiving.id, input: { archived: true } });
      setArchiving(null);
      setSheet((s) => ({ ...s, open: false }));
    } catch {
      // The hook toasts the refusal (dues must be settled first); the confirm stays open.
    }
  };

  const addButton = (className?: string) => (
    <Button type="button" onClick={openAdd} disabled={atLimit} className={cn(BRAND_BUTTON_CLASS, className)}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add supplier
    </Button>
  );

  const body = () => {
    if (authLoading || (!data && !list.isError && !list.isPaused)) return <SuppliersSkeleton />;
    if (!data) {
      return (
        <ErrorState
          title={list.isError ? "Couldn't load suppliers" : "You're offline"}
          description={list.isError ? "Something went wrong while loading. Please try again." : "Reconnect to see your suppliers."}
          onRetry={() => void list.refetch()}
          retryLabel="Try again"
        />
      );
    }
    if (data.length === 0) {
      return (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No suppliers yet"
          description="Add who you buy stock from, like your milk or vegetable supplier. Then pick them when you add a purchase, and see what you still owe."
          action={<div className="mt-2 flex w-full max-w-xs">{addButton()}</div>}
        />
      );
    }
    return (
      <>
        <ul className={SETTINGS_HUB_LIST_CLASS}>
          {data.map((supplier) => {
            const due = dueLabel(supplier.duePaise);
            const sub = supplierSubLine(supplier);
            return (
              <li key={supplier.id} className={SETTINGS_HUB_ITEM_CLASS}>
                <button type="button" aria-label={`Edit ${supplier.name}`} className={ROW_BUTTON_CLASS} onClick={() => openEdit(supplier)}>
                  <div className="min-w-0 flex-1">
                    <div className={cn(SETTINGS_HUB_ROW_TITLE_CLASS, "truncate")}>{supplier.name}</div>
                    {sub !== "" && <div className={cn(SETTINGS_HUB_ROW_SUB_CLASS, "truncate")}>{sub}</div>}
                  </div>
                  <span className={cn("shrink-0 text-[14.5px] font-semibold tabular-nums", DUE_TONE_CLASS[due.tone])}>{due.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {atLimit && <p className="text-[12.5px] text-muted-foreground">That is the most suppliers allowed. Archive one you no longer use to add another.</p>}
      </>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <AppLink
            href={INVENTORY_PATH}
            className="-ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-brand-muted hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent pointer-coarse:min-h-11"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Inventory
          </AppLink>
        }
        title="Suppliers"
        className="flex-nowrap"
        actions={data && data.length > 0 ? addButton(HEADER_ADD_CLASS) : undefined}
      />
      {body()}

      <SupplierSheet
        key={sheet.key}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        supplier={sheet.supplier}
        onArchive={setArchiving}
      />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? ""}?`}
        description="It leaves the supplier list. Past purchases keep its name. You can only archive a supplier you owe nothing to."
        confirmLabel="Archive"
        isLoading={update.isPending}
        onConfirm={confirmArchive}
      />
    </>
  );
}
