"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { itemsCsvRows } from "@/lib/reports/csv-b2";
import { deltaRatio } from "@/lib/dashboard/fold";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useItemsReport } from "@/hooks/use-reports";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { StatCard } from "@/components/reports/StatCard";
import { DashCard, BrandSkeleton } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { REPORT_CHART_BODY_PX, type ReportChartBar } from "@/components/reports/chart-size";
import { TallyCard, type TallyLine } from "@/components/reports/TallyCard";
import { CategoriesTable, ItemsTable } from "@/components/reports/ItemsTables";
import { ItemSheet } from "@/components/reports/ItemSheet";
import type { ItemSalesRow } from "@/types/reports";

const ReportChart = dynamic(() => import("@/components/reports/ReportChart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: REPORT_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

const TOP_ITEMS_LIMIT = 10;
type ChartMeasure = "sales" | "qty";
const ITEMS_TALLY_RESERVE_LINES = 7;
const ROUNDING_EPSILON = 0.005; // hides sub-paisa float noise, never a real mismatch

export default function ItemsReportPage() {
  const { range, restored } = useReportRange();
  const report = useItemsReport(range, restored);
  const r = report.data;
  const loading = !r;
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [measure, setMeasure] = useState<ChartMeasure>("sales");
  const [openItem, setOpenItem] = useState<ItemSalesRow | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const compareCaption = r ? `compared with the ${r.compare.label.replace(/^vs /, "")}` : "";

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(itemsCsvRows(r), `items-${r.range.from}-to-${r.range.to}`);
  };

  const topItems = useMemo(() => {
    if (!r) return [];
    return [...r.items].sort((a, b) => b[measure] - a[measure] || a.label.localeCompare(b.label)).slice(0, TOP_ITEMS_LIMIT);
  }, [r, measure]);

  const chartBars = useMemo<ReportChartBar[]>(
    () => [{ name: measure === "sales" ? "Sales" : "Quantity", values: topItems.map((i) => i[measure]), tone: "primary" }],
    [topItems, measure],
  );
  const chartLabels = useMemo(() => topItems.map((i) => i.label), [topItems]);

  const onChartSelect = (index: number) => {
    const item = topItems[index];
    if (item) setOpenItem(item);
  };

  // A category picked in an earlier period that sold nothing in the one shown
  // now is not applied — the Items card would go "empty" and hide its own
  // "Show all", with no row left in Categories to pick instead.
  const activeCategory = categoryFilter && r?.categories.some((c) => c.key === categoryFilter) ? categoryFilter : null;
  const filteredItems = activeCategory ? (r?.items.filter((i) => i.categoryKey === activeCategory) ?? []) : (r?.items ?? []);
  const filteredCategoryLabel = activeCategory ? (r?.categories.find((c) => c.key === activeCategory)?.label ?? "") : "";
  const filteredTotals = filteredItems.reduce((acc, i) => ({ sales: acc.sales + i.sales, qty: acc.qty + i.qty }), { sales: 0, qty: 0 });

  const itemSales = r ? r.items.reduce((s, i) => s + i.sales, 0) : 0;
  const nonBillLines = r ? r.money.gross - r.rewardLines : 0;
  const rounding = r ? nonBillLines - itemSales : 0;
  const showRounding = Math.abs(rounding) >= ROUNDING_EPSILON;

  const tallyLines: TallyLine[] = r
    ? [
        { label: "Items sold", amount: itemSales },
        ...(showRounding ? [{ label: "Rounding on bills", amount: rounding, sign: rounding < 0 ? ("-" as const) : ("+" as const) }] : []),
        { label: "Discounts", amount: r.money.discount, sign: "-" },
        { label: "Rewards off the bill", amount: r.money.reward - r.rewardLines, sign: "-" },
        { label: "GST added", amount: r.money.gst, sign: "+" },
        { label: "Additional charges", amount: r.money.charges, sign: "+" },
        { label: "Net sales", amount: r.netSales, tone: "total" },
        ...(r.rewardLines > 0 ? [{ label: "Free reward dishes (not billed)", amount: r.rewardLines, tone: "muted" as const }] : []),
      ]
    : [];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Items & categories"
        description="What sells, and what it brings in"
        compareCaption={compareCaption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          label="Items sold"
          value={String(r?.kpis.current.qty ?? 0)}
          delta={deltaRatio(r?.kpis.current.qty ?? 0, r?.kpis.previous.qty ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No items sold in the earlier period"
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Item sales"
          value={inr(r?.kpis.current.sales ?? 0)}
          delta={deltaRatio(r?.kpis.current.sales ?? 0, r?.kpis.previous.sales ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No items sold in the earlier period"
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Different items"
          value={String(r?.items.length ?? 0)}
          sub={r ? `${r.categories.length} categories` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Top seller"
          value={r && r.items.length > 0 ? r.items[0].label : "—"}
          sub={r && r.items.length > 0 ? `${r.items[0].qty} sold · ${inr(r.items[0].sales)}` : undefined}
          loading={loading}
          updating={updating}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard
          className="lg:col-span-2"
          title="Top 10 items"
          period="Tap a bar for that item's details"
          status={r && r.items.length === 0 ? "empty" : cardStatus}
          onRetry={retry}
          updating={updating}
          empty={{ title: "No items sold in this period", description: "Pick another period to see the top items." }}
          bodyMinHeight={REPORT_CHART_BODY_PX}
        >
          {r && (
            <div className="flex flex-col gap-3">
              <div className="inline-flex w-fit rounded-md border border-brand-rule p-0.5">
                {(["sales", "qty"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={measure === m}
                    onClick={() => setMeasure(m)}
                    className={`rounded px-3 py-1 text-[12.5px] font-medium transition-colors ${
                      measure === m ? "bg-brand-primary text-brand-slip" : "text-brand-ink hover:bg-brand-wash"
                    }`}
                  >
                    {m === "sales" ? "By sales" : "By quantity"}
                  </button>
                ))}
              </div>
              <ReportChart
                labels={chartLabels}
                bars={chartBars}
                selected={null}
                onSelect={onChartSelect}
                horizontal
                format={measure === "sales" ? "money" : "count"}
                ariaLabel={`Top 10 items by ${measure === "sales" ? "sales" : "quantity"}`}
              />
              {topItems.length > 0 && (
                <p className="text-[12.5px] text-brand-muted">
                  {topItems[0].label} leads with {measure === "sales" ? inr(topItems[0].sales) : `${topItems[0].qty} sold`}
                </p>
              )}
            </div>
          )}
        </DashCard>
        <TallyCard
          title="How it adds up"
          period="Every number here matches the table and the CSV"
          lines={tallyLines}
          check={{
            label: "Items − discounts − rewards + GST + charges = net sales",
            parts: r ? [itemSales, showRounding ? rounding : 0, -r.money.discount, -(r.money.reward - r.rewardLines), r.money.gst, r.money.charges] : [],
            total: r?.netSales ?? 0,
          }}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
          reserveLines={ITEMS_TALLY_RESERVE_LINES}
        />
      </div>

      <DashCard
        title="Categories"
        period="Tap a category to filter the items below"
        status={r && r.categories.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No categories in this period", description: "Pick another period to see category sales." }}
        bodyMinHeight={200}
      >
        {r && <CategoriesTable categories={r.categories} loading={false} selected={activeCategory} onSelect={(key) => setCategoryFilter(key)} />}
      </DashCard>

      <DashCard
        title="Items"
        period="Tap an item for its full details"
        status={r && filteredItems.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No items in this period", description: "Pick another period to see item sales." }}
        bodyMinHeight={240}
      >
        {r && (
          <div className="flex flex-col gap-3">
            {activeCategory && (
              <div className="flex items-center gap-2 text-[12.5px] text-brand-muted">
                <span>
                  Showing <span className="font-medium text-brand-ink">{filteredCategoryLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  className="rounded-md border border-brand-rule px-2 py-0.5 font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  Show all
                </button>
              </div>
            )}
            <ItemsTable
              items={filteredItems}
              loading={false}
              showFree={filteredItems.some((i) => i.freeQty > 0)}
              totalSales={filteredTotals.sales}
              totalQty={filteredTotals.qty}
              totalLabel={activeCategory ? `Total · ${filteredCategoryLabel}` : undefined}
              onRowClick={(row) => setOpenItem(row)}
            />
          </div>
        )}
      </DashCard>

      <ItemSheet item={openItem} range={r?.range ?? range} onOpenChange={(open) => !open && setOpenItem(null)} />
    </>
  );
}
