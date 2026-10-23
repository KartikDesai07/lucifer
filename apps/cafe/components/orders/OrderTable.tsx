"use client";

import { Fragment, type ReactNode } from "react";

import { orderRowView, type AgeTone, type OrderRowView } from "@/lib/orders-row";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Order } from "@/types";

// The owner's HTML list (values 7-9, 10.3, 13; design 6.4, 6.5). The list box sits in its own container, so its form
// follows the list's own width (values 0.2 listW): the table from 700px (the Items column from 900px), else the cards.
// Both forms are drawn per row and one is hidden, as the HTML's. The list head, Load more and the offline line around
// the box: OrdersListParts.tsx.
const WRAP_CLASS = "@container";
const BOX_CLASS = "overflow-hidden rounded-[12px] border border-border bg-card";
// values 8.1's columns, except (Ruling P7) the Order and Customer columns may give way below the HTML's 150 / 110: at a
// 704px list (t820) its minimums need 712px in a 670px box and clip "Settle"; at 764px (c1280) they are 157.125 /
// 120.875 either way. With the Items column (a 900px list) the HTML's minimums always fit, so they stay.
const COLS_CLASS =
  "grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_92px_124px_92px_84px] @min-[900px]:grid-cols-[minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(140px,1.4fr)_92px_124px_92px_84px]";
const HEAD_CLASS =
  "hidden @min-[700px]:grid gap-3 border-b border-border bg-surface-2 px-4 py-2.5 text-[11px] font-semibold tracking-[.06em] uppercase text-subtle-foreground";
const HEAD_CELLS = [
  { label: "Order", className: "" },
  { label: "Customer", className: "" },
  { label: "Items", className: "hidden @min-[900px]:block" },
  { label: "Time", className: "" },
  { label: "Status", className: "" },
  { label: "Amount", className: "text-right" },
  { label: "", className: "" },
];
const ITEMS_CLASS = "hidden @min-[900px]:block min-w-0 truncate text-[13px] text-muted-foreground";
// A row (values 8.1 / 9.1): its title is a real button stretched over the row by an ::after layer, so a tap anywhere
// opens the order; "Settle" sits above that layer (no control inside another). The ring shows on the whole row.
const ROW_CLASS = "relative hidden @min-[700px]:grid cursor-pointer items-center gap-3 px-4 py-[11px]";
const CARD_CLASS = "relative flex @min-[700px]:hidden cursor-pointer flex-col gap-1.5 px-3.5 py-3";
const RULE_CLASS = "border-t border-border-2";
const OPEN_CLASS =
  "block w-full cursor-pointer text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";
const BAR_CLASS = "absolute left-0 w-[3px] rounded-r-[3px] bg-primary";
const TILE_CLASS = "flex flex-none items-center justify-center rounded-[9px] text-[12px] font-bold";
const TILE_TONE = { bill: "bg-status-bill-tint text-status-bill-ink", plain: "bg-surface-3 text-foreground" } as const;
const PILL_CLASS = "inline-flex items-center gap-1.5 rounded-[999px] font-semibold whitespace-nowrap";
const DOT_CLASS = "size-1.5 rounded-[50%]";
const STRUCK_CLASS = "text-subtle-foreground line-through";
const AGE_TONE: Record<AgeTone, string> = {
  bad: "font-semibold text-status-bad-ink",
  warn: "font-semibold text-status-warn-ink",
  plain: "font-normal text-subtle-foreground",
};
/** The row's "Settle" (values 8.1): 32px, its text centred (design 8: the HTML's top-aligned text is not copied). */
const SETTLE_CLASS =
  "relative z-[1] flex h-8 cursor-pointer items-center rounded-[8px] border border-border bg-card px-3 text-[12.5px] font-semibold whitespace-nowrap text-foreground hover:border-ink hover:bg-ink hover:text-on-ink";

const SKELETON_ROWS = 6;

interface RowProps {
  order: Order;
  view: OrderRowView;
  first: boolean;
  chosen: boolean;
  onChoose: (order: Order) => void;
}

