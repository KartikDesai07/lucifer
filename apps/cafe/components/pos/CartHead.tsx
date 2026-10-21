"use client";

import { useAreas } from "@/hooks/use-areas";
import { useNow } from "@/hooks/use-now";
import { cartTitle, tabMeta, tableAreaName, tableCellValue } from "@/lib/pos-cart-view";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { TableSelector } from "@/components/pos/TableSelector";
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import type { Customer, Order, Table } from "@/types";

// The cart's head in the owner's HTML (U1 Task 4; values 5.2 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.5; owner Q9): the sheet's way back, the title row (the title, a tab's "#012 · 32 min", Clear for a new
// order with items or Close for a resumed tab) and two cells — Table and Customer — that open today's dialogs. The
// HTML's "Order details" popover is left out (order type, guests and pickup are not our data, design 7).

/** The head (values 5.2): 14px 16px, its rows 12px apart, a rule under it; the HTML sets no line-height here. */
const HEAD_CLASS = "relative flex flex-none flex-col gap-3 border-b border-border px-4 py-3.5 leading-[normal]";
/** "‹ Menu" (values 5.2, the sheet below 1024px only; U1 Task 7): on top of the head at its left, 30px, no padding,
 *  15px --link at the button's own weight, the 18px chevron 2px from the word; no hover rule. */
const BACK_CLASS = "flex h-[30px] cursor-pointer items-center gap-0.5 self-start bg-transparent p-0 text-[15px] text-link";
/** The title row (values 5.2): baseline-aligned, 10px apart. 29px tall as the HTML's row with its 26px Clear, so the
 *  cells do not move when a new order's first item brings Clear in (the HTML always shows Clear). */
const TITLE_ROW_CLASS = "flex min-h-[29px] items-baseline justify-between gap-2.5";
/** The title (values 5.2): 20px 600, -.015em, one line. */
const TITLE_CLASS = "min-w-0 truncate text-[20px] font-semibold tracking-[-0.015em]";
/** A tab's meta (values 5.2): Geist Mono 12px --text-2. */
const META_CLASS = "font-mono text-[12px] text-muted-foreground";
/** Clear / Close (values 5.2 Clear): 26px, --bad-i 12.5px, 0 4px, radius 6, hover --bad-t; locked while busy. */
const HEAD_ACTION_CLASS = "h-[26px] cursor-pointer rounded-[6px] bg-transparent px-1 text-[12.5px] text-status-bad-ink not-disabled:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50";
/** The cells (values 5.2, owner Q9): a grid of two in a 1px --border frame, radius 10. */
const CELLS_CLASS = "grid grid-cols-2 overflow-hidden rounded-[10px] border border-border";
/** A cell (values 5.2): a left-aligned column, 8px 10px, line-height 1.25, the right rule the HTML draws on every cell
 *  (so its right edge is 2px, as the HTML's), hover --hover; locked while busy. */
const CELL_CLASS = "flex min-w-0 cursor-pointer flex-col items-start border-r border-border bg-transparent px-2.5 py-2 text-left leading-[1.25] text-foreground not-disabled:hover:bg-hover focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50";

/** A minute: a tab's age moves on once a minute on this device (no request). */
const MINUTE_MS = 60_000;

/** What the two cells need beyond the order on screen: the selected table and customer and their setters, the floor
 *  for the picker (and the area names), the open tabs an occupied tile jumps to, and the move / assign opener. */
export interface CartCellsProps {
  table: string | undefined;
  onTableChange: (tableNo: string | undefined) => void;
  tables: Table[] | undefined;
  openTabs: Order[];
  onResumeTab: (order: Order) => void;
  onMoveTable: () => void;
  customer: Customer | undefined;
  onCustomerChange: (customer: Customer | undefined) => void;
}

function CellText({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">{k}</span>
      <span className="w-full truncate text-[13.5px] font-semibold">{v}</span>
    </>
  );
}

function TabMeta({ order }: { order: Order }) {
  const now = useNow(MINUTE_MS);
  return (
    <span data-ui="pos-cart-meta" className={META_CLASS}>
      {now ? tabMeta(order, now) : null}
    </span>
  );
}

