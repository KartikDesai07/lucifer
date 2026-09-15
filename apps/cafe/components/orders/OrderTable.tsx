"use client";

import { Eye, Ban, HandCoins } from "lucide-react";

import { PAY_STYLES } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Order } from "@/types";

interface OrderTableProps {
  orders: Order[];
  onView: (order: Order) => void;
  // Open the order (an open tab is settled from its detail sheet's "Settle & Pay").
  onSettle: (order: Order) => void;
  // Admin-only break-glass replacement for the old destructive delete (CR1.3):
  // the order stays on the ledger with a reason, rather than disappearing.
  onCancel: (order: Order) => void;
  isAdmin: boolean;
}

// One row (table or phone card) needs everything the table takes EXCEPT the
// list itself.
type OrderRowProps = Omit<OrderTableProps, "orders"> & { order: Order };

// Shared by the table row and the phone card so the two branches can never
// drift apart on what "due" or "payment style" means for a given order.
function deriveOrderRow(order: Order) {
  // An open tab (Pending) isn't a "due" — payment just hasn't been taken yet.
  // Only a Completed order with a shortfall shows a due.
  const due =
    order.status === "Completed" ? order.total - order.paidAmount : 0;
  const payStyle = PAY_STYLES[order.payment];
  const preview = order.items[0]?.name ?? "";
  const more = order.items.length - 1;
  return { due, payStyle, preview, more };
}

// Colour is a reinforcement, not the only signal — the label itself always
// names the status (cafe.md palette).
function statusBadgeClass(status: Order["status"]) {
  return cn(
    status === "Pending" && "bg-amber-100 text-amber-800",
    status === "Completed" && "bg-green-100 text-green-800",
    status === "Cancelled" && "bg-gray-100 text-gray-800",
  );
}

function OrderRowActions({
  order,
  onView,
  onSettle,
  onCancel,
  isAdmin,
}: OrderRowProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onView(order)}
        aria-label="View order"
      >
        <Eye className="h-4 w-4" />
      </Button>
      {order.status === "Pending" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSettle(order)}
          aria-label="Settle order"
          title="Settle & pay"
        >
          <HandCoins className="h-4 w-4 text-indigo-600" />
        </Button>
      )}
      {isAdmin && order.status !== "Cancelled" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCancel(order)}
          aria-label="Cancel order"
          title="Cancel order"
        >
          <Ban className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </>
  );
}

function OrderRowCard({
  order,
  onView,
  onSettle,
  onCancel,
  isAdmin,
}: OrderRowProps) {
  const { due, payStyle, preview, more } = deriveOrderRow(order);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{order.orderId}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(order.createdAt)} · {order.tableNo ?? "Walk-In"}
          </div>
        </div>
        <Badge
          variant="secondary"
          className={cn("shrink-0", statusBadgeClass(order.status))}
        >
          {order.status}
        </Badge>
      </div>
      <div className="mt-2 text-sm">{order.customerName}</div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {preview}
        {more > 0 && ` +${more}`}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{inr(order.total)}</span>
          {due > 0 && (
            <span className="text-sm font-medium text-destructive">
              Due {inr(due)}
            </span>
          )}
        </div>
        <Badge variant="outline" className={cn(payStyle?.color)}>
          {payStyle?.label ?? order.payment}
        </Badge>
      </div>
      <div className="mt-2 flex justify-end gap-1 border-t pt-2">
        <OrderRowActions
          order={order}
          onView={onView}
          onSettle={onSettle}
          onCancel={onCancel}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}

export function OrderTable({
  orders,
  onView,
  onSettle,
  onCancel,
  isAdmin,
}: OrderTableProps) {
  return (
    <>
      <div className="hidden md:block">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const { due, payStyle, preview, more } = deriveOrderRow(order);
                return (
                  <TableRow key={order._id}>
                    <TableCell>
                      <div className="font-medium">{order.orderId}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)} ·{" "}
                        {order.tableNo ?? "Walk-In"}
                      </div>
                    </TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell className="max-w-[12rem] truncate text-muted-foreground">
                      {preview}
                      {more > 0 && ` +${more}`}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {inr(order.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {due > 0 ? (
                        <span className="font-medium text-destructive">
                          {inr(due)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(payStyle?.color)}>
                        {payStyle?.label ?? order.payment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={statusBadgeClass(order.status)}
                      >
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <OrderRowActions
                          order={order}
                          onView={onView}
                          onSettle={onSettle}
                          onCancel={onCancel}
                          isAdmin={isAdmin}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {orders.map((order) => (
          <OrderRowCard
            key={order._id}
            order={order}
            onView={onView}
            onSettle={onSettle}
            onCancel={onCancel}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </>
  );
}
