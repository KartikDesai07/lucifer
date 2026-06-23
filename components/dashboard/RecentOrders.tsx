"use client";

import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";

import { PAY_STYLES } from "@/lib/constants";
import { inr, timeAgo, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Order } from "@/types";

interface RecentOrdersProps {
  orders: Order[];
  loading?: boolean;
  onSelect: (order: Order) => void;
}

const MAX_ROWS = 10;

// Today's most recent orders. Rows open the shared OrderDetailSheet via onSelect
// (the dashboard owns the sheet so its print/complete actions are reused).
export function RecentOrders({ orders, loading, onSelect }: RecentOrdersProps) {
  const rows = orders.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Recent orders</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/orders">
            View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title="No orders today yet"
            description="Orders placed from the POS will show up here."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((order) => {
              const payStyle = PAY_STYLES[order.payment];
              return (
                <li key={order._id}>
                  <button
                    type="button"
                    onClick={() => onSelect(order)}
                    className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {order.orderId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {order.tableNo ?? "Walk-In"}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {order.customerName} · {timeAgo(order.createdAt)}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", payStyle?.color)}>
                      {order.payment}
                    </Badge>
                    <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                      {inr(order.total)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
