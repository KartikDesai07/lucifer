"use client";

import { useMemo, useState } from "react";

import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { useTables } from "@/hooks/use-tables";
import { useReservations } from "@/hooks/use-reservations";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";
import { useDashboard, useDashboardLive } from "@/hooks/use-dashboard";
import { useDashboardRealtime } from "@/hooks/use-realtime";
import { useStoredPeriod, rangeOfPeriod } from "@/hooks/use-stored-period";
import { cafeDateString } from "@/lib/utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import { liveOrderOf } from "@/lib/order-query";
import { APP_NAME, CAFE_TIMEZONE } from "@/lib/constants";
import { brandFontVariables } from "@/lib/brand-fonts";
import { MAX_DASHBOARD_RANGE_DAYS, presetRange } from "@/lib/dashboard/range";
import { compareCaption, periodDates, periodLabel } from "@/lib/dashboard/labels";
import { AttentionStrip } from "@/components/dashboard/AttentionStrip";
import { RangeBar, type DashboardSelection } from "@/components/dashboard/RangeBar";
import {
  BusyHoursCard,
  CategoriesCard,
  ChannelsCard,
  KpiRow,
  LeaksCard,
  PaymentMixCard,
  SalesCard,
  SlowItemsCard,
  TopItemsCard,
  type RangeCardProps,
} from "@/components/dashboard/RangeCards";
import { LiveFloorPanel } from "@/components/dashboard/LiveFloorPanel";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TodayReservations } from "@/components/dashboard/TodayReservations";
import { EndOfDayButton } from "@/components/reports/EndOfDayButton";
import { MoneyBreakdownCard } from "@/components/reports/MoneyBreakdownCard";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import type { Order } from "@/types";

// The Dashboard (owner's page-by-page programme, screen 3 — Paper & Ink,
// "Stripe-style calm + a Needs attention strip"). Top: what needs acting on
// right now. Then the chosen period (Today by default) against its comparison:
// headline figures, sales by hour/day, payment mix, best sellers, and the live
// floor beside them; below, busy hours, channels, slow movers, categories,
// money leaks and the bill breakdown. Every range number comes from ONE server
// aggregate (GET /api/dashboard) — never from a capped client list.

// Per-viewer convenience only (the period picked on this tab); never state
// that matters — a blocked or empty storage just means "Today".
const PERIOD_STORAGE_KEY = "pos.dashboard.period";

const DATE_LINE = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: CAFE_TIMEZONE,
});

