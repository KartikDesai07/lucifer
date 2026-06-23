"use client";

import { Loader2 } from "lucide-react";

import { useCustomerOrders } from "@/hooks/use-customers";
import { PAY_STYLES } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Customer } from "@/types";

interface CustomerHistoryDialogProps {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
}

export function CustomerHistoryDialog({
  customer,
  onOpenChange,
}: CustomerHistoryDialogProps) {
  const orders = useCustomerOrders(customer?._id ?? null);

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order history</DialogTitle>
          <DialogDescription>
            {customer?.name} · {customer?.visits ?? 0} visits ·{" "}
            {inr(customer?.totalSpend ?? 0)} lifetime
          </DialogDescription>
        </DialogHeader>

        {orders.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
          </div>
        ) : (orders.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No orders yet"
            description="This customer has no past orders."
          />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {orders.data?.map((order) => {
              const style = PAY_STYLES[order.payment];
              const due = order.total - order.paidAmount;
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
                      className={cn("text-[10px]", style?.color)}
                    >
                      {order.payment}
                    </Badge>
                    <span className="font-semibold">{inr(order.total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
