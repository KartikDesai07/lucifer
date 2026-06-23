"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, IndianRupee, CheckCircle2 } from "lucide-react";

import { useSettleCustomerDue } from "@/hooks/use-customers";
import { REPORT_KEYS } from "@/hooks/use-reports";
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
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { CustomerDue } from "@/types";

interface CustomerDuesTableProps {
  dues: CustomerDue[];
}

// Outstanding customer balances with a one-tap "Mark paid" (sets totalDue = 0)
// and CSV export (Steps 6.10/6.11). Marking paid re-fetches the report.
export function CustomerDuesTable({ dues }: CustomerDuesTableProps) {
  const qc = useQueryClient();
  const settleDue = useSettleCustomerDue();
  const [settling, setSettling] = useState<CustomerDue | null>(null);

  const totalOutstanding = dues.reduce((sum, d) => sum + d.totalDue, 0);

  const confirmSettle = async () => {
    if (!settling) return;
    try {
      await settleDue.mutateAsync(settling._id);
      qc.invalidateQueries({ queryKey: REPORT_KEYS.all });
      setSettling(null);
    } catch {
      // hook toasts on error
    }
  };

  const handleExport = () =>
    exportToCSV(
      dues.map((d) => ({ Name: d.name, Mobile: d.mobile, Due: d.totalDue })),
      "customer-dues",
    );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Customer dues</CardTitle>
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
                  <TableHead className="w-28 text-right">Action</TableHead>
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
                        onClick={() => setSettling(d)}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4 text-green-600" />
                        Mark paid
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!settling}
        onOpenChange={(o) => !o && setSettling(null)}
        title="Mark dues as paid?"
        description={`This clears the ${inr(settling?.totalDue ?? 0)} outstanding balance for ${settling?.name}.`}
        confirmLabel="Mark paid"
        destructive={false}
        isLoading={settleDue.isPending}
        onConfirm={confirmSettle}
      />
    </Card>
  );
}
