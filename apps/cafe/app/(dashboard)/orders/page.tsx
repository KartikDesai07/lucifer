"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt, Search } from "lucide-react";

import {
  useOrdersInfinite,
  useTrimOrdersListOnLeave,
  useCancelOrder,
  type OrderFilters,
} from "@/hooks/use-orders";
import { dedupeOrdersById, liveOrderOf } from "@/lib/order-query";
import { useTables } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import { ORDER_STATUSES, PAYMENT_MODES, PAY_STYLES } from "@/lib/constants";
import { cafeDateString, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/shared/DatePicker";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { BRAND_CONTROL_CLASS, BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { OrderTable } from "@/components/orders/OrderTable";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { ALL, FilterSelect, type FilterOption } from "@/components/orders/OrderFilterSelect";
import type { Order } from "@/types";

const PHONE_DEBOUNCE_MS = 350;
const SKELETON_ROWS = 6;
const POS_PATH = "/pos";

// Filter options: the value is what the list query sends, the label is the word
// the rows show (payment "Unpaid" reads "Open" on every row).
const STATUS_OPTIONS: FilterOption[] = ORDER_STATUSES.map((s) => ({ value: s, label: s }));
const PAYMENT_OPTIONS: FilterOption[] = PAYMENT_MODES.map((m) => ({ value: m, label: PAY_STYLES[m]?.label ?? m }));

export default function OrdersPage() {
  return (
    <MenuPageShell>
      <OrdersContent />
    </MenuPageShell>
  );
}

function OrdersContent() {
  const [status, setStatus] = useState(ALL);
  const [tableNo, setTableNo] = useState(ALL);
  const [payment, setPayment] = useState(ALL);
  const [date, setDate] = useState("");
  // Phone search: keep an immediate input value + a debounced filter value so we
  // don't refetch on every keystroke while typing a number.
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setPhone(phoneInput.trim()), PHONE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [phoneInput]);

  // Seed the payment, status AND date filters from the URL on mount, so the
  // dashboard's In-progress KPI ("/orders?payment=Unpaid&status=Pending") lands
  // pre-filtered to open tabs, and a report's day drill-down
  // ("/orders?date=YYYY-MM-DD") lands pre-filtered to that one day. Status is
  // read too because a cancelled tab keeps its historical "Unpaid" payment:
  // seeding payment alone would list dead tabs alongside the live ones, and the
  // list would then disagree with the KPI that was clicked (CR1.3). Client-only
  // (window), not useSearchParams (Suspense/prerender risk) — runs once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("payment");
    if (p && (PAYMENT_MODES as readonly string[]).includes(p)) setPayment(p);
    const s = params.get("status");
    if (s && (ORDER_STATUSES as readonly string[]).includes(s)) setStatus(s);
    const d = params.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
  }, []);

  const filters: OrderFilters = {
    status: status === ALL ? undefined : status,
    tableNo: tableNo === ALL ? undefined : tableNo,
    payment: payment === ALL ? undefined : payment,
    date: date || undefined,
    phone: phone || undefined,
  };
  const orders = useOrdersInfinite(filters);
  useTrimOrdersListOnLeave();
  const { isAdmin } = useAuth();
  const cancelOrder = useCancelOrder();
  const tables = useTables();
  const tableOptions: FilterOption[] = (tables.data ?? []).map((t) => ({ value: t.tableNo, label: t.tableNo }));

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

  const list = dedupeOrdersById(orders.data?.pages ?? []);
  const activeFilterCount = [status !== ALL, tableNo !== ALL, payment !== ALL, !!date, !!phone].filter(Boolean).length;
  const filtersActive = activeFilterCount > 0;

  // Clears the typed phone AND the debounced one, or the 350ms debounce would
  // leave the old search applied for a beat after the box reads empty.
  const clearFilters = () => {
    setStatus(ALL);
    setTableNo(ALL);
    setPayment(ALL);
    setDate("");
    setPhoneInput("");
    setPhone("");
  };

  return (
    <>
      <PageHeader
        eyebrow="Service"
        title="Orders"
        description="View, filter and manage orders."
        actions={
          <Button variant="outline" className={BRAND_CONTROL_CLASS} onClick={() => setDate(cafeDateString())}>
            Today
          </Button>
        }
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          inputMode="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="Search orders by customer phone…"
          className={cn("pl-8", BRAND_CONTROL_CLASS)}
          aria-label="Search orders by customer phone"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Filters</p>
        {filtersActive && <Badge variant="secondary">{activeFilterCount} active</Badge>}
        {filtersActive && (
          <Button variant="ghost" className={BRAND_CONTROL_CLASS} onClick={clearFilters}>
            Clear all
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <FilterSelect
          value={status}
          onChange={setStatus}
          allLabel="All statuses"
          ariaLabel="Filter by status"
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          value={payment}
          onChange={setPayment}
          allLabel="All payments"
          ariaLabel="Filter by payment"
          options={PAYMENT_OPTIONS}
        />
        <FilterSelect
          value={tableNo}
          onChange={setTableNo}
          allLabel="All tables"
          ariaLabel="Filter by table"
          options={tableOptions}
        />
        <DatePicker
          value={date}
          onChange={setDate}
          clearable
          placeholder="All dates"
          className={BRAND_CONTROL_CLASS}
          aria-label="Filter by date"
        />
      </div>

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
      ) : list.length === 0 ? (
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
        <>
          <OrderTable
            orders={list}
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
        </>
      )}

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
    </>
  );
}
