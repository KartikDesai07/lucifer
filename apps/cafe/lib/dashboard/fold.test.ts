// Facet rows -> DashboardData pieces — pure, DB-free. Every expected value is
// a LITERAL hand-computed against the fold rule in fold.ts's own comments,
// never recomputed with the code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldKpis,
  deltaRatio,
  buildSeries,
  foldPayments,
  foldChannels,
  foldTopItems,
  foldCategories,
  categoryOf,
  foldSlowItems,
  foldHeat,
  TOP_ITEMS_LIMIT,
  SLOW_ITEMS_LIMIT,
  CATEGORY_LIMIT,
  OTHER_CATEGORIES_LABEL,
  REMOVED_ITEMS_LABEL,
  UNCATEGORISED_LABEL,
  CHANNEL_LABELS,
  type ProductRef,
} from "@/lib/dashboard/fold";
import type { AmountRow, HeatRow, ItemRow, SeriesRow, TotalsRow } from "@/lib/dashboard/pipelines";
import { channelOf } from "@/lib/dashboard/pipelines";
import { SELF_ORDER_SOURCE } from "@pos/shared/public";

// ── foldKpis ─────────────────────────────────────────────────────────────────

test("foldKpis: an undefined row folds to all zeros", () => {
  assert.deepEqual(foldKpis(undefined), { sales: 0, orders: 0, averageOrder: 0, collected: 0 });
});

test("foldKpis: averageOrder = sales / orders when orders > 0", () => {
  const row: TotalsRow = { orders: 4, sales: 1000, collected: 800 };
  assert.deepEqual(foldKpis(row), { sales: 1000, orders: 4, averageOrder: 250, collected: 800 });
});

test("foldKpis: averageOrder is 0 (not NaN/Infinity) when orders is 0", () => {
  const row: TotalsRow = { orders: 0, sales: 0, collected: 0 };
  assert.deepEqual(foldKpis(row), { sales: 0, orders: 0, averageOrder: 0, collected: 0 });
});

// ── deltaRatio ───────────────────────────────────────────────────────────────

test("deltaRatio: previous 0 -> null (never +-Infinity)", () => {
  assert.equal(deltaRatio(500, 0), null);
  assert.equal(deltaRatio(0, 0), null);
});

test("deltaRatio: signed change vs the comparison, including a negative one", () => {
  assert.equal(deltaRatio(1200, 1000), 0.2);
  assert.equal(deltaRatio(800, 1000), -0.2);
});

// ── buildSeries: hour mode ───────────────────────────────────────────────────

test("buildSeries hour mode: contiguous span across BOTH current and previous, zero-filled gaps, labels", () => {
  const current: SeriesRow[] = [
    { _id: 9, sales: 500, orders: 2 },
    { _id: 12, sales: 1000, orders: 3 },
  ];
  // previous has an hour (14) later than anything current sold — the span
  // must stretch to cover it too (min across BOTH, max across BOTH).
  const previous: SeriesRow[] = [
    { _id: 10, sales: 300, orders: 1 },
    { _id: 14, sales: 700, orders: 2 },
  ];
  const points = buildSeries("hour", { from: "2026-09-29", to: "2026-09-29" }, current, previous);
  assert.equal(points.length, 6); // hours 9..14 inclusive
  assert.deepEqual(
    points.map((p) => p.key),
    ["9", "10", "11", "12", "13", "14"],
  );
  // hour 9: current has a row, previous does not (compareSales 0)
  assert.deepEqual(points[0], {
    key: "9",
    label: "9 am",
    sales: 500,
    orders: 2,
    compareLabel: "9 am",
    compareSales: 0,
  });
  // hour 10: current has NO row (zero-filled), previous does
  assert.deepEqual(points[1], {
    key: "10",
    label: "10 am",
    sales: 0,
    orders: 0,
    compareLabel: "10 am",
    compareSales: 300,
  });
  // hour 11: neither side has a row — a pure gap
  assert.deepEqual(points[2], {
    key: "11",
    label: "11 am",
    sales: 0,
    orders: 0,
    compareLabel: "11 am",
    compareSales: 0,
  });
  // hour 12: current has a row, previous does not
  assert.deepEqual(points[3], {
    key: "12",
    label: "12 pm",
    sales: 1000,
    orders: 3,
    compareLabel: "12 pm",
    compareSales: 0,
  });
  // hour 14: only previous has a row, at the very end of the span
  assert.deepEqual(points[5], {
    key: "14",
    label: "2 pm",
    sales: 0,
    orders: 0,
    compareLabel: "2 pm",
    compareSales: 700,
  });
});

