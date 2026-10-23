"use client";

import type { ListHead } from "@/lib/orders-row";

// The parts around the Orders list box (U2 Task 4; values 7; design 6.5): the list head over it, Load more under it,
// and the offline line's look (it sits inside the box, OrderTable's notice). The list box itself is OrderTable.tsx.

/** Our 40px outline buttons under and in the list (Load more, Clear filters): the HTML's Filters button look (values 4.1:
 *  radius 9, 1px --border, 13.5px 500). */
export const ORDERS_OUTLINE_BUTTON_CLASS =
  "flex h-10 cursor-pointer items-center justify-center rounded-[9px] border border-border bg-card px-4 text-[13.5px] font-medium text-foreground hover:border-subtle-foreground disabled:cursor-default disabled:opacity-60";

/** The offline line inside the list box, under the table head, in the HTML's empty style (values 13: padding 56 16,
 *  centred; design 6.5: one line, 13px --text-2). */
export const ORDERS_OFFLINE_CLASS = "px-4 py-14 text-center text-[13px] text-muted-foreground";

/** values 7: "{n} {lane} orders" (the count 600 --text) and the sort words; on Due the note under it (Q9). Before the
 *  list loads it keeps its 25px. */
export function OrdersListHead({ head }: { head: ListHead | null }) {
  if (!head) return <div data-ui="orders-list-head" aria-hidden className="h-[25px]" />;
  return (
    <>
      <div data-ui="orders-list-head" className="flex items-baseline justify-between gap-2.5 px-0.5 pb-2 text-[12.5px] text-muted-foreground">
        <span>
          <b data-ui="orders-list-head-count" className="font-semibold text-foreground">
            {head.count}
          </b>{" "}
          <span data-ui="orders-list-head-scope">{head.scope}</span>
        </span>
        <span data-ui="orders-list-head-sort">{head.right}</span>
      </div>
      {head.dueNote && (
        <p data-ui="orders-list-due-note" className="px-0.5 pb-2 text-[12.5px] text-subtle-foreground">
          Dues paid later are on the Customers page.
        </p>
      )}
    </>
  );
}

interface OrdersLoadMoreProps {
  /** More orders can be loaded (also under an empty Paid / Due list, Q10). */
  more: boolean;
  loading: boolean;
  /** The last Load more failed: the inline retry, never the full-page error. */
  failed: boolean;
  onMore: () => void;
}

/** Load more (our option, design 6.5): under the list box, centred; the error line above it. One request per tap. */
export function OrdersLoadMore({ more, loading, failed, onMore }: OrdersLoadMoreProps) {
  if (!more && !failed) return null;
  return (
    <div data-ui="orders-more" className="mt-3 flex flex-col items-center gap-2">
      {failed && (
        <p data-ui="orders-more-error" className="text-center text-[12.5px] text-status-bad-ink">
          Couldn&apos;t load more orders. Check the connection, then tap Retry.
        </p>
      )}
      {more && (
        <button type="button" data-ui="orders-more-button" onClick={onMore} disabled={loading} className={ORDERS_OUTLINE_BUTTON_CLASS}>
          {loading ? "Loading…" : failed ? "Retry" : "Load more"}
        </button>
      )}
    </div>
  );
}
