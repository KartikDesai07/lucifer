"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";

import { useOrdersInfinite, useTrimOrdersListOnLeave, useCancelOrder } from "@/hooks/use-orders";
import { dedupeOrdersById, liveOrderOf } from "@/lib/order-query";
import { useTables } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import { useMediaQuery } from "@/hooks/use-media-query";
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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { BRAND_CONTROL_CLASS, BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { OrderTable } from "@/components/orders/OrderTable";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { OrdersLanes } from "@/components/orders/OrdersLanes";
import { OrdersToolbar } from "@/components/orders/OrdersToolbar";
import { OrdersChips, OrdersFiltersPanel } from "@/components/orders/OrdersFiltersPanel";
import type { Order } from "@/types";

const PHONE_DEBOUNCE_MS = 350;
const SKELETON_ROWS = 6;
const POS_PATH = "/pos";

// The owner's HTML Orders screen (U2; values 1.1, 2.1, 2.2; design 5): the page fills the screen under the shell's
// header like /pos (lib/orders-layout.ts); the list column (top block over the list scroller) and, from 1280px, the
// 400px detail column. The top block holds the lanes (Task 2), the toolbar, the Filters panel and the chips (Task 3);
// today's list and sheet stay in the list column until U2 Tasks 4-5.
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

  const orders = useOrdersInfinite(ordersQuery(filters, new Date()));
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
  const filtersActive = [filters.payment, filters.tableNo, filters.phone].some(Boolean);
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
            {orders.isLoading ? (
              <div className={cn("space-y-2 rounded-lg border p-4", BRAND_PANEL_CLASS)}>
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : orders.isError && !orders.data ? (
              // A first-load failure has no pages to fall back on — this is the
              // only case that should erase the table with a full-page error.
              <ErrorState
                title="Couldn't load orders"
                description="Check the internet connection, then try again."
                onRetry={() => void orders.refetch()}
                retryLabel="Try again"
              />
            ) : orders.isPaused && !orders.data ? (
              // A parked (offline) query has no data AND no error — without this
              // branch the page would say "No orders yet".
              <p role="status" className="text-sm text-muted-foreground">
                You appear to be offline. Orders will load when the connection is back.
              </p>
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<Receipt className="h-8 w-8" />}
                title={filtersActive ? "No matching orders" : "No orders yet"}
                description={
                  filtersActive
                    ? "Try clearing or changing the filters."
                    : "Orders placed from New Order will appear here."
                }
                action={
                  filtersActive ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={cn("mt-2", BRAND_CONTROL_CLASS)}
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button asChild className={cn("mt-2", BRAND_CONTROL_CLASS)}>
                      <Link href={POS_PATH} prefetch={false}>
                        New order
                      </Link>
                    </Button>
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                <OrderTable
                  orders={shown}
                  onView={setDetail}
                  onSettle={setDetail}
                  onCancel={setCancelling}
                  isAdmin={isAdmin}
                />
                {/* A failed Load-more keeps every already-loaded page — flip only an
                    inline retry, never the full-page error, so the table stays. */}
                {orders.isFetchNextPageError && (
                  <p className="text-center text-sm text-destructive">
                    Couldn&apos;t load more orders. Check the connection, then tap Retry.
                  </p>
                )}
                {orders.hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      className={BRAND_CONTROL_CLASS}
                      onClick={() => orders.fetchNextPage()}
                      disabled={orders.isFetchingNextPage}
                    >
                      {orders.isFetchingNextPage
                        ? "Loading…"
                        : orders.isFetchNextPageError
                          ? "Retry"
                          : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
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
