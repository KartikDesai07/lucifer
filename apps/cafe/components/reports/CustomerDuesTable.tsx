"use client";

import { useState } from "react";
import { Download, IndianRupee, Wallet } from "lucide-react";

import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { ReceivePaymentDialog } from "@/components/customers/ReceivePaymentDialog";
import type { CustomerDue } from "@/types";

interface CustomerDuesTableProps {
  dues: CustomerDue[];
}

// Outstanding customer balances with "Receive payment" and CSV export (Steps
// 6.10/6.11). CR1.4: this replaces the old one-tap all-or-nothing "Mark paid"
// wipe — an amount and a mode are now always chosen by a human, via the same
// ReceivePaymentDialog the customers page uses. Recording a payment
// invalidates the report through useReceiveDuePayment's own invalidation.
// Titled "Outstanding now" (not "this range") because this query is LIVE and
// unbounded (app/api/reports/route.ts) — it does not share a time basis with
// the report's date-ranged "Dues collected (this range)" card (G12).
export function CustomerDuesTable({ dues }: CustomerDuesTableProps) {
  const [receiving, setReceiving] = useState<CustomerDue | null>(null);

  const totalOutstanding = dues.reduce((sum, d) => sum + d.totalDue, 0);

  const handleExport = () =>
    exportToCSV(
      dues.map((d) => ({ Name: d.name, Mobile: d.mobile, Due: d.totalDue })),
      "customer-dues",
    );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Outstanding now</CardTitle>
          {dues.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {inr(totalOutstanding)} outstanding across {dues.length}{" "}
              {dues.length === 1 ? "customer" : "customers"}
            </p>
          )}
        </div>
        {dues.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {dues.length === 0 ? (
          <EmptyState
            icon={<IndianRupee className="h-7 w-7" />}
            title="No outstanding dues"
            description="All customers are settled up."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="w-40 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dues.map((d) => (
                  <TableRow key={d._id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.mobile}
                    </TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {inr(d.totalDue)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReceiving(d)}
                      >
                        <Wallet className="mr-1 h-4 w-4 text-green-600" />
                        Receive payment
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ReceivePaymentDialog
        customer={receiving}
        onOpenChange={(o) => !o && setReceiving(null)}
      />
    </Card>
  );
}
