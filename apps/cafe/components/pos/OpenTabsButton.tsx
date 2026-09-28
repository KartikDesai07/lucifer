"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";

import { cn, inr } from "@/lib/utils";
import { POS_DIALOG_LIST_CAP_CLASS } from "@/lib/pos-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { usePendingWrites } from "@/components/layout/PendingWritesProvider";
import type { Order } from "@/types";

interface OpenTabsButtonProps {
  tabs: Order[];
  onResume: (order: Order) => void;
  // Applied to the trigger button only — the header sizes it per breakpoint.
  className?: string;
}

// Header control listing the open (Unpaid) running orders so staff can resume
// one — to add another round or settle it. Handles table tabs and walk-in tabs
// alike (a tab needn't have a table).
export function OpenTabsButton({ tabs, onResume, className }: OpenTabsButtonProps) {
  const [open, setOpen] = useState(false);
  // A tab whose settle is still being sent in the background can't be
  // resumed — shown, but shut (the resume guard in use-pos-settle-lane agrees).
  const { isSettling } = usePendingWrites();

  const resume = (order: Order) => {
    onResume(order);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Below xl the one-row header has no room for a label: icon + count
            only (the aria-label/title carry the words). */}
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-2", className)}
          aria-label={`Open tabs (${tabs.length})`}
          title={`Open tabs (${tabs.length})`}
        >
          <ClipboardList className="h-4 w-4" />
          <span className="hidden truncate xl:inline">
            Open tabs{tabs.length > 0 ? ` (${tabs.length})` : ""}
          </span>
          <span className="tabular-nums xl:hidden">{tabs.length}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open tabs</DialogTitle>
          <DialogDescription>
            Resume a running order to add items or settle it.
          </DialogDescription>
        </DialogHeader>

        {tabs.length === 0 ? (
          <EmptyState
            title="No open tabs"
            description="Orders you send to the kitchen appear here until settled."
          />
        ) : (
          <ul className={cn("space-y-2 overflow-y-auto", POS_DIALOG_LIST_CAP_CLASS)}>
            {tabs.map((t) => (
              <li key={t._id}>
                <button
                  type="button"
                  onClick={() => resume(t)}
                  disabled={isSettling(t._id)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {t.tableNo ?? "Walk-In"} · {t.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.orderId} · {t.items.length} item
                      {t.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold">
                    {isSettling(t._id) ? "Settling…" : inr(t.total)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