function Pill({ ui, view, className }: { ui: string; view: OrderRowView; className: string }) {
  const kind = STATUS_CLASSES[view.status.kind];
  return (
    <span data-ui={`${ui}-pill`} className={cn(PILL_CLASS, className, kind.pill)}>
      <span data-ui={`${ui}-dot`} aria-hidden className={cn(DOT_CLASS, kind.dot)} />
      {view.status.label}
    </span>
  );
}

function TableRow({ order, view, first, chosen, onChoose }: RowProps) {
  return (
    <div data-ui="orders-row" className={cn(ROW_CLASS, COLS_CLASS, first ? "border-t-0" : RULE_CLASS, chosen ? "bg-accent" : "hover:bg-hover")}>
      {chosen && <span data-ui="orders-row-bar" aria-hidden className={cn(BAR_CLASS, "top-2 bottom-2")} />}
      <span className="flex min-w-0 items-center gap-2.5">
        <span data-ui="orders-row-tile" className={cn(TILE_CLASS, "size-9", TILE_TONE[view.codeTone])}>
          {view.code}
        </span>
        <span className="min-w-0">
          <button
            type="button"
            data-ui="orders-row-open"
            aria-label={`${view.title} ${view.number}`}
            aria-current={chosen ? "true" : undefined}
            onClick={() => onChoose(order)}
            className={OPEN_CLASS}
          >
            <span data-ui="orders-row-title" className="block truncate text-[14px] font-semibold">
              {view.title}
            </span>
          </button>
          <span data-ui="orders-row-sub" className="block truncate font-mono text-[11.5px] text-subtle-foreground">
            {view.sub}
          </span>
        </span>
      </span>
      <span className="min-w-0">
        <span data-ui="orders-row-customer" className="block truncate text-[13.5px]">
          {view.customer}
        </span>
        {view.customerSub && (
          <span data-ui="orders-row-customer-sub" className="block truncate text-[12px] text-subtle-foreground">
            {view.customerSub}
          </span>
        )}
      </span>
      <span data-ui="orders-row-items" className={ITEMS_CLASS}>
        {view.items}
      </span>
      <span className="min-w-0">
        <span data-ui="orders-row-time" className="block whitespace-nowrap text-[13px]">
          {view.time}
        </span>
        <span data-ui="orders-row-age" className={cn("block whitespace-nowrap text-[12px]", AGE_TONE[view.age.tone])}>
          {view.age.text}
        </span>
      </span>
      <span>
        <Pill ui="orders-row" view={view} className="h-6 px-[9px] text-[12px]" />
      </span>
      <span className="min-w-0 text-right">
        <span data-ui="orders-row-amount" className={cn("block font-mono text-[14px] font-semibold", view.struck && STRUCK_CLASS)}>
          {view.amount}
        </span>
        {view.dueText && (
          <span data-ui="orders-row-due" className="block text-[11.5px] font-semibold text-status-bill-ink">
            {view.dueText}
          </span>
        )}
      </span>
      <span className="flex justify-end">
        {view.settle && (
          <button
            type="button"
            data-ui="orders-row-settle"
            aria-label={`Settle ${view.title} ${view.number}`}
            onClick={() => onChoose(order)}
            className={SETTLE_CLASS}
          >
            Settle
          </button>
        )}
      </span>
    </div>
  );
}

