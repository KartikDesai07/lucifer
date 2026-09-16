"use client";

import { Pencil, Trash2, History, Wallet } from "lucide-react";

import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Customer } from "@/types";

interface CustomerRowCardProps {
  customer: Customer;
  isAdmin: boolean;
  onReceivePayment: (customer: Customer) => void;
  onHistory: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}

// Same fields, handlers and aria-labels as the <Table> row in
// customers/page.tsx — kept in one place per row so the two branches cannot
// drift apart.
export function CustomerRowCard({
  customer,
  isAdmin,
  onReceivePayment,
  onHistory,
  onEdit,
  onDelete,
}: CustomerRowCardProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{customer.name}</div>
          <div className="text-sm text-muted-foreground">
            {customer.mobile}
          </div>
        </div>
        <Badge variant={customer.notes === "VIP" ? "default" : "secondary"}>
          {customer.notes}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          Visits {customer.visits}
        </span>
        <span className="font-medium">{inr(customer.totalSpend)}</span>
      </div>
      {customer.totalDue > 0 && (
        <div className="mt-1">
          <Badge variant="destructive">{inr(customer.totalDue)}</Badge>
        </div>
      )}
      <div className="mt-2 flex justify-end gap-1 border-t pt-2">
        {customer.totalDue > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onReceivePayment(customer)}
            aria-label="Receive payment"
          >
            <Wallet className="h-4 w-4 text-green-600" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onHistory(customer)}
          aria-label="Order history"
        >
          <History className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(customer)}
          aria-label="Edit customer"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        {/* Admin only — the route enforces it too (403). Showing it to staff
            would offer an action that always fails. */}
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(customer)}
            aria-label="Delete customer"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}
