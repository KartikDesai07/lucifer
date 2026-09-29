// Pure pipeline-SHAPE pins (no DB) — the live leg proves these stages actually
// run and return the right numbers; this file pins the stage structure itself
// so a future edit cannot silently drop the Completed/window match, a
// MONEY_BREAKDOWN key, a received-split field, or the dues ACTIVE guard
// without a red test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { salesFacet, duesByDayPipeline } from "@/lib/reports/sales-pipelines";
import { MONEY_BREAKDOWN_GROUP, MONEY_BREAKDOWN_KEYS } from "@/lib/money-breakdown";
import { CASH_EXPR, CREDIT_EXPR, ONLINE_EXPR, OTHER_EXPR } from "@/lib/reports/received";
import { ACTIVE_DUE_PAYMENT } from "@/lib/due-payment";
import type { PipelineStage } from "mongoose";

const WINDOW = { start: new Date("2026-09-29T00:00:00Z"), end: new Date("2026-09-29T23:59:59Z") };

test("salesFacet: the FIRST stage matches the window AND status Completed", () => {
  const stages = salesFacet(WINDOW, "day");
  const match = stages[0] as { $match: Record<string, unknown> };
  assert.ok("$match" in stages[0], "stage 0 must be a $match");
  assert.deepEqual(match.$match.createdAt, { $gte: WINDOW.start, $lte: WINDOW.end });
  assert.equal(match.$match.status, "Completed");
});

test("salesFacet: days $group carries every MONEY_BREAKDOWN key plus cash/online/other/credit", () => {
  const stages = salesFacet(WINDOW, "day");
  const facetStage = stages[1] as { $facet: { days: PipelineStage[] } };
  const daysGroup = facetStage.$facet.days[0] as { $group: Record<string, unknown> };
  for (const key of MONEY_BREAKDOWN_KEYS) {
    assert.ok(key in daysGroup.$group, `days $group is missing MONEY_BREAKDOWN key "${key}"`);
  }
  for (const key of ["cash", "online", "other", "credit", "orders", "net"]) {
    assert.ok(key in daysGroup.$group, `days $group is missing "${key}"`);
  }
  // Wiring, not just presence: a swapped twin (cash summing ONLINE_EXPR) must fail here too.
  assert.deepEqual(daysGroup.$group.cash, { $sum: CASH_EXPR });
  assert.deepEqual(daysGroup.$group.online, { $sum: ONLINE_EXPR });
  assert.deepEqual(daysGroup.$group.other, { $sum: OTHER_EXPR });
  assert.deepEqual(daysGroup.$group.credit, { $sum: CREDIT_EXPR });
  assert.deepEqual(daysGroup.$group.net, { $sum: "$total" });
  for (const key of MONEY_BREAKDOWN_KEYS) assert.deepEqual(daysGroup.$group[key], MONEY_BREAKDOWN_GROUP[key]);
});

test("salesFacet: totals facet matches dashboard SALES_TOTALS semantics (orders/sales/collected)", () => {
  const stages = salesFacet(WINDOW, "day");
  const facetStage = stages[1] as { $facet: { totals: PipelineStage[] } };
  const totalsGroup = facetStage.$facet.totals[0] as { $group: Record<string, { $sum: string }> };
  assert.deepEqual(totalsGroup.$group.orders, { $sum: 1 });
  assert.deepEqual(totalsGroup.$group.sales, { $sum: "$total" });
  assert.deepEqual(totalsGroup.$group.collected, { $sum: "$paidAmount" });
});

test("salesFacet: modes facet groups by $payment and carries splitCash/splitOnline", () => {
  const stages = salesFacet(WINDOW, "day");
  const facetStage = stages[1] as { $facet: { modes: PipelineStage[] } };
  const modesGroup = facetStage.$facet.modes[0] as { $group: Record<string, unknown> };
  assert.equal(modesGroup.$group._id, "$payment");
  assert.ok("splitCash" in modesGroup.$group);
  assert.ok("splitOnline" in modesGroup.$group);
  assert.ok("billed" in modesGroup.$group);
  assert.ok("received" in modesGroup.$group);
});

test("salesFacet: hour mode buckets the series by $hour, day mode by the IST day string", () => {
  const hourStages = salesFacet(WINDOW, "hour");
  const dayStages = salesFacet(WINDOW, "day");
  const hourFacet = hourStages[1] as { $facet: { series: PipelineStage[] } };
  const dayFacet = dayStages[1] as { $facet: { series: PipelineStage[] } };
  const hourGroup = hourFacet.$facet.series[0] as { $group: { _id: Record<string, unknown> } };
  const dayGroup = dayFacet.$facet.series[0] as { $group: { _id: Record<string, unknown> } };
  assert.ok("$hour" in hourGroup.$group._id);
  assert.ok("$dateToString" in dayGroup.$group._id);
});

test("duesByDayPipeline: applies ACTIVE_DUE_PAYMENT (excludes soft-deleted receipts)", () => {
  const stages = duesByDayPipeline(WINDOW);
  const match = stages[0] as { $match: Record<string, unknown> };
  for (const [key, value] of Object.entries(ACTIVE_DUE_PAYMENT)) {
    assert.deepEqual(match.$match[key], value, `duesByDayPipeline's $match is missing ACTIVE_DUE_PAYMENT's "${key}"`);
  }
});

test("duesByDayPipeline: groups by (day, mode) and sums amount", () => {
  const stages = duesByDayPipeline(WINDOW);
  const group = stages[1] as { $group: { _id: { day: unknown; mode: string }; amount: { $sum: string } } };
  assert.ok("day" in group.$group._id);
  assert.equal(group.$group._id.mode, "$mode");
  assert.deepEqual(group.$group.amount, { $sum: "$amount" });
});