export function CartHead({
  hasItems,
  resumedOrder,
  isBusy = false,
  onClear,
  onCloseTab,
  onBack,
  cells,
}: {
  hasItems: boolean;
  resumedOrder: Order | null;
  isBusy?: boolean;
  onClear: () => void;
  onCloseTab?: () => void;
  // The sheet's way back below 1024px (MobileCartBar): the HTML's "‹ Menu" closes the sheet.
  onBack?: () => void;
  cells: CartCellsProps;
}) {
  // The areas list the table picker already reads (same query, 24h fresh): no request of its own.
  const areas = useAreas();
  const tableNo = resumedOrder ? resumedOrder.tableNo : cells.table;
  const tableValue = tableCellValue(tableNo, tableAreaName(tableNo, cells.tables, areas.data));
  const customer = cells.customer;
  const cellClass = cn(CELL_CLASS, BRAND_PRESS_CLASS);
  const actionClass = cn(HEAD_ACTION_CLASS, BRAND_PRESS_CLASS);

  return (
    <div data-ui="pos-cart-head" className={HEAD_CLASS}>
      {/* Its name stays "Back to menu" (the word "Menu" is in it); the chevron is decoration. */}
      {onBack && (
        <button type="button" data-ui="pos-cart-back" className={cn(BACK_CLASS, BRAND_PRESS_CLASS)} onClick={onBack} aria-label="Back to menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Menu
        </button>
      )}
      <div data-ui="pos-cart-title-row" className={TITLE_ROW_CLASS}>
        <h2 data-ui="pos-cart-title" className={TITLE_CLASS}>
          {cartTitle({ resumedOrder })}
        </h2>
        <span className="flex flex-none items-center gap-2.5">
          {resumedOrder && <TabMeta order={resumedOrder} />}
          {resumedOrder ? (
            <button type="button" data-ui="pos-cart-close" className={actionClass} onClick={onCloseTab} disabled={isBusy}>Close</button>
          ) : (
            hasItems && (
              <button type="button" data-ui="pos-cart-clear" className={actionClass} onClick={onClear} disabled={isBusy}>Clear</button>
            )
          )}
        </span>
      </div>
      <div data-ui="pos-cart-cells" className={CELLS_CLASS}>
        {resumedOrder ? (
          // A resumed tab: today's move / assign dialog (MoveTableDialog owns the whole interaction — claim the
          // destination, CAS the order, release the old table, print the kitchen's slip). Still locked while any order
          // write is in flight: react-to-print keeps ONE fixed-id iframe (lib/print.ts), so a move slip starting
          // alongside a round's ticket can delete the other job's iframe. A walk-in tab can be seated here (assign).
          <button
            type="button"
            data-ui="pos-cart-cell"
            className={cellClass}
            disabled={isBusy}
            title={
              resumedOrder.tableNo
                ? `Move ${resumedOrder.orderId} to another table`
                : `Assign a table to ${resumedOrder.orderId}`
            }
            onClick={cells.onMoveTable}
          >
            <CellText k="Table" v={tableValue} />
          </button>
        ) : (
          // A new order: today's table picker (occupied tiles with an open tab jump straight to that bill, F2).
          <TableSelector
            tables={cells.tables}
            value={cells.table}
            onChange={cells.onTableChange}
            tabs={cells.openTabs}
            onResume={cells.onResumeTab}
            trigger={
              <button
                type="button"
                data-ui="pos-cart-cell"
                className={cellClass}
                disabled={isBusy}
                aria-label={cells.table ? `Table ${cells.table}` : "Select table (Walk-In)"}
                title={cells.table ? `Table ${cells.table}` : "Walk-In — no table"}
              >
                <CellText k="Table" v={tableValue} />
              </button>
            }
          />
        )}
        <CustomerSearch
          value={customer}
          onChange={cells.onCustomerChange}
          trigger={
            <button
              type="button"
              data-ui="pos-cart-cell"
              className={cellClass}
              disabled={isBusy}
              aria-label={customer ? `Customer: ${customer.name}` : "Select customer"}
              title={customer ? customer.name : "Select customer"}
            >
              <CellText k="Customer" v={customer ? customer.name : "Add"} />
            </button>
          }
        />
      </div>
    </div>
  );
}
