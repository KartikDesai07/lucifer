"use client";

import { memo } from "react";

import { ChefHat, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  POS_HEADER_CONTROL_CLASS,
  POS_HEADER_CHIP_FIXED_CLASS,
  POS_HEADER_CHIP_FLEX_CLASS,
  POS_HEADER_CHIP_ICON_CLASS,
} from "@/lib/pos-layout";
import { Button } from "@/components/ui/button";
import { OpenTabsButton } from "@/components/pos/OpenTabsButton";
import { TableSelector } from "@/components/pos/TableSelector";
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import type { Customer, Order, Table } from "@/types";

interface PosHeaderProps {
  lastOrder: Order | null;
  onReprintKot: () => void;
  openTabs: Order[];
  onResumeTab: (order: Order) => void;
  resumedOrder: Order | null;
  isBusy: boolean;
  onMoveTable: () => void;
  tables: Table[] | undefined;
  table: string | undefined;
  onTableChange: (tableNo: string | undefined) => void;
  customer: Customer | undefined;
  onCustomerChange: (customer: Customer | undefined) => void;
}

// The POS terminal's header action row — lifted verbatim out of pos/page.tsx
// to keep that file under the line budget. Pure props in, callbacks out; the
// page still owns every piece of state this reads or writes.
// Memoized (CB-1d.3c): the page passes latched callbacks, so its three dialog roots bail out.
export const PosHeader = memo(function PosHeader({
  lastOrder,
  onReprintKot,
  openTabs,
  onResumeTab,
  resumedOrder,
  isBusy,
  onMoveTable,
  tables,
  table,
  onTableChange,
  customer,
  onCustomerChange,
}: PosHeaderProps) {
  return (
    // One row that never wraps below xl; compact desktop row at xl+.
    <div className="flex items-center justify-between gap-2 xl:flex-wrap">
      <h2 className="hidden text-xl font-bold tracking-tight md:block">
        POS Terminal
      </h2>
      <div className="flex min-w-0 flex-1 items-center gap-2 xl:flex-none xl:flex-wrap">
        {lastOrder && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReprintKot}
            aria-label={`Print kitchen ticket for ${lastOrder.orderId}`}
            title={`Print kitchen ticket for ${lastOrder.orderId}`}
            className={cn(POS_HEADER_CONTROL_CLASS, "shrink-0")}
          >
            <ChefHat className="h-4 w-4 xl:mr-2" />
            <span className="hidden xl:inline">KOT</span>
          </Button>
        )}
        <OpenTabsButton
          tabs={openTabs}
          onResume={onResumeTab}
          className={cn(POS_HEADER_CONTROL_CLASS, "shrink-0")}
        />
        {resumedOrder ? (
          // A resumed tab no longer locks the table picker — it swaps to a
          // move: MoveTableDialog owns the whole interaction (claim the
          // destination, CAS the order, release the old table, print the
          // kitchen's slip), so re-selecting here would race that route with
          // the stolen-table bug it was written to close.
          <Button
            variant="outline"
            size="sm"
            className={cn(POS_HEADER_CONTROL_CLASS, POS_HEADER_CHIP_FIXED_CLASS, "gap-2")}
            // A walk-in tab has nothing to move FROM, and the route rejects it
            // (ORDER_NO_TABLE_ERROR) — offering the tap would only produce a
            // toast. Disabled rather than hidden so the header does not jump as
            // tabs are resumed; seating a walk-in tab is a separate decision
            // (its bill carries no table charge and none can be added later).
            // Also blocked while any order write is in flight: firing a round
            // queues a KOT print, and react-to-print keeps ONE fixed-id iframe
            // (lib/print.ts), so a move slip starting alongside that ticket can
            // delete the other job's iframe and one of the two never reaches the
            // kitchen.
            disabled={!resumedOrder.tableNo || isBusy}
            title={
              resumedOrder.tableNo
                ? `Move ${resumedOrder.orderId} to another table`
                : "This tab has no table to move"
            }
            onClick={onMoveTable}
          >
            <LayoutGrid className={POS_HEADER_CHIP_ICON_CLASS} />
            <span className="min-w-0 truncate">
              {resumedOrder.tableNo
                ? `Table ${resumedOrder.tableNo}`
                : "Walk-In"}
            </span>
          </Button>
        ) : (
          <TableSelector
            tables={tables}
            value={table}
            onChange={onTableChange}
            // Occupied tiles become a one-tap shortcut to their own bill
            // (F2) — the rush-path way to jump straight to a running tab
            // instead of hunting it in Open tabs.
            tabs={openTabs}
            onResume={onResumeTab}
            className={cn(POS_HEADER_CONTROL_CLASS, POS_HEADER_CHIP_FIXED_CLASS)}
          />
        )}
        <CustomerSearch
          value={customer}
          onChange={onCustomerChange}
          className={cn(POS_HEADER_CONTROL_CLASS, POS_HEADER_CHIP_FLEX_CLASS)}
        />
      </div>
    </div>
  );
});
