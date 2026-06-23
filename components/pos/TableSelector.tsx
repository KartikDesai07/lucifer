"use client";

import { useState } from "react";
import { LayoutGrid, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Table } from "@/types";

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
  disabled?: boolean; // locked while resuming an open tab (no table transfer)
}

export function TableSelector({ tables, value, onChange, disabled }: TableSelectorProps) {
  const [open, setOpen] = useState(false);

  const select = (tableNo: string | undefined) => {
    onChange(tableNo);
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
            Occupied and reserved tables can&apos;t take a new order.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2">
          {(tables ?? []).map((t) => {
            const isSelected = value === t.tableNo;
            const disabled = !isSelected && t.status !== "Available";
            return (
              <button
                key={t._id}
                type="button"
                disabled={disabled}
                onClick={() => select(t.tableNo)}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center rounded-lg border text-sm font-semibold transition",
                  STATUS_STYLE[t.status],
                  disabled && "cursor-not-allowed opacity-50",
                  isSelected && "ring-2 ring-primary ring-offset-1",
                )}
              >
                {isSelected && (
                  <Check className="absolute right-1 top-1 h-3 w-3" />
                )}
                <span>{t.tableNo}</span>
                <span className="text-[10px] font-normal">{t.status}</span>
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
