"use client";

import { useState } from "react";
import { LayoutGrid, Check } from "lucide-react";

import { cn, inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Order, Table } from "@/types";

// CLAUDE.md §10 table colors: Available=green, Occupied=red, Reserved=amber.
const STATUS_STYLE: Record<string, string> = {
  Available: "border-green-300 bg-green-50 text-green-700",
  Occupied: "border-red-300 bg-red-50 text-red-700",
  Reserved: "border-amber-300 bg-amber-50 text-amber-700",
};

interface TableSelectorProps {
  tables: Table[] | undefined;
  value: string | undefined;
  onChange: (tableNo: string | undefined) => void;
  // Locked while resuming an open tab — moving THAT tab's table now goes
  // through MoveTableDialog (server-CAS'd, prints a kitchen slip), not this
  // picker, which only ever writes local cart state.
  disabled?: boolean;
  tabs?: Order[]; // open, unsettled tabs — lets an occupied tile name who is sitting there
  onResume?: (order: Order) => void; // jump straight to that tab instead of picking a table
}

export function TableSelector({
  tables,
  value,
  onChange,
  disabled,
  tabs,
  onResume,
}: TableSelectorProps) {
  const [open, setOpen] = useState(false);

  const select = (tableNo: string | undefined) => {
    onChange(tableNo);
    setOpen(false);
  };

  const resume = (order: Order) => {
    onResume?.(order);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={disabled}>
          <LayoutGrid className="h-4 w-4" />
          {value ? `Table ${value}` : "Walk-In"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select table</DialogTitle>
          <DialogDescription>
            Occupied and reserved tables can&apos;t take a new order — but an
            occupied table already holding one of today&apos;s open tabs jumps
            straight to that bill.
          </DialogDescription>
        </DialogHeader>

        {/* A cafe defines its own floor plan now (CR1.1), so this list is
            unbounded — without a scroll cap a large plan pushes the dialog past
            the viewport and clips the Walk-In escape hatch off-screen. */}
        <div className="grid max-h-[60vh] grid-cols-4 gap-2 overflow-y-auto">
          {(tables ?? []).map((t) => {
            const isSelected = value === t.tableNo;
            const tab = tabs?.find((o) => o.tableNo === t.tableNo);
            // Rush friction: a red tile does nothing today. If it is holding a
            // tab we already know about, tapping it should be a shortcut to
            // that bill instead of a dead end — the operator can tell two red
            // tables apart by name+total without opening the Open-tabs list.
            const resumable = t.status === "Occupied" && !!tab && !!onResume;
            const disabled = !isSelected && !resumable && t.status !== "Available";
            return (
              <button
                key={t._id}
                type="button"
                disabled={disabled}
                onClick={() => (tab && resumable ? resume(tab) : select(t.tableNo))}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-semibold transition",
                  STATUS_STYLE[t.status],
                  disabled && "cursor-not-allowed opacity-50",
                  isSelected && "ring-2 ring-primary ring-offset-1",
                )}
              >
                {isSelected && (
                  <Check className="absolute right-1 top-1 h-3 w-3" />
                )}
                <span>{t.tableNo}</span>
                {tab && resumable ? (
                  <>
                    <span className="max-w-full truncate px-1 text-[10px] font-normal">
                      {tab.customerName}
                    </span>
                    <span className="text-[10px] font-normal">{inr(tab.total)}</span>
                  </>
                ) : (
                  <span className="text-[10px] font-normal">{t.status}</span>
                )}
                <span className="text-[9px] font-normal opacity-75">
                  {t.capacity} seats
                </span>
              </button>
            );
          })}
        </div>

        <Button
          variant={value ? "outline" : "secondary"}
          onClick={() => select(undefined)}
          className="w-full"
        >
          Walk-In (no table)
        </Button>
      </DialogContent>
    </Dialog>
  );
}
