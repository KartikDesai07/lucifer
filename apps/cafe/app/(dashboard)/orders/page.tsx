"use client";

import { useEffect, useState } from "react";
import { Receipt, Search } from "lucide-react";

import {
  useOrdersInfinite,
  useCancelOrder,
  type OrderFilters,
} from "@/hooks/use-orders";
import { dedupeOrdersById } from "@/lib/order-query";
import { useTables } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import { ORDER_STATUSES, PAYMENT_MODES } from "@/lib/constants";
import { cafeDateString } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { OrderTable } from "@/components/orders/OrderTable";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import type { Order } from "@/types";

// Sentinel for "no filter". Table names are free text now (CR1.1), so this must
// be a value no real table can carry — a cafe naming a table "all" would other-
// wise silently clear the filter. TABLE_NO_PATTERN requires an alphanumeric first
// character, so a leading underscore is unnameable by construction.
const ALL = "__all__";

export default function OrdersPage() {
  const [status, setStatus] = useState(ALL);
  const [tableNo, setTableNo] = useState(ALL);
  const [payment, setPayment] = useState(ALL);
  const [date, setDate] = useState("");
  // Phone search: keep an immediate input value + a debounced filter value so we
  // don't refetch on every keystroke while typing a number.
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setPhone(phoneInput.trim()), 350);
    return () => clearTimeout(t);
  }, [phoneInput]);

  // Seed the payment AND status filters from the URL on mount, so the dashboard's
  // In-progress KPI ("/orders?payment=Unpaid&status=Pending") lands pre-filtered to
  // open tabs. Status is read too because a cancelled tab keeps its historical
  // "Unpaid" payment: seeding payment alone would list dead tabs alongside the live
  // ones, and the list would then disagree with the KPI that was clicked (CR1.3).
  // Client-only (window) — no Suspense boundary needed, runs once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("payment");
    if (p && (PAYMENT_MODES as readonly string[]).includes(p)) setPayment(p);
    const s = params.get("status");
    if (s && (ORDER_STATUSES as readonly string[]).includes(s)) setStatus(s);
  }, []);

  const filters: OrderFilters = {
    status: status === ALL ? undefined : status,
    tableNo: tableNo === ALL ? undefined : tableNo,
    payment: payment === ALL ? undefined : payment,
    date: date || undefined,
    phone: phone || undefined,
  };
  const orders = useOrdersInfinite(filters);
  const { isAdmin } = useAuth();
  const cancelOrder = useCancelOrder();
  const tables = useTables();
  const tableOptions = (tables.data ?? []).map((t) => t.tableNo);

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
  const filtersActive =
    status !== ALL || tableNo !== ALL || payment !== ALL || !!date || !!phone;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Orders</h2>
          <p className="text-sm text-muted-foreground">
            View, filter, and manage orders.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDate(cafeDateString())}>
          Today
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          inputMode="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="Search orders by customer phone…"
          className="pl-8"
          aria-label="Search orders by customer phone"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FilterSelect
          value={status}
          onChange={setStatus}
          allLabel="All statuses"
          options={[...ORDER_STATUSES]}
        />
        <FilterSelect
          value={payment}
          onChange={setPayment}
          allLabel="All payments"
          options={[...PAYMENT_MODES]}
        />
        <FilterSelect
          value={tableNo}
          onChange={setTableNo}
          allLabel="All tables"
          options={tableOptions}
        />
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {orders.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : orders.isError && !orders.data ? (
        // A first-load failure has no pages to fall back on — this is the
        // only case that should erase the table with a full-page error.
        <p className="text-sm text-destructive">
          Failed to load orders. Refresh to retry.
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-8 w-8" />}
          title={filtersActive ? "No matching orders" : "No orders yet"}
          description={
            filtersActive
              ? "Try clearing or changing the filters."
              : "Orders placed from the POS will appear here."
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
              Couldn&apos;t load more orders.
            </p>
          )}
          {orders.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
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

      <OrderDetailSheet
        order={detail}
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

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
