"use client";

import { useMemo, useState } from "react";

import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { useTables } from "@/hooks/use-tables";
import { useTableAreas } from "@/hooks/use-table-areas";
import { useReservations } from "@/hooks/use-reservations";
import { useAuth } from "@/hooks/use-auth";
import { useDashboard, useDashboardLive } from "@/hooks/use-dashboard";
import { useDashboardRealtime } from "@/hooks/use-realtime";
import { useStoredPeriod, rangeOfPeriod } from "@/hooks/use-stored-period";
import { cafeDateString } from "@/lib/utils";
import { REFETCH_INTERVALS } from "@/lib/query";
import { liveOrderOf } from "@/lib/order-query";
import { MAIN_PADDING_BLEED_CLASS } from "@/lib/shell-layout";
import { MAX_DASHBOARD_RANGE_DAYS, presetRange } from "@/lib/dashboard/range";
import { periodLabel, periodSubline } from "@/lib/dashboard/labels";
import { PageHeader } from "@/components/shared/PageHeader";
import { AttentionStrip } from "@/components/dashboard/AttentionStrip";
import { RangeBar, type DashboardSelection } from "@/components/dashboard/RangeBar";
import {
  BusyHoursCard,
  CategoriesCard,
  ChannelsCard,
  LeaksCard,
  PaymentMixCard,
  SalesCard,
  SlowItemsCard,
  TopItemsCard,
  type RangeCardProps,
} from "@/components/dashboard/RangeCards";
import { SalesHero, useCountUp } from "@/components/dashboard/SalesHero";
import { BillBreakdown } from "@/components/dashboard/BillBreakdown";
import { SalesReveal, useSalesReveal } from "@/components/dashboard/SalesReveal";
import { LiveFloorPanel } from "@/components/dashboard/LiveFloorPanel";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { TodayReservations } from "@/components/dashboard/TodayReservations";
import { EndOfDayButton } from "@/components/reports/EndOfDayButton";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import type { Order } from "@/types";

// The Dashboard, in the owner's HTML arrangement (U0 match, values 3.0). The shell's header names it ("Dashboard"
// over the cafe and the date) with End of day and the date picker as its actions. Then: what needs acting on right
// now; the chosen period (Today by default) against its comparison; the dark Net sales hero beside the bill breakdown
// receipt (both masked until the signed-in person's own PIN); sales by hour/day beside the live floor; recent orders
// beside today's reservations; payment mix, channels and money leaks; top items, categories and slow movers; busy
// hours. Every card, figure and link it had stays. Every range number comes from ONE server aggregate
// (GET /api/dashboard) — never from a capped client list.
//
// The rows follow the HTML's content width `cw` (the viewport minus the nav), not the viewport: the page is the query
// container, as wide as <main> (it bleeds over main's padding and lays out the HTML's own: 20px 24px 28px, on a phone
// 16px 14px and the 92px foot over the tab bar).

// Per-viewer convenience only (the period picked on this tab); never state
// that matters — a blocked or empty storage just means "Today".
const PERIOD_STORAGE_KEY = "pos.dashboard.period";

export default function DashboardPage() {
  const today = cafeDateString();
  const { user, isAdmin } = useAuth();

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
  // The floor areas for Live tables' zones: the persisted master (no request of its own), healed like the Floor's.
  const tableAreas = useTableAreas(tables.data);
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
  // The sales mask (values 3.17, design 7): the hero's and the receipt's figures show only after this person's own
  // PIN, for an hour on this tab; every visit starts masked. The two share the count-up the HTML plays on arrival.
  const reveal = useSalesReveal(user?.id ?? null);
  const grow = useCountUp(!!d);
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
    <div data-ui="dash-page" className={`@container ${MAIN_PADDING_BLEED_CLASS}`}>
      <div data-ui="dash-content" className="flex flex-col gap-4 px-[14px] pt-4 pb-[92px] leading-[normal] text-foreground tab:px-6 tab:pt-5 tab:pb-7">
        {/* The header's title and the cafe line (no description). End of day stays in the header at every width, an icon
            on a phone as the HTML's (ruling R13); the date beside it, and on a phone in a row here, showing the day. */}
        <EndOfDayButton>
          {({ button, picker }) => (
            <PageHeader title="Dashboard" className="gap-2.5" phoneActions={button} actions={picker} />
          )}
        </EndOfDayButton>

        <AttentionStrip live={live.data} loading={live.isLoading} isError={live.isError} />

        {/* values 3.2: the period's name and "{dates} · compared with …" in the HTML's words (ruling R9, from the range
            alone: never "Loading…", never moving), the segmented picker at the right (under them on a phone). */}
        <div data-ui="period-row" className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 data-ui="period-title" className="text-[18px] font-semibold tracking-[-0.01em]">{periodName}</h2>
            <p data-ui="period-sub" className="mt-0.5 text-[12.5px] text-muted-foreground">
              {periodSubline(shownRange, today)}
            </p>
          </div>
          <RangeBar variant="dashboard" value={selection} onChange={onSelect} isAdmin={isAdmin} />
        </div>

        {/* The rows' column templates are the HTML's db.L rules on the content width (cw): hero and twoOne split
            from 1000, three goes two-up from 680 and three-up from 1080, where span3 cards fill the two-up row. */}
        <div className="grid grid-cols-1 gap-4 @min-[1000px]:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
          <SalesHero
            {...cards}
            shown={reveal.shown}
            grow={grow}
            reveal={<SalesReveal reveal={reveal} name={user?.name} isAdmin={isAdmin} />}
          />
          <BillBreakdown {...cards} shown={reveal.shown} grow={grow} />
        </div>

        <div className="grid grid-cols-1 gap-4 @min-[1000px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <SalesCard {...cards} shown={reveal.shown} />
          <LiveFloorPanel
            tables={tables.data ?? []}
            orders={floorOrders}
            areas={tableAreas.data}
            reservations={reservations.data}
            loading={tables.isLoading}
            isError={tables.isError}
            onRetry={() => void tables.refetch()}
            onSelectOrder={setDetail}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 @min-[1000px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <RecentOrders
            orders={todayOrders.data ?? []}
            loading={todayOrders.isLoading}
            isError={todayOrders.isError}
            onRetry={() => void todayOrders.refetch()}
            onSelect={setDetail}
          />
          <TodayReservations
            reservations={reservations.data ?? []}
            loading={reservations.isLoading}
            isError={reservations.isError}
            onRetry={() => void reservations.refetch()}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 @min-[680px]:grid-cols-2 @min-[1080px]:grid-cols-3">
          <PaymentMixCard {...cards} />
          <ChannelsCard {...cards} />
          <LeaksCard {...cards} className="@min-[680px]:col-span-full @min-[1080px]:col-auto" />
        </div>

        <div className="grid grid-cols-1 gap-4 @min-[680px]:grid-cols-2 @min-[1080px]:grid-cols-3">
          <TopItemsCard {...cards} />
          <CategoriesCard {...cards} />
          <SlowItemsCard {...cards} className="@min-[680px]:col-span-full @min-[1080px]:col-auto" />
        </div>

        <BusyHoursCard {...cards} />
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
