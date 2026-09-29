// Pure pipeline-SHAPE pins (no DB). The `totals`/`cancelled`/`voids` facets
// must deep-equal the Dashboard's own performanceFacet rules byte-for-byte
// (00-PLAN.md: "Byte-for-byte the Dashboard's leaks card") — a future edit to
// either side that drifts must fail here, not just live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leakCompareTotals, leakFacet } from "@/lib/reports/cancels-pipelines";
import { performanceFacet, VOID_VALUE_EXPR } from "@/lib/dashboard/pipelines";
import { MONEY_BREAKDOWN_GROUP } from "@/lib/money-breakdown";
import type { PipelineStage } from "mongoose";

const WINDOW = { start: new Date("2026-09-29T00:00:00Z"), end: new Date("2026-09-29T23:59:59Z") };
const ROW_LIMIT = 300;

function dashboardFacets() {
  const stages = performanceFacet(WINDOW, "day");
  const facetStage = stages[1] as { $facet: Record<string, PipelineStage[]> };
  return facetStage.$facet;
}

test("leakFacet: the FIRST stage matches only the window (no status filter — every facet inside filters its own)", () => {
  const stages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.deepEqual(match.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.ok(!("status" in match.$match));
});

test("leakFacet: totals facet deep-equals the Dashboard's discount/reward accumulators", () => {
  const stages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const facetStage = stages[1] as { $facet: { totals: PipelineStage[] } };
  const group = (facetStage.$facet.totals[1] as { $group: Record<string, unknown> }).$group;
  const dashGroup = (dashboardFacets().totals[1] as { $group: Record<string, unknown> }).$group;
  assert.deepEqual(group.discountedOrders, dashGroup.discountedOrders);
  assert.deepEqual(group.rewardedOrders, dashGroup.rewardedOrders);
  assert.deepEqual(group.discount, MONEY_BREAKDOWN_GROUP.discount);
  assert.deepEqual(group.reward, MONEY_BREAKDOWN_GROUP.reward);
  assert.deepEqual(group.discount, dashGroup.discount);
  assert.deepEqual(group.reward, dashGroup.reward);
});

test("leakFacet: cancelled and voids facets deep-equal the Dashboard's performanceFacet stages", () => {
  const stages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const facetStage = stages[1] as { $facet: { cancelled: PipelineStage[]; voids: PipelineStage[] } };
  assert.deepEqual(facetStage.$facet.cancelled, dashboardFacets().cancelled);
  assert.deepEqual(facetStage.$facet.voids, dashboardFacets().voids);
});

test("leakFacet: voidSeries buckets by the ORDER's createdAt (seriesKeyExpr), sums VOID_VALUE_EXPR", () => {
  const stages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const facetStage = stages[1] as { $facet: { voidSeries: PipelineStage[] } };
  assert.deepEqual(facetStage.$facet.voidSeries[0], { $unwind: "$voids" });
  const group = (facetStage.$facet.voidSeries[1] as { $group: Record<string, unknown> }).$group;
  assert.deepEqual(group._id, { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } });
  assert.deepEqual(group.amount, { $sum: VOID_VALUE_EXPR });
});

test("leakFacet: cancelledRows sorts cancelledAt desc then createdAt/_id, limited to rowLimit", () => {
  const stages = leakFacet(WINDOW, "day", 5);
  const facetStage = stages[1] as { $facet: { cancelledRows: PipelineStage[] } };
  const rows = facetStage.$facet.cancelledRows;
  assert.deepEqual(rows[1], { $sort: { cancelledAt: -1, createdAt: -1, _id: -1 } });
  assert.deepEqual(rows[2], { $limit: 5 });
});

test("leakFacet: discountRows/rewardRows match Completed + their own $expr, and pull amount from the per-doc twins", () => {
  const stages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const facetStage = stages[1] as { $facet: { discountRows: PipelineStage[]; rewardRows: PipelineStage[] } };
  const discountMatch = facetStage.$facet.discountRows[0] as { $match: { status: string; $expr: unknown } };
  assert.equal(discountMatch.$match.status, "Completed");
  const rewardMatch = facetStage.$facet.rewardRows[0] as { $match: { status: string; $expr: unknown } };
  assert.equal(rewardMatch.$match.status, "Completed");
  assert.notDeepEqual(discountMatch.$match.$expr, rewardMatch.$match.$expr);
});

test("leakCompareTotals: reuses the SAME totals/cancelled/voids facet arrays as leakFacet (no drift between the two)", () => {
  const compareStages = leakCompareTotals(WINDOW);
  const compareFacetStage = compareStages[1] as { $facet: { totals: PipelineStage[]; cancelled: PipelineStage[]; voids: PipelineStage[] } };
  const fullStages = leakFacet(WINDOW, "day", ROW_LIMIT);
  const fullFacetStage = fullStages[1] as { $facet: { totals: PipelineStage[]; cancelled: PipelineStage[]; voids: PipelineStage[] } };
  assert.deepEqual(compareFacetStage.$facet.totals, fullFacetStage.$facet.totals);
  assert.deepEqual(compareFacetStage.$facet.cancelled, fullFacetStage.$facet.cancelled);
  assert.deepEqual(compareFacetStage.$facet.voids, fullFacetStage.$facet.voids);
});
