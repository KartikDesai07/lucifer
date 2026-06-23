"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  IndianRupee,
  Receipt,
  Calculator,
  Wallet,
  Loader2,
} from "lucide-react";

import { useReport, type ReportRange } from "@/hooks/use-reports";
import { cafeDateString, inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { CustomerDuesTable } from "@/components/reports/CustomerDuesTable";
import type { PaymentMode } from "@/lib/constants";

const ChartSkeleton = () => <Skeleton className="h-[300px] w-full" />;
const PaymentChart = dynamic(
  () => import("@/components/dashboard/PaymentChart").then((m) => m.PaymentChart),
  { ssr: false, loading: ChartSkeleton },
);
const TopProductsChart = dynamic(
  () =>
    import("@/components/dashboard/TopProductsChart").then(
      (m) => m.TopProductsChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);
const SalesByDayChart = dynamic(
  () =>
    import("@/components/reports/SalesByDayChart").then(
      (m) => m.SalesByDayChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);

const DEFAULT_RANGE_DAYS = 7;

function defaultRange(): ReportRange {
  const start = new Date();
  start.setDate(start.getDate() - (DEFAULT_RANGE_DAYS - 1));
  return { startDate: cafeDateString(start), endDate: cafeDateString() };
}

export default function ReportsPage() {
  return (
    <AdminGuard>
      <ReportsContent />
    </AdminGuard>
  );
}

function ReportsContent() {
  // Range is set after mount to avoid SSR/client date hydration mismatch.
  const [range, setRange] = useState<ReportRange | null>(null);
  const [draft, setDraft] = useState<ReportRange>({ startDate: "", endDate: "" });

  useEffect(() => {
    const r = defaultRange();
    setRange(r);
    setDraft(r);
  }, []);

  const report = useReport(range ?? { startDate: "", endDate: "" }, !!range);
  const data = report.data;
  const totals = data?.totals;
  const avgOrder =
    totals && totals.totalOrders > 0
      ? totals.totalSales / totals.totalOrders
      : 0;

  const paymentSlices = (data?.salesByPayment ?? []).map((p) => ({
    mode: p.payment as PaymentMode,
    amount: p.amount,
  }));

  const rangeChanged =
    !!range &&
    (draft.startDate !== range.startDate || draft.endDate !== range.endDate);
  const validDraft =
    !!draft.startDate &&
    !!draft.endDate &&
    draft.startDate <= draft.endDate;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Sales, products, payments, and outstanding dues by date range.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-xs">
              From
            </Label>
            <Input
              id="from"
              type="date"
              className="w-40"
              value={draft.startDate}
              max={draft.endDate || undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, startDate: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs">
              To
            </Label>
            <Input
              id="to"
              type="date"
              className="w-40"
              value={draft.endDate}
              min={draft.startDate || undefined}
              max={cafeDateString()}
              onChange={(e) =>
                setDraft((d) => ({ ...d, endDate: e.target.value }))
              }
            />
          </div>
          <Button
            disabled={!validDraft || (!rangeChanged && !report.isError)}
            onClick={() => setRange(draft)}
          >
            {report.isFetching && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Generate report
          </Button>
        </CardContent>
      </Card>

      {report.isError ? (
        <p className="text-sm text-destructive">
          Failed to load report. Adjust the range and try again.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="Total Sales"
              value={inr(totals?.totalSales ?? 0)}
              icon={IndianRupee}
              variant="green"
              loading={report.isPending}
            />
            <SummaryCard
              title="Orders"
              value={totals?.totalOrders ?? 0}
              icon={Receipt}
              variant="blue"
              loading={report.isPending}
            />
            <SummaryCard
              title="Avg Order Value"
              value={inr(avgOrder)}
              icon={Calculator}
              variant="amber"
              loading={report.isPending}
            />
            <SummaryCard
              title="Collected"
              value={inr(totals?.totalCollected ?? 0)}
              icon={Wallet}
              variant="green"
              loading={report.isPending}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales by day</CardTitle>
            </CardHeader>
            <CardContent>
              {report.isPending ? (
                <ChartSkeleton />
              ) : (
                <SalesByDayChart data={data?.dayWise ?? []} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top products</CardTitle>
              </CardHeader>
              <CardContent>
                {report.isPending ? (
                  <ChartSkeleton />
                ) : (
                  <TopProductsChart data={data?.topProducts ?? []} limit={10} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {report.isPending ? (
                  <ChartSkeleton />
                ) : (
                  <PaymentChart data={paymentSlices} />
                )}
              </CardContent>
            </Card>
          </div>

          <CustomerDuesTable dues={data?.customerDues ?? []} />
        </>
      )}
    </div>
  );
}
