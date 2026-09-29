// Pure pipeline-SHAPE pins (no DB) — pins the stage structure so a future
// edit cannot silently swap a wiring twin (e.g. revenue summing the wrong
// expression) without a red test, mirroring sales-pipelines.test.ts's idiom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { itemDetailPipeline, itemVoidsPipeline, itemsCompareTotals, itemsFacet } from "@/lib/reports/items-pipelines";
import { ITEM_LABEL_EXPR, VOID_VALUE_EXPR, itemLabelExpr } from "@/lib/dashboard/pipelines";
import { ITEM_REVENUE_EXPR, MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import type { PipelineStage } from "mongoose";

const WINDOW = { start: new Date("2026-09-29T00:00:00Z"), end: new Date("2026-09-29T23:59:59Z") };

test("itemsFacet: the FIRST stage matches the window AND status Completed", () => {
  const stages = itemsFacet(WINDOW);
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(match.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.equal(match.$match.status, "Completed");
});

test("itemsFacet: items $group keys by (productId, ITEM_LABEL_EXPR) and wires qty/freeQty/revenue/rewardValue", () => {
  const stages = itemsFacet(WINDOW);
  const facetStage = stages[1] as { $facet: { items: PipelineStage[] } };
  const group = facetStage.$facet.items[1] as { $group: Record<string, unknown> };
  const id = group.$group._id as { productId: string; label: unknown };
  assert.equal(id.productId, "$items.productId");
  assert.deepEqual(id.label, ITEM_LABEL_EXPR);
  assert.deepEqual(group.$group.qty, { $sum: "$items.qty" });
  assert.deepEqual(group.$group.revenue, { $sum: ITEM_REVENUE_EXPR });
  // Wiring, not just presence: freeQty/rewardValue must key off items.reward.
  assert.ok(JSON.stringify(group.$group.freeQty).includes("items.reward"));
  assert.ok(JSON.stringify(group.$group.rewardValue).includes("items.reward"));
});

test("itemsFacet: totals facet carries orders/sales + every MONEY_BREAKDOWN_GROUP key", () => {
  const stages = itemsFacet(WINDOW);
  const facetStage = stages[1] as { $facet: { totals: PipelineStage[] } };
  const group = facetStage.$facet.totals[0] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group.orders, { $sum: 1 });
  assert.deepEqual(group.$group.sales, { $sum: "$total" });
  for (const key of Object.keys(MONEY_BREAKDOWN_GROUP)) {
    assert.deepEqual(group.$group[key], MONEY_BREAKDOWN_GROUP[key as keyof typeof MONEY_BREAKDOWN_GROUP]);
  }
});

test("itemsCompareTotals: matches Completed in window, unwinds items, sums qty and ITEM_REVENUE_EXPR", () => {
  const stages = itemsCompareTotals(WINDOW);
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.equal(match.$match.status, "Completed");
  assert.deepEqual(stages[1], { $unwind: "$items" });
  const group = stages[2] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group.qty, { $sum: "$items.qty" });
  assert.deepEqual(group.$group.sales, { $sum: ITEM_REVENUE_EXPR });
});

test("itemDetailPipeline: with a productId, matches it BEFORE and after unwind, plus the label $expr", () => {
  const productId = new Types.ObjectId();
  const stages = itemDetailPipeline(WINDOW, "day", productId, "Cold Coffee (Large)");
  const first = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(first.$match["items.productId"], productId);
  assert.deepEqual(stages[1], { $unwind: "$items" });
  const second = stages[2] as { $match: Record<string, unknown> };
  assert.deepEqual(second.$match["items.productId"], productId);
  const labelMatch = stages[3] as { $match: { $expr: unknown } };
  assert.deepEqual(labelMatch.$match.$expr, { $eq: [ITEM_LABEL_EXPR, "Cold Coffee (Large)"] });
  const group = stages[4] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group.sales, { $sum: ITEM_REVENUE_EXPR });
});

test("itemDetailPipeline: a null productId (removed product) skips the productId matches but keeps the label $expr", () => {
  const stages = itemDetailPipeline(WINDOW, "hour", null, "Ghost Dish");
  const first = stages[0] as { $match: Record<string, unknown> };
  assert.ok(!("items.productId" in first.$match));
  assert.deepEqual(stages[1], { $unwind: "$items" });
  // No extra post-unwind productId $match stage when productId is null.
  const labelMatch = stages[2] as { $match: { $expr: unknown } };
  assert.deepEqual(labelMatch.$match.$expr, { $eq: [ITEM_LABEL_EXPR, "Ghost Dish"] });
});

test("itemVoidsPipeline: unwinds voids, matches the label via itemLabelExpr('voids'), sums qty and VOID_VALUE_EXPR", () => {
  const productId = new Types.ObjectId();
  const stages = itemVoidsPipeline(WINDOW, productId, "Tea");
  assert.deepEqual(stages[1], { $unwind: "$voids" });
  const match = stages[2] as { $match: Record<string, unknown> };
  assert.deepEqual(match.$match.$expr, { $eq: [itemLabelExpr("voids"), "Tea"] });
  assert.deepEqual(match.$match["voids.productId"], productId);
  const group = stages[3] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group.qty, { $sum: "$voids.qty" });
  assert.deepEqual(group.$group.value, { $sum: VOID_VALUE_EXPR });
});
