// Pure pipeline-SHAPE pins (no DB) — WIRING deepEquals against the
// Dashboard's own expressions, mirroring items-pipelines.test.ts's idiom, so a
// future edit cannot silently swap a wiring twin without a red test.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PipelineStage } from "mongoose";
import {
  heatByTypePipeline,
  hourDetailPipeline,
  orderTypesCompareTotals,
  orderTypesFacet,
} from "@/lib/reports/order-types-pipelines";
import { CHANNEL_EXPR, SALES_TOTALS, heatPipeline, seriesKeyExpr } from "@/lib/dashboard/pipelines";

const WINDOW = { start: new Date("2026-09-29T00:00:00Z"), end: new Date("2026-09-29T23:59:59Z") };

test("orderTypesFacet: the FIRST stage matches the window AND status Completed", () => {
  const stages = orderTypesFacet(WINDOW);
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(match.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.equal(match.$match.status, "Completed");
});

test("orderTypesFacet: totals facet deepEquals SALES_TOTALS", () => {
  const stages = orderTypesFacet(WINDOW);
  const facetStage = stages[1] as { $facet: { totals: PipelineStage[] } };
  const group = facetStage.$facet.totals[0] as { $group: Record<string, unknown> };
  assert.equal(group.$group._id, null);
  for (const key of Object.keys(SALES_TOTALS)) {
    assert.deepEqual(group.$group[key], SALES_TOTALS[key as keyof typeof SALES_TOTALS]);
  }
});

test("orderTypesFacet: types $group key deepEquals CHANNEL_EXPR, sums total/count", () => {
  const stages = orderTypesFacet(WINDOW);
  const facetStage = stages[1] as { $facet: { types: PipelineStage[] } };
  const group = facetStage.$facet.types[0] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group._id, CHANNEL_EXPR);
  assert.deepEqual(group.$group.amount, { $sum: "$total" });
  assert.deepEqual(group.$group.count, { $sum: 1 });
});

test("orderTypesFacet: hours $group key's hour deepEquals seriesKeyExpr('hour'), type deepEquals CHANNEL_EXPR", () => {
  const stages = orderTypesFacet(WINDOW);
  const facetStage = stages[1] as { $facet: { hours: PipelineStage[] } };
  const group = facetStage.$facet.hours[0] as { $group: Record<string, unknown> };
  const id = group.$group._id as { hour: unknown; type: unknown };
  assert.deepEqual(id.hour, seriesKeyExpr("hour"));
  assert.deepEqual(id.type, CHANNEL_EXPR);
  assert.deepEqual(group.$group.orders, { $sum: 1 });
  assert.deepEqual(group.$group.sales, { $sum: "$total" });
});

test("orderTypesCompareTotals: matches window+Completed, deepEquals SALES_TOTALS", () => {
  const stages = orderTypesCompareTotals(WINDOW);
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(match.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.equal(match.$match.status, "Completed");
  const group = stages[1] as { $group: Record<string, unknown> };
  assert.equal(group.$group._id, null);
  for (const key of Object.keys(SALES_TOTALS)) {
    assert.deepEqual(group.$group[key], SALES_TOTALS[key as keyof typeof SALES_TOTALS]);
  }
});

test("heatByTypePipeline: dow/hour deepEqual heatPipeline's OWN expressions, type deepEquals CHANNEL_EXPR", () => {
  const stages = heatByTypePipeline(WINDOW);
  const group = stages[1] as { $group: Record<string, unknown> };
  const id = group.$group._id as { dow: unknown; hour: unknown; type: unknown };

  const heatStages = heatPipeline(WINDOW);
  const heatGroup = heatStages[1] as { $group: Record<string, unknown> };
  const heatId = heatGroup.$group._id as { dow: unknown; hour: unknown };

  assert.deepEqual(id.dow, heatId.dow, "dow expr must deepEqual heatPipeline's own");
  assert.deepEqual(id.hour, heatId.hour, "hour expr must deepEqual heatPipeline's own");
  assert.deepEqual(id.type, CHANNEL_EXPR);
  assert.deepEqual(group.$group.orders, { $sum: 1 });
});

test("hourDetailPipeline: matches window+Completed, then $expr hour eq + group key deepEquals seriesKeyExpr('day')", () => {
  const stages = hourDetailPipeline(WINDOW, 9, null);
  const first = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(first.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.equal(first.$match.status, "Completed");

  const exprMatch = stages[1] as { $match: { $expr: { $and: unknown[] } } };
  assert.deepEqual(exprMatch.$match.$expr.$and[0], { $eq: [seriesKeyExpr("hour"), 9] });
  // No type branch when type is null.
  assert.equal(exprMatch.$match.$expr.$and.length, 1);

  const group = stages[2] as { $group: Record<string, unknown> };
  assert.deepEqual(group.$group._id, seriesKeyExpr("day"));
  assert.deepEqual(group.$group.orders, { $sum: 1 });
  assert.deepEqual(group.$group.sales, { $sum: "$total" });
});

test("hourDetailPipeline: the type branch is present ONLY when a type is passed", () => {
  const withType = hourDetailPipeline(WINDOW, 14, "dine-in");
  const exprMatch = withType[1] as { $match: { $expr: { $and: unknown[] } } };
  assert.equal(exprMatch.$match.$expr.$and.length, 2);
  assert.deepEqual(exprMatch.$match.$expr.$and[1], { $eq: [CHANNEL_EXPR, "dine-in"] });
});
