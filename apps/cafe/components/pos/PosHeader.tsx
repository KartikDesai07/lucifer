"use client";

import { memo } from "react";

import { ChefHat } from "lucide-react";

import { cn } from "@/lib/utils";
import { POS_HEADER_CONTROL_CLASS } from "@/lib/pos-layout";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { OpenTabsButton } from "@/components/pos/OpenTabsButton";
import { PosTableHandoff } from "@/components/pos/PosTableHandoff";
import type { Order } from "@/types";

interface PosHeaderProps {
  lastOrder: Order | null;
  onReprintKot: () => void;
  openTabs: Order[];
  onResumeTab: (order: Order) => void;
  resumedOrder: Order | null;
  isBusy: boolean;
  // The Floor hand-off below selects a table through this (the Table cell itself lives in the cart head now).
  onTableChange: (tableNo: string | undefined) => void;
}

// The POS terminal's header action row — lifted verbatim out of pos/page.tsx
// to keep that file under the line budget. Pure props in, callbacks out; the
// page still owns every piece of state this reads or writes.
// Memoized (CB-1d.3c): the page passes latched callbacks, so its dialog root bails out.
export const PosHeader = memo(function PosHeader({
  lastOrder,
  onReprintKot,
  openTabs,
  onResumeTab,
  resumedOrder,
  isBusy,
  onTableChange,
}: PosHeaderProps) {
  return (
    // One row that never wraps below xl; compact desktop row at xl+. The page's title is the page header's (U0 Task 3,
    // ruling R4; on /pos the HTML's Order header has no title block, so its h1 is read to screen readers only, U1
    // Task 1), so the row holds only the controls. The Table and Customer chips are the cart head's two cells (U1 Task 4,
    // owner Q9); the KOT reprint and Open tabs stay at the top of the menu column until U1 Task 6 moves them.
    <div className="flex items-center justify-between gap-2 xl:flex-wrap">
      <PageHeader title="POS Terminal" />
      <div className="flex min-w-0 flex-1 items-center gap-2 xl:flex-none xl:flex-wrap">
        {lastOrder && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReprintKot}
            disabled={isBusy}
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
          disabled={isBusy}
        />
      </div>
      {/* Applies the table handed over from the Tables floor; renders nothing. */}
      <PosTableHandoff resumedOrder={resumedOrder} onResume={onResumeTab} onSelect={onTableChange} />
    </div>
  );
});
