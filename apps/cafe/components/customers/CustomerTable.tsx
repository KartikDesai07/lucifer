"use client";

import { Pencil, Trash2, History, Wallet } from "lucide-react";

import { inr } from "@/lib/utils";
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
import type { Customer } from "@/types";

interface CustomerTableProps {
  customers: Customer[];
  isAdmin: boolean;
  onReceivePayment: (customer: Customer) => void;
  onHistory: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
}

// Desktop table view — same fields, handlers and aria-labels as
// CustomerRowCard's mobile card, kept in one place per row so the two
// branches cannot drift apart. Markup moved byte-for-byte out of
// customers/page.tsx.
export function CustomerTable({
  customers,
  isAdmin,
  onReceivePayment,
  onHistory,
  onEdit,
  onDelete,
}: CustomerTableProps) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead className="text-right">Visits</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Due</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer._id}>
              <TableCell className="font-medium">{customer.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {customer.mobile}
              </TableCell>
              <TableCell className="text-right">{customer.visits}</TableCell>
              <TableCell className="text-right">
                {inr(customer.totalSpend)}
              </TableCell>
              <TableCell className="text-right">
                {customer.totalDue > 0 ? (
                  <Badge variant="destructive">{inr(customer.totalDue)}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={customer.notes === "VIP" ? "default" : "secondary"}
                >
                  {customer.notes}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
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
                  {/* Admin only — the route enforces it too (403). Showing
                      it to staff would offer an action that always fails. */}
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
