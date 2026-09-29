// Facet rows → DashboardData pieces. Pure (no DB), so every widget number is
// unit-testable; lib/dashboard/build.ts only fetches and hands rows here.
import { SETTLEMENT_PAY_MODES, type SettlementPayMode } from "@/lib/constants";
import {
  addDays,
  compareShiftDays,
  dayLabel,
  hourLabel,
  weekdayCounts,
} from "@/lib/dashboard/range";
import type { AmountRow, HeatRow, ItemRow, SeriesRow, TotalsRow } from "@/lib/dashboard/pipelines";
import type {
  DashboardChannel,
  DashboardHeat,
  DashboardItemRow,
  DashboardKpis,
  DashboardRange,
  DashboardSeriesMode,
  DashboardSeriesPoint,
  DashboardShareRow,
  DashboardSlowItem,
} from "@/types/dashboard";

export const TOP_ITEMS_LIMIT = 5;
export const SLOW_ITEMS_LIMIT = 5;
export const CATEGORY_LIMIT = 6;
export const OTHER_CATEGORIES_LABEL = "Other categories";
export const REMOVED_ITEMS_LABEL = "Removed items"; // the product itself no longer exists
export const UNCATEGORISED_LABEL = "Uncategorised"; // the product's category was deleted
const HEAT_DECIMALS = 10; // one decimal place on "orders per day"
const ISO_MONDAY = 1;

export const CHANNEL_LABELS: Readonly<Record<DashboardChannel, string>> = {
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  qr: "QR self-order",
  counter: "Counter",
};
export const CHANNELS = Object.keys(CHANNEL_LABELS) as DashboardChannel[];

export function foldKpis(row: TotalsRow | undefined): DashboardKpis {
  const sales = row?.sales ?? 0;
  const orders = row?.orders ?? 0;
  return { sales, orders, averageOrder: orders > 0 ? sales / orders : 0, collected: row?.collected ?? 0 };
}

/** Signed change vs the comparison, or null when there is nothing to compare with (never ±Infinity). */
export function deltaRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

const byKey = (rows: SeriesRow[]) => new Map(rows.map((r) => [String(r._id), r]));

/**
 * The main chart. By hour: the contiguous span of hours either day sold in
 * (no row of empty leading/trailing hours). By day: every day of the range,
 * zero days included (a gap in a trend is information), each aligned with the
 * comparison day the same shift earlier.
 */
export function buildSeries(
  mode: DashboardSeriesMode,
  range: DashboardRange,
  current: SeriesRow[],
  previous: SeriesRow[],
): DashboardSeriesPoint[] {
  const cur = byKey(current);
  const prev = byKey(previous);
  if (mode === "hour") {
    const hours = [...cur.keys(), ...prev.keys()].map(Number);
    if (hours.length === 0) return [];
    const points: DashboardSeriesPoint[] = [];
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
      const key = String(h);
      points.push({
        key,
        label: hourLabel(h),
        sales: cur.get(key)?.sales ?? 0,
        orders: cur.get(key)?.orders ?? 0,
        compareLabel: hourLabel(h),
        compareSales: prev.get(key)?.sales ?? 0,
      });
    }
    return points;
  }
  const shift = compareShiftDays(range);
  const points: DashboardSeriesPoint[] = [];
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
    const cmp = addDays(key, -shift);
    points.push({
      key,
      label: dayLabel(key),
      sales: cur.get(key)?.sales ?? 0,
      orders: cur.get(key)?.orders ?? 0,
      compareLabel: dayLabel(cmp),
      compareSales: prev.get(cmp)?.sales ?? 0,
    });
  }
  return points;
}

function withShares<K extends string>(rows: Array<Omit<DashboardShareRow, "share"> & { key: K }>) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows
    .filter((r) => r.amount > 0 || r.count > 0)
    .sort((a, b) => b.amount - a.amount || b.count - a.count)
    .map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 }));
}

/** Payment mix — the five settlement modes only (collected money, paidAmount). */
export function foldPayments(rows: AmountRow[]): Array<DashboardShareRow & { key: SettlementPayMode }> {
  const byMode = new Map(rows.map((r) => [r._id, r]));
  return withShares(
    SETTLEMENT_PAY_MODES.map((mode) => ({
      key: mode,
      label: mode,
      amount: byMode.get(mode)?.amount ?? 0,
      count: byMode.get(mode)?.count ?? 0,
    })),
  );
}

export function foldChannels(rows: AmountRow[]): Array<DashboardShareRow & { key: DashboardChannel }> {
  const byChannel = new Map(rows.map((r) => [r._id, r]));
  return withShares(
    CHANNELS.map((c) => ({
      key: c,
      label: CHANNEL_LABELS[c],
      amount: byChannel.get(c)?.amount ?? 0,
      count: byChannel.get(c)?.count ?? 0,
    })),
  );
}

