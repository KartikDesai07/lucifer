"use client";

import { Eye, Trash2, HandCoins } from "lucide-react";

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
  onDelete: (order: Order) => void;
}

export function OrderTable({
  orders,
  onView,
  onSettle,
  onDelete,
}: OrderTableProps) {
  return (
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
            // An open tab (Pending) isn't a "due" — payment just hasn't been
            // taken yet. Only a Completed order with a shortfall shows a due.
            const due =
              order.status === "Completed" ? order.total - order.paidAmount : 0;
            const payStyle = PAY_STYLES[order.payment];
            const preview = order.items[0]?.name ?? "";
            const more = order.items.length - 1;
            return (
              <TableRow key={order._id}>
                <TableCell>
                  <div className="font-medium">{order.orderId}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(order.createdAt)} · {order.tableNo ?? "Walk-In"}
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
                    className={cn(
                      order.status === "Pending" &&
                        "bg-amber-100 text-amber-800",
                      order.status === "Completed" &&
                        "bg-green-100 text-green-800",
                    )}
                  >
                    {order.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(order)}
                      aria-label="Delete order"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
