"use client";

import { useCustomerOrders } from "@/hooks/use-customers";
import { PAY_STYLES } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { DuePaymentHistory } from "@/components/customers/DuePaymentHistory";
import type { Customer } from "@/types";

const ORDERS_SKELETON_ROWS = 4;

interface CustomerHistoryDialogProps {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
}

export function CustomerHistoryDialog({
  customer,
  onOpenChange,
}: CustomerHistoryDialogProps) {
  const orders = useCustomerOrders(customer?._id ?? null);
  const hasOrders = (orders.data?.length ?? 0) > 0;

  // One ordered decision for what the Orders tab shows, mirroring
  // customers/page.tsx's statusPanel — `null` means "render the list".
  // Having cached rows beats every status below: a failed background
  // refresh must not throw away orders still in hand.
  const ordersPanel = (() => {
    if (hasOrders) return null;
    if (orders.isLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: ORDERS_SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      );
    }
    // Offline, TanStack parks the query as `paused` — isLoading AND isError
    // both false with no data, indistinguishable from "no orders" unless
    // isPaused is read explicitly.
    if (orders.isPaused) {
      return (
        <p className="p-4 text-sm text-muted-foreground">
          You appear to be offline. Orders will load when the connection is
          back.
        </p>
      );
    }
    // isLoadingError, not bare isError: a failed REFRESH while orders are
    // still cached must fall through to the list instead of landing here.
    if (orders.isLoadingError) {
      return (
        <p className="p-4 text-sm text-destructive">
          Failed to load orders. Retry by reopening this dialog.
        </p>
      );
    }
    return (
      <EmptyState
        title="No orders yet"
        description="This customer has no past orders."
      />
    );
  })();

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customer history</DialogTitle>
          <DialogDescription>
            {customer?.name} · {customer?.visits ?? 0} visits ·{" "}
            {inr(customer?.totalSpend ?? 0)} lifetime
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="orders">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            {ordersPanel ?? (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {orders.data?.map((order) => {
                  const style = PAY_STYLES[order.payment];
                  const cancelled = order.status === "Cancelled";
                  // A cancel reverses the ledger, so a cancelled bill owes nothing —
                  // `total - paidAmount` on the old snapshot would otherwise print a
                  // Due the customer's own ledger no longer agrees with.
                  const due = cancelled ? 0 : order.total - order.paidAmount;
                  return (
                    <div
                      key={order._id}
                      className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{order.orderId}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(order.createdAt)} · {order.items.length} item
                          {order.items.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {due > 0 && (
                          <span className="text-xs font-medium text-destructive">
                            Due {inr(due)}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", cancelled ? "text-gray-600" : style?.color)}
                        >
                          {cancelled ? "Cancelled" : order.payment}
                        </Badge>
                        <span
                          className={cn(
                            "font-semibold",
                            cancelled && "text-muted-foreground line-through",
                          )}
                        >
                          {inr(order.total)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="payments">
            {customer && <DuePaymentHistory customerId={customer._id} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