function CardRow({ order, view, first, chosen, onChoose }: RowProps) {
  return (
    <div data-ui="orders-card" className={cn(CARD_CLASS, first ? "border-t-0" : RULE_CLASS, chosen && "bg-accent")}>
      {chosen && <span data-ui="orders-card-bar" aria-hidden className={cn(BAR_CLASS, "top-2.5 bottom-2.5")} />}
      <span data-ui="orders-card-top" className="flex min-w-0 items-center gap-2.5">
        <span data-ui="orders-card-tile" className={cn(TILE_CLASS, "size-[38px]", TILE_TONE[view.codeTone])}>
          {view.code}
        </span>
        <span className="min-w-0 flex-1">
          <button
            type="button"
            data-ui="orders-card-open"
            aria-label={`${view.title} ${view.number}`}
            aria-current={chosen ? "true" : undefined}
            onClick={() => onChoose(order)}
            className={OPEN_CLASS}
          >
            <span data-ui="orders-card-line1" className="block truncate text-[14.5px] font-semibold">
              {view.title}{" "}
              <span data-ui="orders-card-number" className="font-mono text-[11.5px] font-normal text-subtle-foreground">
                {view.number}
              </span>
            </span>
          </button>
          <span data-ui="orders-card-line2" className="block truncate text-[12.5px] text-muted-foreground">
            {`${view.customer} · ${view.items}`}
          </span>
        </span>
        <span className="flex-none text-right">
          <span data-ui="orders-card-amount" className={cn("block font-mono text-[14.5px] font-semibold", view.struck && STRUCK_CLASS)}>
            {view.amount}
          </span>
          <span data-ui="orders-card-age" className={cn("block text-[11.5px]", AGE_TONE[view.age.tone])}>
            {view.age.short}
          </span>
        </span>
      </span>
      <span data-ui="orders-card-bottom" className="flex items-center gap-2 pl-12">
        <Pill ui="orders-card" view={view} className="h-[22px] px-2 text-[11.5px]" />
        {view.dueText && (
          <span data-ui="orders-card-due" className="text-[12px] font-semibold text-status-bill-ink">
            {view.dueText}
          </span>
        )}
      </span>
    </div>
  );
}

interface OrderTableProps {
  /** The rows the list shows (laneRows). */
  orders: Order[];
  /** The page's minute tick: the open tabs' ages move with it. */
  now: Date;
  /** The chosen order (the bar, the tint, aria-current). */
  chosenId: string | null;
  /** A row (its title, anywhere on it) or its "Settle": open that order (Q6: Settle opens the detail). */
  onChoose: (order: Order) => void;
  loading: boolean;
  /** The empty box's words when no row shows. */
  empty: { title: string; text: string } | null;
  /** Our way back under the words (Clear filters). */
  emptyAction?: ReactNode;
  /** A line in the rows' place, under the table head (design 6.5: the offline line). */
  notice?: ReactNode;
}

/** The list box (values 8-9, 13): the table head (table form), then a notice, the skeleton, the empty box or the rows. */
export function OrderTable({ orders, now, chosenId, onChoose, loading, empty, emptyAction, notice }: OrderTableProps) {
  return (
    <div data-ui="orders-list-wrap" className={WRAP_CLASS}>
      <div data-ui="orders-list-box" className={BOX_CLASS}>
        <div data-ui="orders-table-head" className={cn(HEAD_CLASS, COLS_CLASS)}>
          {HEAD_CELLS.map((cell, i) => (
            <span key={i} data-ui="orders-table-head-cell" className={cell.className || undefined}>
              {cell.label}
            </span>
          ))}
        </div>
        {notice ? (
          notice
        ) : loading ? (
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div
              key={i}
              data-ui="orders-skeleton-row"
              aria-hidden
              className={cn("flex h-[90px] items-center gap-2.5 px-3.5 @min-[700px]:h-[58px] @min-[700px]:px-4", i > 0 && RULE_CLASS)}
            >
              <Skeleton className="size-[38px] flex-none rounded-[9px] @min-[700px]:size-9" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ))
        ) : orders.length === 0 ? (
          empty && (
            <div data-ui="orders-empty" className="flex flex-col items-center gap-1.5 px-4 py-14 text-center">
              <span data-ui="orders-empty-title" className="text-[14px] font-semibold">
                {empty.title}
              </span>
              <span data-ui="orders-empty-text" className="text-[13px] text-muted-foreground">
                {empty.text}
              </span>
              {emptyAction}
            </div>
          )
        ) : (
          orders.map((order, i) => {
            const view = orderRowView(order, now);
            const row = { order, view, first: i === 0, chosen: view.key === chosenId, onChoose };
            return (
              <Fragment key={view.key}>
                <TableRow {...row} />
                <CardRow {...row} />
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
