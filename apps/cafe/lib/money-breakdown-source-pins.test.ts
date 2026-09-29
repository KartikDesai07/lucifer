import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// D10 S3 — split out of money-breakdown.test.ts (300-line cap): the
// cross-file source pins that read S1/S2's own files for the money
// bifurcation rule (readSrc + stripComments, per .claude/rules/testing.md's
// vision-guard + concatenated-needle discipline). These may be RED on a
// first run if S1/S2 have not landed those files yet — reported per pin.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

test("source pin: app/api/orders/summary/route.ts imports from @/lib/money-breakdown and wires the fold", () => {
  const src = stripComments(readSrc("app/api/orders/summary/route.ts"));
  assert.ok(
    src.includes("from \"@/lib/money-breakdown\""),
    "route must import from @/lib/money-breakdown",
  );
  assert.ok(
    src.includes(".select(") && src.includes("MONEY_BREAKDOWN_SELECT"),
    "the .select() call must reference MONEY_BREAKDOWN_SELECT",
  );
  assert.ok(src.includes("lineRevenue(item)"), "must call lineRevenue(item) for top-products revenue");
  // Vision-guard: the landmark line proves this file still computes qty the
  // old way (so the ABSENCE below is meaningful, not just an empty grep).
  assert.ok(src.includes("row.qty += item.qty"), "landmark: row.qty += item.qty must still be present");
  const blindMultiplyNeedle = "item.price " + "* item.qty";
  assert.ok(
    !src.includes(blindMultiplyNeedle),
    "must NOT still multiply item.price * item.qty blind (the R8 bug) for top-products revenue",
  );
  assert.ok(src.includes("money: foldMoneyBreakdown(completed)"), "summary must carry money: foldMoneyBreakdown(completed)");
  assert.ok(src.includes('.status === "Completed"'), "existing completed-filter pin must still hold");
  assert.ok(src.includes("cache.set(key, summary"), "existing cache-set pin must still hold");
});

// Reports redesign Batch 1 (2026-09-29): app/api/reports/route.ts was
// retired; its Totals $group (MONEY_BREAKDOWN_GROUP) and Completed-only
// match now live in lib/reports/sales-pipelines.ts, and its
// pickMoneyBreakdown(totals) presentation step in lib/reports/sales-fold.ts.
// The topProducts / ITEM_REVENUE_EXPR half has no Batch 1 equivalent yet —
// per-item reporting ("Items & categories") is Batch 2 (00-PLAN.md item 8),
// not part of this redesign step, so that half of the old pin is dropped
// rather than re-targeted at code that does not exist yet.
test("source pin: lib/reports/sales-pipelines.ts spreads MONEY_BREAKDOWN_GROUP into its day $group and matches Completed only", () => {
  const src = stripComments(readSrc("lib/reports/sales-pipelines.ts"));
  assert.ok(src.includes("from \"@/lib/money-breakdown\""), "must import from @/lib/money-breakdown");
  assert.ok(src.includes("...MONEY_BREAKDOWN_GROUP"), "the day $group must spread ...MONEY_BREAKDOWN_GROUP");
  assert.ok(src.includes('status: "Completed"'), "must match only Completed orders");
});

test("source pin: lib/reports/sales-fold.ts presents the range's money through pickMoneyBreakdown", () => {
  const src = stripComments(readSrc("lib/reports/sales-fold.ts"));
  assert.ok(src.includes("from \"@/lib/money-breakdown\""), "must import from @/lib/money-breakdown");
  assert.ok(src.includes("pickMoneyBreakdown("), "must carry money through pickMoneyBreakdown(...)");
});

test("source pin: components/reports/MoneyBreakdownCard.tsx iterates MONEY_BREAKDOWN_LINES, renders MONEY_NET_LABEL, imports inr, captions via CardDescription", () => {
  const src = stripComments(readSrc("components/reports/MoneyBreakdownCard.tsx"));
  assert.ok(src.includes("MONEY_BREAKDOWN_LINES"), "must iterate MONEY_BREAKDOWN_LINES");
  assert.ok(src.includes("MONEY_NET_LABEL"), "must render MONEY_NET_LABEL");
  assert.ok(src.includes("inr"), "must import inr");
  // Review C2: sibling cards describe themselves through the shadcn
  // CardDescription slot (16 files), not a raw <p> - one type scale everywhere.
  assert.ok(src.includes("<CardDescription"), "landmark: the caption must render through <CardDescription>");
  const rawParagraphNeedle = "<p " + "className";
  assert.ok(!src.includes(rawParagraphNeedle), "no raw <p className> caption may remain in the card");
});

test("source pin: components/reports/EndOfDaySummary.tsx iterates MONEY_BREAKDOWN_LINES, renders MONEY_NET_LABEL, drops the literal 'Gross sales', keeps w-[300px]", () => {
  const src = stripComments(readSrc("components/reports/EndOfDaySummary.tsx"));
  assert.ok(src.includes("MONEY_BREAKDOWN_LINES"), "must iterate MONEY_BREAKDOWN_LINES");
  assert.ok(src.includes("MONEY_NET_LABEL"), "must render MONEY_NET_LABEL");
  // Vision-guard: prove the file still renders a real, DIFFERENT label
  // ("Orders served") before trusting the absence of "Gross sales" below.
  assert.ok(src.includes("Orders served"), "landmark: 'Orders served' label must still be present");
  const grossSalesNeedle = "Gross" + " sales";
  assert.ok(!src.includes(grossSalesNeedle), "must NOT contain the literal 'Gross sales' label any more");
  assert.ok(src.includes("w-[300px]"), "must keep the 300px thermal-width class");
});

// lib/report-csv.ts was retired with the old Reports screen (Reports
// redesign Batch 1, 2026-09-29) — its replacement, lib/reports/csv.ts
// (salesCsvRows/paymentsCsvRows/duesCsvRows), carries the equivalent pin in
// lib/reports/csv.test.ts (implementer A's slice, not this file's).

test("source pin: app/(dashboard)/page.tsx renders <MoneyBreakdownCard and imports it from @/components/reports/MoneyBreakdownCard", () => {
  // Reports redesign Batch 1: the Reports screens moved off MoneyBreakdownCard
  // onto their own TallyCard ("How it adds up" — a computed identity check,
  // not a static breakdown list); the Dashboard alone still uses this card.
  const src = stripComments(readSrc("app/(dashboard)/page.tsx"));
  assert.ok(src.includes("<MoneyBreakdownCard"), "must render <MoneyBreakdownCard");
  assert.ok(
    src.includes('from "@/components/reports/MoneyBreakdownCard"'),
    "must import MoneyBreakdownCard from @/components/reports/MoneyBreakdownCard",
  );
});
