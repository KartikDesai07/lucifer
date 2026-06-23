"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  IndianRupee,
  Receipt,
  Banknote,
  Hourglass,
  Armchair,
  HandCoins,
} from "lucide-react";

import { useOrders, useOrderSummary } from "@/hooks/use-orders";
import { useTables } from "@/hooks/use-tables";
import { useReservations } from "@/hooks/use-reservations";
import { cafeDateString, inr } from "@/lib/utils";
import { SETTLEMENT_PAY_MODES } from "@/lib/constants";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { LiveFloorPanel } from "@/components/dashboard/LiveFloorPanel";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TodayReservations } from "@/components/dashboard/TodayReservations";
import { EndOfDayButton } from "@/components/reports/EndOfDayButton";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import type { Order } from "@/types";

// Charts are heavy and DOM-dependent — load them client-only with a skeleton
// fallback to avoid recharts SSR issues (Phase 6 Steps 6.3/6.4).
const ChartSkeleton = () => <Skeleton className="h-[260px] w-full" />;
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
const HourlySalesChart = dynamic(
  () =>
    import("@/components/dashboard/HourlySalesChart").then(
      (m) => m.HourlySalesChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);

const LIVE_REFRESH_MS = 30 * 1000; // recent-orders poll (Step 6.7)

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

export default function DashboardPage() {
  const today = cafeDateString();

  const summary = useOrderSummary();
  const todayOrders = useOrders(
    { date: today },
    { refetchInterval: LIVE_REFRESH_MS },
  );
  const tables = useTables();
  const reservations = useReservations({ date: today });

  const [detail, setDetail] = useState<Order | null>(null);

  const s = summary.data;
  const paymentSlices = s
    ? SETTLEMENT_PAY_MODES.map((mode) => ({
        mode,
        amount: s.paymentBreakdown[mode].amount,
      }))
    : [];

  const tableList = tables.data ?? [];
  const occupiedTables = tableList.filter((t) => t.status === "Occupied").length;
  const availableTables = tableList.filter(
    (t) => t.status === "Available",
  ).length;
  const totalTables = tableList.length || 8;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Today&apos;s overview for Lucifer Cafe.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EndOfDayButton />
          <p
            className="text-sm font-medium text-muted-foreground"
            suppressHydrationWarning
          >
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          title="Today's Sales"
          value={inr(s?.totalSales ?? 0)}
          subtitle="Completed revenue"
          icon={IndianRupee}
          variant="green"
          loading={summary.isLoading}
        />
        <SummaryCard
          title="Orders Served"
          value={s?.totalOrders ?? 0}
          subtitle="Completed today"
          icon={Receipt}
          variant="blue"
          loading={summary.isLoading}
        />
        <SummaryCard
          title="Collected"
          value={inr(s?.collected ?? 0)}
          subtitle="Cash + online today"
          icon={Banknote}
          variant="indigo"
          loading={summary.isLoading}
        />
        <SummaryCard
          title="In-progress"
          value={inr(s?.inProgress.value ?? 0)}
          subtitle={plural(s?.inProgress.count ?? 0, "open tab")}
          icon={Hourglass}
          variant="amber"
          loading={summary.isLoading}
          href="/orders?payment=Unpaid"
        />
        <SummaryCard
          title="Open Tables"
          value={`${occupiedTables}/${totalTables}`}
          subtitle={`${availableTables} available`}
          icon={Armchair}
          variant="purple"
          loading={tables.isLoading}
        />
        <SummaryCard
          title="Outstanding Dues"
          value={inr(s?.outstandingDues.total ?? 0)}
          subtitle={plural(s?.outstandingDues.customers ?? 0, "customer")}
          icon={HandCoins}
          variant="red"
          loading={summary.isLoading}
        />
      </div>

      <LiveFloorPanel
        tables={tableList}
        orders={todayOrders.data ?? []}
        loading={tables.isLoading}
        isError={tables.isError}
        onSelectOrder={setDetail}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales by hour</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <ChartSkeleton />
          ) : (
            <HourlySalesChart data={s?.hourly ?? []} />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? (
              <ChartSkeleton />
            ) : (
              <PaymentChart data={paymentSlices} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top products today</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? (
              <ChartSkeleton />
            ) : (
              <TopProductsChart data={s?.topProducts ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentOrders
          orders={todayOrders.data ?? []}
          loading={todayOrders.isLoading}
          onSelect={setDetail}
        />
        <TodayReservations
          reservations={reservations.data ?? []}
          loading={reservations.isLoading}
        />
      </div>

      <OrderDetailSheet
        order={detail}
        onOpenChange={(o) => !o && setDetail(null)}
        onSettled={setDetail}
      />
    </div>
  );
}
