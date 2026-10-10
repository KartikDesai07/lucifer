import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { expenseReportPipeline, foldExpenseReport, type ExpenseReportFacet } from "./report";
import { EXPENSE_PAYMENT_MODES } from "@pos/shared/expense";
import type { ExpenseCategoryDto } from "@/types/expenses";

// Step EXP — DB-free pins over lib/expenses/report.ts (split from expenses.test.ts
// for the file-size cap). Oracles are hand-written literals.

const RANGE = { from: "2026-10-01", to: "2026-10-09" };

// ── foldExpenseReport ───────────────────────────────────────────────────────

const cat = (id: string, name: string, hidden = false, displayOrder = 0): ExpenseCategoryDto => ({
  id,
  name,
  hidden,
  displayOrder,
});
const oid = (hex: string) => new Types.ObjectId(hex);
const A = "665f0000000000000000c0a1";
const B = "665f0000000000000000c0b2";
const C = "665f0000000000000000c0c3";
const D = "665f0000000000000000c0d4";
const GONE = "665f0000000000000000c0ff";
const CATS = [cat(A, "Gas"), cat(B, "Rent", true), cat(C, "Ingredients"), cat(D, "Alpha")];

test("foldExpenseReport: categories largest first, ties broken by name, names/hidden joined", () => {
  const facet: ExpenseReportFacet = {
    totals: [{ _id: null, totalPaise: 90000, count: 6 }],
    byCategory: [
      { _id: oid(A), totalPaise: 10000, count: 1 }, // Gas — tie with Alpha
      { _id: oid(B), totalPaise: 50000, count: 2 }, // Rent (hidden) — largest
      { _id: oid(C), totalPaise: 20000, count: 2 },
      { _id: oid(D), totalPaise: 10000, count: 1 }, // Alpha — tie with Gas, sorts first by name
    ],
    byDay: [],
    byMode: [],
  };
  const report = foldExpenseReport(facet, CATS, RANGE);
  assert.deepEqual(
    report.byCategory.map((c) => [c.name, c.totalPaise, c.hidden]),
    [
      ["Rent", 50000, true],
      ["Ingredients", 20000, false],
      ["Alpha", 10000, false],
      ["Gas", 10000, false],
    ],
  );
  assert.equal(report.byCategory[0].categoryId, B);
  assert.equal(report.byCategory[0].count, 2);
  assert.equal(report.totalPaise, 90000);
  assert.equal(report.count, 6);
  assert.deepEqual(report.range, RANGE);
});

test("foldExpenseReport: a category missing from the list is named 'Unknown category' and not hidden", () => {
  const facet: ExpenseReportFacet = {
    totals: [{ _id: null, totalPaise: 700, count: 1 }],
    byCategory: [{ _id: oid(GONE), totalPaise: 700, count: 1 }],
    byDay: [],
    byMode: [],
  };
  const [row] = foldExpenseReport(facet, CATS, RANGE).byCategory;
  assert.equal(row.name, "Unknown category");
  assert.equal(row.hidden, false);
  assert.equal(row.categoryId, GONE);
});

test("foldExpenseReport: zero groups are omitted from category, day and mode", () => {
  const facet: ExpenseReportFacet = {
    totals: [{ _id: null, totalPaise: 100, count: 1 }],
    byCategory: [
      { _id: oid(A), totalPaise: 100, count: 1 },
      { _id: oid(C), totalPaise: 0, count: 0 },
    ],
    byDay: [
      { _id: "2026-10-02", totalPaise: 100, count: 1 },
      { _id: "2026-10-03", totalPaise: 0, count: 0 },
    ],
    byMode: [
      { _id: "cash", totalPaise: 100, count: 1 },
      { _id: "upi", totalPaise: 0, count: 0 },
    ],
  };
  const report = foldExpenseReport(facet, CATS, RANGE);
  assert.deepEqual(report.byCategory.map((c) => c.name), ["Gas"]);
  assert.deepEqual(report.byDay.map((d) => d.date), ["2026-10-02"]);
  assert.deepEqual(report.byMode.map((m) => m.mode), ["cash"]);
});

test("foldExpenseReport: modes follow EXPENSE_PAYMENT_MODES order, days run oldest first", () => {
  assert.deepEqual([...EXPENSE_PAYMENT_MODES], ["cash", "upi", "card", "bank"]);
  const facet: ExpenseReportFacet = {
    totals: [{ _id: null, totalPaise: 1000, count: 4 }],
    byCategory: [],
    byDay: [
      { _id: "2026-10-05", totalPaise: 300, count: 1 },
      { _id: "2026-10-01", totalPaise: 100, count: 1 },
      { _id: "2026-10-09", totalPaise: 600, count: 2 },
    ],
    // deliberately scrambled input order
    byMode: [
      { _id: "bank", totalPaise: 400, count: 1 },
      { _id: "card", totalPaise: 300, count: 1 },
      { _id: "cash", totalPaise: 200, count: 1 },
      { _id: "upi", totalPaise: 100, count: 1 },
    ],
  };
  const report = foldExpenseReport(facet, CATS, RANGE);
  assert.deepEqual(report.byMode.map((m) => m.mode), ["cash", "upi", "card", "bank"]);
  assert.deepEqual(report.byMode.map((m) => m.totalPaise), [200, 100, 300, 400]);
  assert.deepEqual(report.byDay.map((d) => d.date), ["2026-10-01", "2026-10-05", "2026-10-09"]);
  assert.deepEqual(report.byDay.map((d) => d.count), [1, 1, 2]);
});

test("foldExpenseReport: an empty / missing facet folds to a zero report (never throws)", () => {
  const empty = foldExpenseReport(undefined, CATS, RANGE);
  assert.deepEqual(empty, { range: RANGE, totalPaise: 0, count: 0, byCategory: [], byDay: [], byMode: [] });
  const noRows = foldExpenseReport({ totals: [], byCategory: [], byDay: [], byMode: [] }, CATS, RANGE);
  assert.deepEqual(noRows, empty);
});

// ── expenseReportPipeline ───────────────────────────────────────────────────

test("expenseReportPipeline: $match holds the active filter + the inclusive date range, then one $facet", () => {
  const pipeline = expenseReportPipeline(RANGE);
  assert.equal(pipeline.length, 2);
  const [match, facet] = pipeline;
  assert.deepEqual(match, {
    $match: { deletedAt: { $exists: false }, date: { $gte: "2026-10-01", $lte: "2026-10-09" } },
  });
  assert.ok("$facet" in facet, "second stage is the $facet");
  const branches = (facet as { $facet: Record<string, unknown[]> }).$facet;
  assert.deepEqual(Object.keys(branches).sort(), ["byCategory", "byDay", "byMode", "totals"]);
  // each branch sums the Int32 paise field and counts
  assert.deepEqual(branches.byDay, [
    { $group: { _id: "$date", totalPaise: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
  ]);
  assert.deepEqual(branches.byCategory, [
    { $group: { _id: "$categoryId", totalPaise: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
  ]);
});
