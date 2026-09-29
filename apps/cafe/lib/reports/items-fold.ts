// Items facet rows -> ItemsReport / ItemDetail — pure (no DB); mirrors
// lib/reports/sales-fold.ts's own split between pipeline-adjacent rows and
// the pure fold that turns them into the DTO. Category resolution reuses the
// Dashboard's own categoryOf rule (lib/dashboard/fold.ts) so Reports and the
// Dashboard can never disagree on which category an item lands in.
import { categoryOf } from "@/lib/dashboard/fold";
import { pickMoneyBreakdown } from "@/lib/money-breakdown";
import { compareLabel, compareRange, dayLabel, hourLabel } from "@/lib/dashboard/range";
import type { ItemsFacet, ItemsCompareTotalsRow, ItemSeriesRow, ItemVoidsRow } from "@/lib/reports/items-pipelines";
import type { DashboardRange, DashboardSeriesMode } from "@/types/dashboard";
import type { CategorySalesRow, ItemDetail, ItemSalesRow, ItemsReport } from "@/types/reports-b2";

/** productId "" when a line has none — the row's stable drill key. */
function itemKey(productId: string, label: string): string {
  return `${productId}|${label}`;
}

export interface FoldItemsReportInput {
  range: DashboardRange;
  facet: ItemsFacet;
  compareTotals: ItemsCompareTotalsRow[];
  productCategory: ReadonlyMap<string, string>;
  categoryName: ReadonlyMap<string, string>;
}

export function foldItemsReport({ range, facet, compareTotals, productCategory, categoryName }: FoldItemsReportInput): ItemsReport {
  const items: ItemSalesRow[] = facet.items.map((row) => {
    const productId = row._id.productId ? String(row._id.productId) : "";
    const { key: categoryKey, label: categoryLabel } = categoryOf(row._id.productId, productCategory, categoryName);
    return {
      key: itemKey(productId, row._id.label),
      productId,
      label: row._id.label,
      categoryName: categoryLabel,
      categoryKey,
      qty: row.qty,
      freeQty: row.freeQty,
      sales: row.revenue,
      share: 0, // filled below, once the total is known
    };
  });

  const totalSales = items.reduce((s, r) => s + r.sales, 0);
  for (const row of items) row.share = totalSales > 0 ? row.sales / totalSales : 0;
  items.sort((a, b) => b.sales - a.sales || b.qty - a.qty || a.label.localeCompare(b.label));

  const byCategory = new Map<string, { label: string; items: number; qty: number; sales: number }>();
  for (const row of items) {
    const acc = byCategory.get(row.categoryKey) ?? { label: row.categoryName, items: 0, qty: 0, sales: 0 };
    acc.items += 1;
    acc.qty += row.qty;
    acc.sales += row.sales;
    byCategory.set(row.categoryKey, acc);
  }
  const categories: CategorySalesRow[] = [...byCategory].map(([key, v]) => ({
    key,
    label: v.label,
    items: v.items,
    qty: v.qty,
    sales: v.sales,
    share: totalSales > 0 ? v.sales / totalSales : 0,
  }));
  categories.sort((a, b) => b.sales - a.sales || b.qty - a.qty || a.label.localeCompare(b.label));

  const totals = facet.totals[0];
  const cmp = compareTotals[0];
  const rewardLines = facet.items.reduce((s, r) => s + r.rewardValue, 0);

  return {
    range,
    compare: { ...compareRange(range), label: compareLabel(range) },
    kpis: {
      current: { qty: items.reduce((s, r) => s + r.qty, 0), sales: totalSales },
      previous: { qty: cmp?.qty ?? 0, sales: cmp?.sales ?? 0 },
    },
    items,
    categories,
    money: pickMoneyBreakdown(totals),
    rewardLines,
    netSales: totals?.sales ?? 0,
  };
}

export interface FoldItemDetailInput {
  range: DashboardRange;
  key: string;
  label: string;
  mode: DashboardSeriesMode;
  rows: ItemSeriesRow[];
  voids: ItemVoidsRow[];
}

export function foldItemDetail({ range, key, label, mode, rows, voids }: FoldItemDetailInput): ItemDetail {
  const points = rows
    .filter((r) => r.qty > 0)
    .map((r) =>
      mode === "hour"
        ? { key: String(r._id), label: hourLabel(Number(r._id)), qty: r.qty, sales: r.sales }
        : { key: String(r._id), label: dayLabel(String(r._id)), qty: r.qty, sales: r.sales },
    );
  points.sort((a, b) => (mode === "hour" ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key)));

  return {
    range,
    key,
    label,
    mode,
    points,
    removed: { qty: voids[0]?.qty ?? 0, value: voids[0]?.value ?? 0 },
  };
}