export default function DashboardPage() {
  const today = cafeDateString();
  const { isAdmin } = useAuth();
  const settings = useSettings();
  const restaurantName = settings.data?.restaurantName?.trim() || APP_NAME;

  // The stored choice is read after mount (sessionStorage does not exist during
  // the server render); the range query waits for that one tick so a remembered
  // "Last 7 days" never first fetches — and flashes — Today.
  const { period, restored, save } = useStoredPeriod({
    key: PERIOD_STORAGE_KEY,
    fallback: "today",
    maxDays: MAX_DASHBOARD_RANGE_DAYS,
  });

  // A fixed preset is re-derived on every render (cheap; the query key hashes
  // the from/to strings), so a tab left open past midnight moves to the new day
  // on its next poll. A multi-day choice needs an admin (the server refuses it
  // otherwise); staff fall back to Today — the picker and the data together.
  const wanted = rangeOfPeriod(period, "today");
  const selection: DashboardSelection =
    !isAdmin && wanted.from !== wanted.to
      ? { preset: "today", range: presetRange("today") }
      : { preset: period.preset, range: wanted };
  const range = selection.range;
  const onSelect = (next: DashboardSelection) =>
    save(next.preset === "custom" ? { preset: "custom", custom: next.range } : { preset: next.preset });

  const dash = useDashboard(range, restored);
  const live = useDashboardLive();
  useDashboardRealtime();
  const todayOrders = useOrders({ date: today }, { refetchInterval: REFETCH_INTERVALS.LIVE_LISTS });
  const tables = useTables();
  const reservations = useReservations({ date: today });
  // Running tabs that occupy tables — date-independent and tiny (≤ #tables), so
  // the floor panel can resolve an occupied tile even for a cross-day tab or one
  // beyond today's 50-order page (which `todayOrders` alone would miss).
  // Filtered on status too, not payment alone: cancelling a tab leaves `payment`
  // as the historical "Unpaid" (the record is never rewritten), so a payment-only
  // filter would keep showing a dead tab as occupying a table it no longer holds.
  // Same query (and options) as the POS's open-tabs list.
  const openTabs = useOrders({ payment: "Unpaid", status: "Pending" }, OPEN_TABS_QUERY_OPTIONS);

  const [detail, setDetail] = useState<Order | null>(null);

  // Order lookup for the live floor: today's orders + every open tab, so an
  // occupied table's `currentOrderId` always resolves (open tabs win on overlap).
  const floorOrders = useMemo(() => {
    const byId = new Map<string, Order>();
    for (const o of todayOrders.data ?? []) byId.set(o.orderId, o);
    for (const o of openTabs.data ?? []) byId.set(o.orderId, o);
    return [...byId.values()];
  }, [todayOrders.data, openTabs.data]);

  const d = dash.data;
  const shownRange = d?.range ?? range;
  const periodName = periodLabel(shownRange, today);
  const cards: RangeCardProps = {
    data: d,
    status: d ? "ready" : dash.isError ? "error" : "loading",
    updating: dash.isPlaceholderData,
    onRetry: () => void dash.refetch(),
    period: periodName,
    today,
  };

  return (
    <div className={`${brandFontVariables} -m-4 min-h-[calc(100svh-3.5rem)] bg-brand-paper p-4 font-brand-sans text-brand-ink md:-m-6 md:p-6`}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 sm:gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.015em]">Dashboard</h1>
            <p className="truncate text-[13.5px] text-brand-muted" suppressHydrationWarning>
              {restaurantName} · {DATE_LINE.format(new Date())}
            </p>
          </div>
          <EndOfDayButton />
        </div>

        <AttentionStrip live={live.data} loading={live.isLoading} isError={live.isError} />

        {/* The picker sits beside the title only when there is room for the caption on
            one line (lg+); the caption reserves its phone height (two lines) so the
            figures arriving never move the page. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-6">{periodName}</h2>
            <p className="min-h-9 text-[12.5px] leading-[18px] text-brand-muted sm:min-h-[18px]">
              {periodName === periodDates(shownRange) ? "" : `${periodDates(shownRange)} · `}
              {d ? compareCaption(d, today) : "Loading…"}
            </p>
          </div>
          <RangeBar value={selection} onChange={onSelect} isAdmin={isAdmin} />
        </div>

        <KpiRow {...cards} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SalesCard {...cards} className="lg:col-span-2" />
          <PaymentMixCard {...cards} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TopItemsCard {...cards} />
          <RecentOrders
            orders={todayOrders.data ?? []}
            loading={todayOrders.isLoading}
            isError={todayOrders.isError}
            onRetry={() => void todayOrders.refetch()}
            onSelect={setDetail}
          />
          <div className="md:col-span-2 xl:col-span-1">
            <LiveFloorPanel
              tables={tables.data ?? []}
              orders={floorOrders}
              loading={tables.isLoading}
              isError={tables.isError}
              onRetry={() => void tables.refetch()}
              onSelectOrder={setDetail}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BusyHoursCard {...cards} className="lg:col-span-2" />
          <ChannelsCard {...cards} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SlowItemsCard {...cards} />
          <CategoriesCard {...cards} />
          <LeaksCard {...cards} className="md:col-span-2 xl:col-span-1" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MoneyBreakdownCard
            money={d?.money}
            net={d?.kpis.current.sales ?? 0}
            loading={!d}
            caption={`Completed orders · ${periodName}`}
            className="gap-4 rounded-xl border-brand-rule bg-brand-slip py-5 text-brand-ink shadow-none"
          />
          <TodayReservations
            reservations={reservations.data ?? []}
            loading={reservations.isLoading}
            isError={reservations.isError}
            onRetry={() => void reservations.refetch()}
          />
        </div>
      </div>

      {/* The sheet follows the live row (a tab another device grew or settled);
          it latches its own copy while paying. */}
      <OrderDetailSheet
        order={liveOrderOf(detail, floorOrders)}
        onOpenChange={(o) => !o && setDetail(null)}
        onSettled={setDetail}
      />
    </div>
  );
}