test("buildSeries hour mode: no rows on either side returns an empty array", () => {
  assert.deepEqual(buildSeries("hour", { from: "2026-09-29", to: "2026-09-29" }, [], []), []);
});

// ── buildSeries: day mode ────────────────────────────────────────────────────

test("buildSeries day mode: every day of the range incl. zero days, compare aligned by the shift, labels", () => {
  // A 3-day range (28..30 Sep) -> compareShiftDays = 3 (rangeDays !== 1).
  const range = { from: "2026-09-28", to: "2026-09-30" };
  const current: SeriesRow[] = [
    { _id: "2026-09-28", sales: 1000, orders: 5 },
    // 2026-09-29 deliberately has NO row -> a zero day must still appear.
    { _id: "2026-09-30", sales: 2000, orders: 8 },
  ];
  const previous: SeriesRow[] = [
    { _id: "2026-09-25", sales: 400, orders: 2 }, // aligns with 28 Sep (shift 3)
    { _id: "2026-09-26", sales: 300, orders: 1 }, // aligns with 29 Sep
    { _id: "2026-09-27", sales: 900, orders: 4 }, // aligns with 30 Sep
  ];
  const points = buildSeries("day", range, current, previous);
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], {
    key: "2026-09-28",
    label: "28 Sep",
    sales: 1000,
    orders: 5,
    compareLabel: "25 Sep",
    compareSales: 400,
  });
  assert.deepEqual(points[1], {
    key: "2026-09-29",
    label: "29 Sep",
    sales: 0,
    orders: 0,
    compareLabel: "26 Sep",
    compareSales: 300,
  });
  assert.deepEqual(points[2], {
    key: "2026-09-30",
    label: "30 Sep",
    sales: 2000,
    orders: 8,
    compareLabel: "27 Sep",
    compareSales: 900,
  });
});

// ── foldPayments ─────────────────────────────────────────────────────────────

test("foldPayments: only the 5 settlement modes, unknown mode dropped, zero rows dropped, sorted desc, shares sum to 1", () => {
  const rows: AmountRow[] = [
    { _id: "Cash", amount: 600, count: 3 },
    { _id: "Online", amount: 400, count: 2 },
    { _id: "Due", amount: 0, count: 0 }, // must be dropped (amount 0 AND count 0)
    { _id: "Unpaid", amount: 999, count: 5 }, // not a settlement mode -- must be dropped entirely
  ];
  const result = foldPayments(rows);
  assert.deepEqual(
    result.map((r) => r.key),
    ["Cash", "Online"], // Split/Credit both zero -> dropped; Due zero -> dropped; sorted desc by amount
  );
  assert.deepEqual(result[0], { key: "Cash", label: "Cash", amount: 600, count: 3, share: 0.6 });
  assert.deepEqual(result[1], { key: "Online", label: "Online", amount: 400, count: 2, share: 0.4 });
  const shareSum = result.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9, `shares must sum to 1, got ${shareSum}`);
});

test("foldPayments: an order with a positive count but zero amount is kept (count > 0 is enough)", () => {
  const rows: AmountRow[] = [{ _id: "Due", amount: 0, count: 1 }];
  const result = foldPayments(rows);
  assert.deepEqual(
    result.map((r) => r.key),
    ["Due"],
  );
  assert.equal(result[0].share, 0); // total amount 0 -> share 0, never NaN
});

// ── foldChannels ─────────────────────────────────────────────────────────────