/** Best sellers by revenue (qty breaks a tie — a free-dish-only line still ranks by how often it went out). */
export function foldTopItems(rows: ItemRow[]): DashboardItemRow[] {
  const byLabel = new Map<string, DashboardItemRow>();
  for (const r of rows) {
    const row = byLabel.get(r._id.label) ?? { label: r._id.label, qty: 0, revenue: 0 };
    row.qty += r.qty;
    row.revenue += r.revenue;
    byLabel.set(r._id.label, row);
  }
  return [...byLabel.values()]
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.label.localeCompare(b.label))
    .slice(0, TOP_ITEMS_LIMIT);
}

export interface ProductRef {
  id: string;
  name: string;
  categoryId: string;
  /** Days it has been on the menu inside the insight window (absent = the whole window). */
  days?: number;
  /** IST day it joined the menu, when that was inside the window. */
  since?: string;
}

/**
 * A sold product -> its category, by the Dashboard's own rule: a product
 * missing from the map lands in "Removed items", one whose category id no
 * longer resolves lands in "Uncategorised". Shared with Reports' items table
 * (lib/reports/items-fold.ts) so both screens can never disagree.
 */
export function categoryOf(
  productId: unknown,
  productCategory: ReadonlyMap<string, string>,
  categoryName: ReadonlyMap<string, string>,
): { key: string; label: string } {
  const catId = productCategory.get(String(productId));
  const name = catId ? categoryName.get(catId) : undefined;
  const label = name ?? (catId ? UNCATEGORISED_LABEL : REMOVED_ITEMS_LABEL);
  const key = name && catId ? catId : label;
  return { key, label };
}

/** Revenue by menu category; a sold product that no longer exists lands in "Removed items". */
export function foldCategories(
  rows: ItemRow[],
  productCategory: ReadonlyMap<string, string>,
  categoryName: ReadonlyMap<string, string>,
): DashboardShareRow[] {
  const byCategory = new Map<string, { label: string; amount: number; count: number }>();
  for (const r of rows) {
    const { key, label } = categoryOf(r._id.productId, productCategory, categoryName);
    const row = byCategory.get(key) ?? { label, amount: 0, count: 0 };
    row.amount += r.revenue;
    row.count += r.qty;
    byCategory.set(key, row);
  }
  const ranked = withShares([...byCategory].map(([key, v]) => ({ key, ...v })));
  if (ranked.length <= CATEGORY_LIMIT) return ranked;
  const head = ranked.slice(0, CATEGORY_LIMIT - 1);
  const tail = ranked.slice(CATEGORY_LIMIT - 1);
  const other = tail.reduce(
    (acc, r) => ({ ...acc, amount: acc.amount + r.amount, count: acc.count + r.count, share: acc.share + r.share }),
    { key: OTHER_CATEGORIES_LABEL, label: OTHER_CATEGORIES_LABEL, amount: 0, count: 0, share: 0 },
  );
  return [...head, other];
}

/**
 * Slowest movers: items on sale (active + available), slowest first by units
 * per day ON THE MENU — so a dish added ten days ago is judged on its ten days,
 * not on four weeks it was never offered. A dish that sold nothing at all is
 * the point, so it ranks first (a sold-rows-only query would never show it).
 */
export function foldSlowItems(
  candidates: ReadonlyArray<ProductRef>,
  qtyByProduct: ReadonlyMap<string, number>,
): DashboardSlowItem[] {
  return candidates
    .map((p) => {
      const qty = qtyByProduct.get(p.id) ?? 0;
      return { item: { productId: p.id, name: p.name, qty, ...(p.since ? { since: p.since } : {}) }, rate: qty / (p.days ?? 1) };
    })
    .sort((a, b) => a.rate - b.rate || a.item.qty - b.item.qty || a.item.name.localeCompare(b.item.name))
    .slice(0, SLOW_ITEMS_LIMIT)
    .map((r) => r.item);
}

/** Orders per (weekday, hour), averaged over how many of that weekday the window holds. */
export function foldHeat(rows: HeatRow[], window: DashboardRange): DashboardHeat {
  const counts = weekdayCounts(window);
  const hoursSeen = rows.map((r) => r._id.hour);
  const hours: number[] = [];
  if (hoursSeen.length > 0) {
    for (let h = Math.min(...hoursSeen); h <= Math.max(...hoursSeen); h++) hours.push(h);
  }
  const avg = counts.map(() => hours.map(() => 0));
  let max = 0;
  for (const r of rows) {
    const weekday = r._id.dow - ISO_MONDAY;
    const days = counts[weekday] ?? 0;
    if (days === 0) continue;
    const value = Math.round((r.orders / days) * HEAT_DECIMALS) / HEAT_DECIMALS;
    avg[weekday][hours.indexOf(r._id.hour)] = value;
    max = Math.max(max, value);
  }
  return { from: window.from, to: window.to, hours, avg, max };
}
