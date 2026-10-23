"use client";

import { useEffect, useRef, useState } from "react";

import { useOrdersInfinite, useTrimOrdersListOnLeave, useCancelOrder } from "@/hooks/use-orders";
import { dedupeOrdersById, liveOrderOf } from "@/lib/order-query";
import { useTables } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import {
  ORDERS_BODY_CLASS,
  ORDERS_DETAIL_COLUMN_CLASS,
  ORDERS_LIST_COLUMN_CLASS,
  ORDERS_PAGE_CLASS,
  ORDERS_PHONE_QUERY,
  ORDERS_SCROLLER_CLASS,
  ORDERS_TOP_CLASS,
} from "@/lib/orders-layout";
import {
  CHIP_CLEARS,
  DEFAULT_ORDERS_FILTERS,
  clearAllFilters,
  filterChips,
  laneRows,
  ordersQuery,
  seedFromUrl,
  type OrdersFilterState,
  type OrdersLane,
} from "@/lib/orders-lanes";
import { emptyText, listHead } from "@/lib/orders-row";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { OrderTable } from "@/components/orders/OrderTable";
import {
  ORDERS_OFFLINE_CLASS,
  ORDERS_OUTLINE_BUTTON_CLASS,
  OrdersListHead,
  OrdersLoadMore,
} from "@/components/orders/OrdersListParts";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { OrdersLanes } from "@/components/orders/OrdersLanes";
import { OrdersToolbar } from "@/components/orders/OrdersToolbar";
import { OrdersChips, OrdersFiltersPanel } from "@/components/orders/OrdersFiltersPanel";
import type { Order } from "@/types";

const PHONE_DEBOUNCE_MS = 350;
/** The page's clock tick: the query's day, the Open card's 30+ min line and the rows' ages move once a minute. */
const MINUTE_TICK_MS = 60_000;