test("foldChannels: labels and sort", () => {
  const rows: AmountRow[] = [
    { _id: "dine-in", amount: 1000, count: 4 },
    { _id: "qr", amount: 500, count: 2 },
    { _id: "counter", amount: 1500, count: 6 },
    // "takeaway" absent -> zero -> dropped
  ];
  const result = foldChannels(rows);
  assert.deepEqual(
    result.map((r) => r.key),
    ["counter", "dine-in", "qr"],
  );
  assert.equal(result[0].label, CHANNEL_LABELS.counter);
  assert.equal(result[1].label, CHANNEL_LABELS["dine-in"]);
  assert.equal(result[2].label, CHANNEL_LABELS.qr);
});

// ── foldTopItems ─────────────────────────────────────────────────────────────

test("foldTopItems: merges the same label across different productIds, revenue desc then qty desc, limited to 5", () => {
  const rows: ItemRow[] = [
    { _id: { productId: "p1", label: "Tea" }, qty: 5, revenue: 250 },
    { _id: { productId: "p2", label: "Tea" }, qty: 3, revenue: 150 }, // same label, different productId -> merges
    { _id: { productId: "p3", label: "Coffee" }, qty: 10, revenue: 500 },
    { _id: { productId: "p4", label: "Samosa" }, qty: 20, revenue: 400 },
    { _id: { productId: "p5", label: "Cold Drink" }, qty: 1, revenue: 40 },
    { _id: { productId: "p6", label: "Juice" }, qty: 1, revenue: 30 },
    { _id: { productId: "p7", label: "Water" }, qty: 1, revenue: 20 },
  ];
  const result = foldTopItems(rows);
  assert.equal(result.length, TOP_ITEMS_LIMIT);
  // Tea merges to qty 8, revenue 400 -- ranks second, behind Coffee's 500.
  assert.deepEqual(result[0], { label: "Coffee", qty: 10, revenue: 500 });
  assert.deepEqual(result[1], { label: "Samosa", qty: 20, revenue: 400 });
  assert.deepEqual(result[2], { label: "Tea", qty: 8, revenue: 400 }); // ties Samosa on revenue, loses on qty
  assert.deepEqual(result[3], { label: "Cold Drink", qty: 1, revenue: 40 });
  assert.deepEqual(result[4], { label: "Juice", qty: 1, revenue: 30 });
});

// ── foldCategories ───────────────────────────────────────────────────────────

test("foldCategories: product -> category name via the two maps", () => {
  const rows: ItemRow[] = [{ _id: { productId: "p1", label: "Tea" }, qty: 5, revenue: 250 }];
  const productCategory = new Map([["p1", "c1"]]);
  const categoryName = new Map([["c1", "Beverages"]]);
  const result = foldCategories(rows, productCategory, categoryName);
  assert.deepEqual(result, [{ key: "c1", label: "Beverages", amount: 250, count: 5, share: 1 }]);
});

test('foldCategories: a sold product missing from the product map lands in "Removed items"', () => {
  const rows: ItemRow[] = [{ _id: { productId: "gone", label: "Ghost Dish" }, qty: 2, revenue: 100 }];
  const result = foldCategories(rows, new Map(), new Map());
  assert.deepEqual(result, [
    { key: REMOVED_ITEMS_LABEL, label: REMOVED_ITEMS_LABEL, amount: 100, count: 2, share: 1 },
  ]);
});

test('foldCategories: a product whose category id no longer resolves lands in "Uncategorised"', () => {
  const rows: ItemRow[] = [{ _id: { productId: "p1", label: "Tea" }, qty: 5, revenue: 250 }];
  const productCategory = new Map([["p1", "deletedCat"]]);
  const result = foldCategories(rows, productCategory, new Map()); // categoryName has no "deletedCat"
  assert.deepEqual(result, [
    { key: UNCATEGORISED_LABEL, label: UNCATEGORISED_LABEL, amount: 250, count: 5, share: 1 },
  ]);
});

