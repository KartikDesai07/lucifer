// foldItemsReport / foldItemDetail — pure, DB-free. Every expected value is
// hand-computed against the ItemsReport contract's own comments (never
// recomputed with the code under test), mirroring sales-fold.test.ts's idiom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldItemDetail, foldItemsReport } from "@/lib/reports/items-fold";
import { UNCATEGORISED_LABEL, REMOVED_ITEMS_LABEL } from "@/lib/dashboard/fold";
import type { ItemsFacet, ItemsFacetRow } from "@/lib/reports/items-pipelines";

function itemRow(over: Partial<ItemsFacetRow> & { _id: ItemsFacetRow["_id"] }): ItemsFacetRow {
  return { qty: 0, freeQty: 0, revenue: 0, rewardValue: 0, ...over };
}

test("foldItemsReport: sorts items sales desc/qty desc/label asc, computes share, and builds categories with NO Other folding", () => {
  const facet: ItemsFacet = {
    items: [
      itemRow({ _id: { productId: "p1", label: "Tea" }, qty: 5, revenue: 250 }),
      itemRow({ _id: { productId: "p2", label: "Coffee" }, qty: 10, revenue: 500 }),
      itemRow({ _id: { productId: "p3", label: "Samosa" }, qty: 20, revenue: 250 }), // ties Tea's revenue, wins on qty
    ],
    totals: [{ orders: 3, sales: 1000, gross: 1000, discount: 0, reward: 0, gst: 0, charges: 0 }],
  };
  const productCategory = new Map([
    ["p1", "c1"],
    ["p2", "c1"],
    ["p3", "c2"],
  ]);
  const categoryName = new Map([
    ["c1", "Beverages"],
    ["c2", "Snacks"],
  ]);
  const report = foldItemsReport({
    range: { from: "2026-09-29", to: "2026-09-29" },
    facet,
    compareTotals: [],
    productCategory,
    categoryName,
  });

  assert.deepEqual(
    report.items.map((i) => i.label),
    ["Coffee", "Samosa", "Tea"],
  );
  const total = 250 + 500 + 250;
  assert.equal(report.items[0].share, 500 / total);
  assert.equal(report.items[1].key, "p3|Samosa");
  assert.equal(report.kpis.current.qty, 35);
  assert.equal(report.kpis.current.sales, total);
  assert.equal(report.netSales, 1000);

  // Categories: Beverages (Tea+Coffee = 2 items, 15 qty, 750 sales) beats
  // Snacks (1 item, 20 qty, 250 sales) — no cap/Other folding at all.
  assert.equal(report.categories.length, 2);
  assert.deepEqual(report.categories[0], { key: "c1", label: "Beverages", items: 2, qty: 15, sales: 750, share: 750 / total });
  assert.deepEqual(report.categories[1], { key: "c2", label: "Snacks", items: 1, qty: 20, sales: 250, share: 250 / total });
});

test("foldItemsReport: a removed product -> Removed items, an uncategorised one -> Uncategorised (categoryOf's own rule)", () => {
  const facet: ItemsFacet = {
    items: [
      itemRow({ _id: { productId: "gone", label: "Ghost Dish" }, qty: 2, revenue: 100 }),
      itemRow({ _id: { productId: "p1", label: "Mystery" }, qty: 1, revenue: 50 }),
    ],
    totals: [{ orders: 1, sales: 150, gross: 150, discount: 0, reward: 0, gst: 0, charges: 0 }],
  };
  const productCategory = new Map([["p1", "deletedCat"]]);
  const report = foldItemsReport({
    range: { from: "2026-09-29", to: "2026-09-29" },
    facet,
    compareTotals: [],
    productCategory,
    categoryName: new Map(),
  });
  const byLabel = new Map(report.items.map((i) => [i.label, i]));
  assert.equal(byLabel.get("Ghost Dish")?.categoryName, REMOVED_ITEMS_LABEL);
  assert.equal(byLabel.get("Mystery")?.categoryName, UNCATEGORISED_LABEL);
});

test("foldItemsReport: freeQty is inside qty, never inside sales; rewardLines sums rewardValue; empty range -> shares 0 not NaN", () => {
  const facet: ItemsFacet = {
    items: [itemRow({ _id: { productId: "p1", label: "Reward Cake" }, qty: 3, freeQty: 1, revenue: 200, rewardValue: 80 })],
    totals: [{ orders: 1, sales: 200, gross: 280, discount: 0, reward: 80, gst: 0, charges: 0 }],
  };
  const report = foldItemsReport({
    range: { from: "2026-09-29", to: "2026-09-29" },
    facet,
    compareTotals: [],
    productCategory: new Map(),
    categoryName: new Map(),
  });
  assert.equal(report.items[0].qty, 3);
  assert.equal(report.items[0].freeQty, 1);
  assert.equal(report.items[0].sales, 200);
  assert.equal(report.rewardLines, 80);

  const emptyReport = foldItemsReport({
    range: { from: "2026-09-29", to: "2026-09-29" },
    facet: { items: [], totals: [] },
    compareTotals: [],
    productCategory: new Map(),
    categoryName: new Map(),
  });
  assert.deepEqual(emptyReport.items, []);
  assert.deepEqual(emptyReport.categories, []);
  assert.equal(emptyReport.kpis.current.sales, 0);
});

// ── foldItemDetail ───────────────────────────────────────────────────────────

test("foldItemDetail day mode: drops zero-qty buckets, sorts chronologically, labels via dayLabel", () => {
  const detail = foldItemDetail({
    range: { from: "2026-09-27", to: "2026-09-29" },
    key: "p1|Tea",
    label: "Tea",
    mode: "day",
    rows: [
      { _id: "2026-09-29", qty: 2, sales: 100 },
      { _id: "2026-09-27", qty: 0, sales: 0 }, // must be dropped
      { _id: "2026-09-28", qty: 5, sales: 250 },
    ],
    voids: [],
  });
  assert.deepEqual(
    detail.points.map((p) => p.key),
    ["2026-09-28", "2026-09-29"],
  );
  assert.equal(detail.points[0].label, "28 Sep");
  assert.deepEqual(detail.removed, { qty: 0, value: 0 });
});

test("foldItemDetail hour mode: numeric sort, key stringified, label via hourLabel", () => {
  const detail = foldItemDetail({
    range: { from: "2026-09-29", to: "2026-09-29" },
    key: "|Tea",
    label: "Tea",
    mode: "hour",
    rows: [
      { _id: 14, qty: 1, sales: 50 },
      { _id: 9, qty: 2, sales: 100 },
    ],
    voids: [{ qty: 1, value: 50 }],
  });
  assert.deepEqual(
    detail.points.map((p) => p.key),
    ["9", "14"],
  );
  assert.equal(detail.points[0].label, "9 am");
  assert.equal(detail.points[1].label, "2 pm");
  assert.deepEqual(detail.removed, { qty: 1, value: 50 });
});
