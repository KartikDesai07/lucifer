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

test("source pin: app/api/reports/route.ts spreads MONEY_BREAKDOWN_GROUP into the Totals $group and uses ITEM_REVENUE_EXPR for topProducts", () => {
  const src = stripComments(readSrc("app/api/reports/route.ts"));
  assert.ok(src.includes("from \"@/lib/money-breakdown\""), "route must import from @/lib/money-breakdown");

  const totalSalesGroupNeedle = "totalSales: { " + "$sum: \"$total\" }";
  const groupIdx = src.indexOf(totalSalesGroupNeedle);
  assert.ok(groupIdx !== -1, "must find the totalSales $group accumulator");
  const groupCloseIdx = src.indexOf("]),", groupIdx);
  assert.ok(groupCloseIdx !== -1 && groupCloseIdx > groupIdx, "must find the $group's closing bracket after totalSales");
  const groupSlice = src.slice(groupIdx, groupCloseIdx);
  assert.ok(
    groupSlice.includes("...MONEY_BREAKDOWN_GROUP"),
    "the Totals $group must also spread ...MONEY_BREAKDOWN_GROUP",
  );

  const unwindIdx = src.indexOf('$unwind: "$items"');
  assert.ok(unwindIdx !== -1, "landmark: $unwind: \"$items\" must still be present (topProducts pipeline)");
  const topProductsSlice = src.slice(unwindIdx);
  assert.ok(topProductsSlice.includes("ITEM_REVENUE_EXPR"), "topProducts revenue must use ITEM_REVENUE_EXPR");
  const blindMultiplyNeedle = "$multiply: [" + '"$items.price"';
  assert.ok(
    !topProductsSlice.includes(blindMultiplyNeedle),
    "topProducts must NOT still use a blind $multiply: [\"$items.price\" (the R8 twin bug)",
  );

  assert.ok(src.includes("money: pickMoneyBreakdown(totals)"), "report must carry money: pickMoneyBreakdown(totals)");
  assert.ok(src.includes('status: "Completed"'), "existing completed-status pin must still hold");
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

test("source pin: lib/report-csv.ts iterates MONEY_BREAKDOWN_LINES, has a 'Bill breakdown' section constant, pushes MONEY_NET_LABEL", () => {
  const src = stripComments(readSrc("lib/report-csv.ts"));
  assert.ok(src.includes("MONEY_BREAKDOWN_LINES"), "must iterate MONEY_BREAKDOWN_LINES");
  const billBreakdownNeedle = "Bill" + " breakdown";
  assert.ok(src.includes(billBreakdownNeedle), "must have a 'Bill breakdown' section constant");
  assert.ok(src.includes("MONEY_NET_LABEL"), "must push a MONEY_NET_LABEL row");
});

test("source pin: both dashboard pages render <MoneyBreakdownCard and import it from @/components/reports/MoneyBreakdownCard", () => {
  for (const rel of ["app/(dashboard)/page.tsx", "app/(dashboard)/reports/page.tsx"]) {
    const src = stripComments(readSrc(rel));
    assert.ok(src.includes("<MoneyBreakdownCard"), `${rel} must render <MoneyBreakdownCard`);
    assert.ok(
      src.includes('from "@/components/reports/MoneyBreakdownCard"'),
      `${rel} must import MoneyBreakdownCard from @/components/reports/MoneyBreakdownCard`,
    );
  }
});
