"use client";

import { useEffect, useState } from "react";
import { Receipt, Search } from "lucide-react";

import {
  useOrders,
  useDeleteOrder,
  type OrderFilters,
} from "@/hooks/use-orders";
import {
  ORDER_STATUSES,
  PAYMENT_MODES,
  TABLE_NUMBERS,
} from "@/lib/constants";
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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { OrderTable } from "@/components/orders/OrderTable";
import type { Order } from "@/types";

const ALL = "all";

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

  // Seed the payment filter from the URL on mount, so the dashboard's
  // In-progress KPI ("/orders?payment=Unpaid") lands pre-filtered to open tabs.
  // Client-only (window) — no Suspense boundary needed, runs once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("payment");
    if (p && (PAYMENT_MODES as readonly string[]).includes(p)) setPayment(p);
  }, []);

  const filters: OrderFilters = {
    status: status === ALL ? undefined : status,
    tableNo: tableNo === ALL ? undefined : tableNo,
    payment: payment === ALL ? undefined : payment,
    date: date || undefined,
    phone: phone || undefined,
  };
  const orders = useOrders(filters);
  const deleteOrder = useDeleteOrder();

  const [detail, setDetail] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState<Order | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOrder.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  const list = orders.data ?? [];
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
          options={[...TABLE_NUMBERS]}
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
      ) : orders.isError ? (
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
        <OrderTable
          orders={list}
          onView={setDetail}
          onSettle={setDetail}
          onDelete={setDeleting}
        />
      )}

      <OrderDetailSheet
        order={detail}
        onOpenChange={(o) => !o && setDetail(null)}
        onSettled={setDetail}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete order?"
        description={`${deleting?.orderId} will be permanently deleted and its customer/table effects reversed.`}
        confirmLabel="Delete"
        isLoading={deleteOrder.isPending}
        onConfirm={confirmDelete}
      />
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