test(`foldCategories: more than ${CATEGORY_LIMIT} categories folds the tail into "${OTHER_CATEGORIES_LABEL}" with summed amount/share`, () => {
  // 8 categories, descending amounts 800,700,600,500,400,300,200,100 (sum 3600).
  const amounts = [800, 700, 600, 500, 400, 300, 200, 100];
  const rows: ItemRow[] = amounts.map((amount, i) => ({
    _id: { productId: `p${i}`, label: `Item${i}` },
    qty: 1,
    revenue: amount,
  }));
  const productCategory = new Map(amounts.map((_, i) => [`p${i}`, `c${i}`]));
  const categoryName = new Map(amounts.map((_, i) => [`c${i}`, `Cat${i}`]));
  const result = foldCategories(rows, productCategory, categoryName);
  // CATEGORY_LIMIT = 6: top 5 stay named, the rest (3 lowest: 300,200,100=600) fold into "Other categories".
  assert.equal(result.length, CATEGORY_LIMIT);
  assert.deepEqual(
    result.slice(0, 5).map((r) => r.label),
    ["Cat0", "Cat1", "Cat2", "Cat3", "Cat4"],
  );
  const other = result[5];
  assert.equal(other.key, OTHER_CATEGORIES_LABEL);
  assert.equal(other.label, OTHER_CATEGORIES_LABEL);
  assert.equal(other.amount, 300 + 200 + 100);
  assert.equal(other.count, 3);
  const totalShare = result.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(totalShare - 1) < 1e-9, `shares must sum to 1, got ${totalShare}`);
});

// ── categoryOf (extracted for Reports' items table, Batch 2) ────────────────

test("categoryOf: resolves productId -> category name via the two maps", () => {
  const productCategory = new Map([["p1", "c1"]]);
  const categoryName = new Map([["c1", "Beverages"]]);
  assert.deepEqual(categoryOf("p1", productCategory, categoryName), { key: "c1", label: "Beverages" });
});

test('categoryOf: a productId missing from the map -> "Removed items"', () => {
  assert.deepEqual(categoryOf("gone", new Map(), new Map()), { key: REMOVED_ITEMS_LABEL, label: REMOVED_ITEMS_LABEL });
});

test('categoryOf: a category id that no longer resolves -> "Uncategorised"', () => {
  const productCategory = new Map([["p1", "deletedCat"]]);
  assert.deepEqual(categoryOf("p1", productCategory, new Map()), { key: UNCATEGORISED_LABEL, label: UNCATEGORISED_LABEL });
});

// ── foldSlowItems ────────────────────────────────────────────────────────────

test("foldSlowItems: zero sellers rank first, then by name, limited to 5", () => {
  const candidates: ProductRef[] = [
    { id: "p1", name: "Zebra Cake", categoryId: "c1" },
    { id: "p2", name: "Apple Pie", categoryId: "c1" }, // 0 qty too -- name breaks the tie
    { id: "p3", name: "Best Seller", categoryId: "c1" },
    { id: "p4", name: "Second Best", categoryId: "c1" },
    { id: "p5", name: "Third", categoryId: "c1" },
    { id: "p6", name: "Fourth", categoryId: "c1" },
    { id: "p7", name: "Fifth", categoryId: "c1" },
  ];
  const qtyByProduct = new Map([
    ["p3", 100],
    ["p4", 50],
    ["p5", 20],
    ["p6", 10],
    ["p7", 5],
    // p1, p2 absent -> 0 (never sold)
  ]);
  const result = foldSlowItems(candidates, qtyByProduct);
  assert.equal(result.length, SLOW_ITEMS_LIMIT);
  // Both zero-qty items come first, sorted by name: "Apple Pie" < "Zebra Cake".
  assert.deepEqual(result[0], { productId: "p2", name: "Apple Pie", qty: 0 });
  assert.deepEqual(result[1], { productId: "p1", name: "Zebra Cake", qty: 0 });
  assert.deepEqual(result[2], { productId: "p7", name: "Fifth", qty: 5 });
  assert.deepEqual(result[3], { productId: "p6", name: "Fourth", qty: 10 });
  assert.deepEqual(result[4], { productId: "p5", name: "Third", qty: 20 });
});

// ── foldHeat ─────────────────────────────────────────────────────────────────

