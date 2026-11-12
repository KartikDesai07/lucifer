"use client";

import { formatQty, stockLevel } from "@pos/shared/inventory";
import { stockBadge } from "@/lib/inventory/stock-view";
import {
  SETTINGS_HUB_ITEM_CLASS,
  SETTINGS_HUB_LIST_CLASS,
  SETTINGS_HUB_ROW_CLASS,
  SETTINGS_HUB_ROW_SUB_CLASS,
  SETTINGS_HUB_ROW_TITLE_CLASS,
} from "@/lib/settings-card-layout";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { StockItemDto } from "@/types/inventory";

const SKELETON_ROWS = 6;
const SKELETON_ROW_CLASS = "h-16 w-full rounded-none border-t border-border-2 first:border-t-0";
// An admin's row is the whole button; a staff row is plain (no hover, nothing to tap).
const BUTTON_ROW_CLASS = cn(SETTINGS_HUB_ROW_CLASS, "w-full cursor-pointer text-left");
const PLAIN_ROW_CLASS = "flex min-h-16 items-center gap-3 px-4 py-3 text-foreground";
const BADGE_CLASS = "rounded-full px-2 py-0.5 text-[12px] font-semibold";

export function StockListSkeleton() {
  return (
    <div className={SETTINGS_HUB_LIST_CLASS} aria-busy aria-label="Loading stock">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <Skeleton key={i} className={SKELETON_ROW_CLASS} />
      ))}
    </div>
  );
}

function RowBody({ item }: { item: StockItemDto }) {
  const level = stockLevel(item.qtyMilli, item.lowAtMilli);
  const badge = stockBadge(level);
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className={cn(SETTINGS_HUB_ROW_TITLE_CLASS, "truncate")}>{item.name}</div>
        {item.lowAtMilli !== undefined && <div className={SETTINGS_HUB_ROW_SUB_CLASS}>Low at {formatQty(item.lowAtMilli, item.unit)}</div>}
      </div>
      <span className={cn("shrink-0 text-[14.5px] font-semibold tabular-nums", level === "out" && "text-status-bad-ink")}>
        {formatQty(item.qtyMilli, item.unit)}
      </span>
      {badge && <span className={cn("shrink-0", BADGE_CLASS, badge.className)}>{badge.label}</span>}
    </>
  );
}

interface StockListProps {
  items: StockItemDto[];
  /** A tap on a row opens the editor (admin) or Log wastage (staff). Without it the rows are plain. */
  onOpen?: (item: StockItemDto) => void;
  /** The row button's aria-label; default "Edit Milk". */
  rowLabel?: (item: StockItemDto) => string;
}

const defaultRowLabel = (item: StockItemDto): string => `Edit ${item.name}`;

// One card of stock rows, already sorted (Out, Low, then the rest): the name and its low line on the left, how much
// is in stock and the Out / Low badge on the right.
export function StockList({ items, onOpen, rowLabel = defaultRowLabel }: StockListProps) {
  return (
    <ul className={SETTINGS_HUB_LIST_CLASS}>
      {items.map((item) => (
        <li key={item.id} className={SETTINGS_HUB_ITEM_CLASS}>
          {onOpen ? (
            <button type="button" aria-label={rowLabel(item)} className={BUTTON_ROW_CLASS} onClick={() => onOpen(item)}>
              <RowBody item={item} />
            </button>
          ) : (
            <div className={PLAIN_ROW_CLASS}>
              <RowBody item={item} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