// The owner's HTML Orders screen (U2; values 1.1, 2.1, 2.2; design 5): the page fills the screen under the shell's
// header like /pos (lib/orders-layout.ts); the list column (top block over the list scroller) and, from 1280px, the
// 400px detail column. The top block holds the lanes (Task 2), the toolbar, the Filters panel and the chips (Task 3);
// the scroller the list head, the list box and Load more (Task 4); today's sheet stays until U2 Task 5.
export default function OrdersPage() {
  // One filter state (lib/orders-lanes.ts): the lane, the date, the payment, the table and the searched phone; the one
  // list query is ordersQuery's (the same GET /api/orders with today's filter keys only).
  const [filters, setFilters] = useState<OrdersFilterState>(DEFAULT_ORDERS_FILTERS);
  const setFilter = (patch: Partial<OrdersFilterState>) => setFilters((f) => ({ ...f, ...patch }));
  // Phone search: keep an immediate input value + a debounced filter value so we
  // don't refetch on every keystroke while typing a number.
  const [phoneInput, setPhoneInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const phone = phoneInput.trim();
      setFilters((f) => (f.phone === phone ? f : { ...f, phone }));
    }, PHONE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phoneInput]);

  // Seed the lane, payment AND date from the URL on mount (seedFromUrl): the dashboard's open-tabs link
  // ("?payment=Unpaid&status=Pending") lands on Open, its "?status=Cancelled" on Cancelled over every day, a report's
  // "?date=YYYY-MM-DD" on every order of that day. Client-only (window), not useSearchParams (Suspense/prerender
  // risk) — runs once; never written back.
  useEffect(() => {
    const seed = seedFromUrl(window.location.search);
    if (Object.keys(seed).length > 0) setFilters((f) => ({ ...f, ...seed }));
  }, []);

  // One clock for the page, re-read once a minute (no request): ordersQuery's key changes only when the cafe's day does,
  // so past midnight "Today" asks for the new day; the lanes' line and the rows' ages move with it.
  const now = useNow(MINUTE_TICK_MS) ?? new Date();
  const orders = useOrdersInfinite(ordersQuery(filters, now));
  useTrimOrdersListOnLeave();
  const { isAdmin } = useAuth();
  const cancelOrder = useCancelOrder();
  const tables = useTables();
  const tableNos = (tables.data ?? []).map((t) => t.tableNo);

  const [detail, setDetail] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  const confirmCancel = async (reason: string) => {
    if (!cancelling) return;
    try {
      await cancelOrder.mutateAsync({ id: cancelling._id, data: { reason } });
      setCancelling(null);
    } catch {
      // hook toasts on error
    }
  };

  // `list` is every loaded row (the sheet follows its live row); `shown` the rows the chosen lane shows (all of them
  // while a phone is typed: every lane is searched, owner Q4).
  const list = dedupeOrdersById(orders.data?.pages ?? []);
  const searching = filters.phone !== "";
  const shown = laneRows(filters.lane, list, searching);
  // The list head (values 7) counts the rows shown, once the list has loaded.
  const head = orders.data === undefined ? null : listHead(filters.lane, shown.length, orders.hasNextPage, searching);
  // Ruling P5: only the payment and the table are filters for the empty words and their way-back button (never the
  // date, the phone's date chip included; a typed phone has its own words).
  const filtersOn = Boolean(filters.payment || filters.tableNo);
  // The chips (values 6): the date one on the phone only; the Filters button's count is their number.
  const phoneWidth = useMediaQuery(ORDERS_PHONE_QUERY) === true;
  const chips = filterChips(filters, phoneWidth);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const closeFilters = (focusWasInside: boolean) => {
    setFiltersOpen(false);
    if (focusWasInside) filtersButton.current?.focus();
  };

  // Clear all and Reset (the HTML's ov.clear): the payment, the table and the typed phone AND the debounced one, or the
  // 350ms debounce would leave the old search applied for a beat after the box reads empty. The lane and the date stay.
  const clearFilters = () => {
    setPhoneInput("");
    setFilters(clearAllFilters);
  };
  // The search box's ✕: the typed and the searched phone at once (no 350ms ghost search).
  const clearSearch = () => {
    setPhoneInput("");
    setFilter({ phone: "" });
  };

  // A lane tap (design 6.2): that lane, the phone search cleared (typed and searched) and the choice dropped.
  const pickLane = (lane: OrdersLane) => {
    setPhoneInput("");
    setFilter({ lane, phone: "" });
    setDetail(null);
  };

  return (
    <div data-ui="orders-page" className={ORDERS_PAGE_CLASS}>
      <PageHeader eyebrow="Service" title="Orders" description="View, filter and manage orders." />

      <div data-ui="orders-body" className={ORDERS_BODY_CLASS}>
        <div data-ui="orders-list" className={ORDERS_LIST_COLUMN_CLASS}>
          <div data-ui="orders-top" className={ORDERS_TOP_CLASS}>
            <OrdersLanes
              filters={filters}
              rows={shown}
              more={orders.hasNextPage}
              loaded={orders.data !== undefined}
              now={now}
              onLane={pickLane}
              onChoose={setDetail}
            />
            <OrdersToolbar
              phone={phoneInput}
              onPhone={setPhoneInput}
              onClearPhone={clearSearch}
              date={filters.date}
              onDate={(date) => setFilter({ date })}
              filtersOpen={filtersOpen}
              onToggleFilters={() => setFiltersOpen((open) => !open)}
              count={chips.length}
              filtersRef={filtersButton}
            />
            {filtersOpen && (
              <OrdersFiltersPanel
                filters={filters}
                tables={tableNos}
                onChange={setFilter}
                onReset={clearFilters}
                onClose={closeFilters}
              />
            )}
            <OrdersChips chips={chips} onClear={(key) => setFilter(CHIP_CLEARS[key])} onClearAll={clearFilters} />
          </div>

          <div data-ui="orders-scroller" className={ORDERS_SCROLLER_CLASS}>
            {orders.isError && !orders.data ? (
              // A first-load failure has no pages to fall back on — this is the
              // only case that should erase the list with a full-page error.
              <ErrorState
                title="Couldn't load orders"
                description="Check the internet connection, then try again."
                onRetry={() => void orders.refetch()}
                retryLabel="Try again"
              />
            ) : (
              <>
                <OrdersListHead head={head} />
                <OrderTable
                  orders={shown}
                  now={now}
                  chosenId={detail?._id ?? null}
                  onChoose={setDetail}
                  loading={orders.isLoading}
                  // A parked (offline) query has no data AND no error — without this line the list would read as
                  // empty. It sits inside the list box, under the table head (design 6.5).
                  notice={
                    orders.isPaused && !orders.data ? (
                      <p role="status" className={ORDERS_OFFLINE_CLASS}>
                        You appear to be offline. Orders will load when the connection is back.
                      </p>
                    ) : null
                  }
                  empty={
                    shown.length === 0
                      ? emptyText({
                          lane: filters.lane,
                          searching: filters.phone,
                          filtersOn,
                          more: orders.hasNextPage,
                          loaded: list.length,
                          date: filters.date,
                        })
                      : null
                  }
                  emptyAction={
                    filtersOn && !searching ? (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className={cn("mt-2", BRAND_CONTROL_CLASS, ORDERS_OUTLINE_BUTTON_CLASS)}
                      >
                        Clear filters
                      </button>
                    ) : null
                  }
                />
                {/* Also under an empty Paid / Due list (Q10). A failed Load-more keeps every already-loaded page —
                    only an inline retry, never the full-page error, so the list stays. */}
                <OrdersLoadMore
                  more={orders.hasNextPage}
                  loading={orders.isFetchingNextPage}
                  failed={orders.isFetchNextPageError}
                  onMore={() => orders.fetchNextPage()}
                />
              </>
            )}
          </div>
        </div>
        <div data-ui="orders-detail-column" className={ORDERS_DETAIL_COLUMN_CLASS} />
      </div>

      {/* The sheet follows the live row (a tab another device grew or settled);
          it latches its own copy while paying. */}
      <OrderDetailSheet
        order={liveOrderOf(detail, list)}
        onOpenChange={(o) => !o && setDetail(null)}
        onSettled={setDetail}
      />

      {isAdmin && (
        <CancelOrderDialog
          order={cancelling}
          onOpenChange={(o) => !o && setCancelling(null)}
          onConfirm={confirmCancel}
          isPending={cancelOrder.isPending}
        />
      )}
    </div>
  );
}