test("foldHeat: Monday-first rows, contiguous hours, averages rounded to 1 decimal, max, empty -> hours []", () => {
  // 2-week window, 2026-09-14 (Mon) .. 2026-09-27 (Sun) -> weekdayCounts = [2,2,2,2,2,2,2]
  const window = { from: "2026-09-14", to: "2026-09-27" };
  const rows: HeatRow[] = [
    // Monday (isoDayOfWeek 1) at hour 9: 3 orders total over 2 Mondays -> 1.5 avg
    { _id: { dow: 1, hour: 9 }, orders: 3 },
    // Monday at hour 10: 1 order over 2 Mondays -> 0.5 avg (this is also the MAX candidate check below)
    { _id: { dow: 1, hour: 10 }, orders: 1 },
    // Wednesday (isoDayOfWeek 3, weekday index 2) at hour 9: 4 orders over 2 Wednesdays -> 2.0 avg (the max)
    { _id: { dow: 3, hour: 9 }, orders: 4 },
  ];
  const heat = foldHeat(rows, window);
  assert.equal(heat.from, "2026-09-14");
  assert.equal(heat.to, "2026-09-27");
  // Contiguous hours 9..10 (min/max across the seen rows).
  assert.deepEqual(heat.hours, [9, 10]);
  assert.equal(heat.avg.length, 7); // one row per weekday, Monday first
  assert.equal(heat.avg[0][0], 1.5); // Monday, hour 9
  assert.equal(heat.avg[0][1], 0.5); // Monday, hour 10
  assert.equal(heat.avg[2][0], 2); // Wednesday, hour 9
  assert.equal(heat.avg[2][1], 0); // Wednesday, hour 10: no row -> 0
  // Every other weekday/hour cell is 0.
  assert.equal(heat.avg[1][0], 0);
  assert.equal(heat.avg[6][1], 0);
  assert.equal(heat.max, 2);
});

test("foldHeat: no rows at all -> hours [] and every avg row empty", () => {
  const window = { from: "2026-09-14", to: "2026-09-27" };
  const heat = foldHeat([], window);
  assert.deepEqual(heat.hours, []);
  assert.equal(heat.avg.length, 7);
  for (const row of heat.avg) assert.deepEqual(row, []);
  assert.equal(heat.max, 0);
});

// ── channelOf (pipelines.ts JS twin of CHANNEL_EXPR) ────────────────────────

test("channelOf: precedence — source qr beats parcel beats a non-empty tableNo; a blank tableNo is counter", () => {
  // qr wins even when parcel and tableNo are ALSO set.
  assert.equal(channelOf({ source: SELF_ORDER_SOURCE, parcel: true, tableNo: "T-1" }), "qr");
  // parcel wins over tableNo when source is not qr.
  assert.equal(channelOf({ parcel: true, tableNo: "T-1" }), "takeaway");
  // a non-empty tableNo alone -> dine-in.
  assert.equal(channelOf({ tableNo: "T-1" }), "dine-in");
  // "" tableNo (falsy length) -> counter, same as no tableNo at all.
  assert.equal(channelOf({ tableNo: "" }), "counter");
  assert.equal(channelOf({}), "counter");
  // parcel explicitly false does not win over a real tableNo.
  assert.equal(channelOf({ parcel: false, tableNo: "T-2" }), "dine-in");
});

test("foldSlowItems: a newer dish is judged per day ON THE MENU, and carries its since day", () => {
  const candidates: ProductRef[] = [
    // On the menu the whole 28-day window: 3 sold -> 3/28 = 0.107 a day.
    { id: "old", name: "Old Dish", categoryId: "c1", days: 28 },
    // Joined 10 days ago: 2 sold -> 2/10 = 0.2 a day -> FASTER than Old Dish despite fewer units.
    { id: "new", name: "New Dish", categoryId: "c1", days: 10, since: "2026-09-19" },
    // Whole window, never sold -> 0 a day -> slowest.
    { id: "zero", name: "Zero Dish", categoryId: "c1", days: 28 },
  ];
  const qtyByProduct = new Map([
    ["old", 3],
    ["new", 2],
  ]);
  const result = foldSlowItems(candidates, qtyByProduct);
  assert.deepEqual(
    result.map((r) => r.name),
    ["Zero Dish", "Old Dish", "New Dish"],
    "0/28 < 3/28 < 2/10 — ranked by units per day on the menu, not raw units",
  );
  assert.equal(result[2].since, "2026-09-19", "a dish that joined inside the window says since when");
  assert.equal("since" in result[1], false, "a whole-window dish carries no since key");
});
