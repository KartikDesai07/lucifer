"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";

import { inr } from "@/lib/utils";
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
import type { Order } from "@/types";

interface OpenTabsButtonProps {
  tabs: Order[];
  onResume: (order: Order) => void;
}

// Header control listing the open (Unpaid) running orders so staff can resume
// one — to add another round or settle it. Handles table tabs and walk-in tabs
// alike (a tab needn't have a table).
export function OpenTabsButton({ tabs, onResume }: OpenTabsButtonProps) {
  const [open, setOpen] = useState(false);

  const resume = (order: Order) => {
    onResume(order);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ClipboardList className="h-4 w-4" />
          Open tabs{tabs.length > 0 ? ` (${tabs.length})` : ""}
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
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {tabs.map((t) => (
              <li key={t._id}>
                <button
                  type="button"
                  onClick={() => resume(t)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/60"
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
                    {inr(t.total)}
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
