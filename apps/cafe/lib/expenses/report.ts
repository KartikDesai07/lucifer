import type { PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { ACTIVE_EXPENSE, ExpenseEntry } from "@/models/ExpenseEntry";
import { listExpenseCategories } from "./categories";
import { EXPENSE_PAYMENT_MODES } from "@pos/shared/expense";
import type { DashboardRange } from "@/types/dashboard";
import type { ExpenseCategoryDto, ExpenseReport } from "@/types/expenses";

// The Expenses report (Step EXP, D10): ONE `$facet` aggregation over the active
// rows whose `date` is in the range — every sum is an integer over Int32 paise,
// so the report's numbers are exact and add up. Category names are joined here
// in JS from the category list (same cluster, no $lookup).

const UNKNOWN_CATEGORY_NAME = "Unknown category";

interface FacetGroup<K> {
  _id: K;
  totalPaise: number;
  count: number;
}

/** What the `$facet` stage hands back (one document). */
export interface ExpenseReportFacet {
  totals: FacetGroup<null>[];
  byCategory: FacetGroup<{ toString(): string }>[];
  byDay: FacetGroup<string>[];
  byMode: FacetGroup<string>[];
}

const SUM_AND_COUNT = { totalPaise: { $sum: "$amountPaise" }, count: { $sum: 1 } } as const;

export function expenseReportPipeline(range: DashboardRange): PipelineStage[] {
  return [
    { $match: { ...ACTIVE_EXPENSE, date: { $gte: range.from, $lte: range.to } } },
    {
      $facet: {
        totals: [{ $group: { _id: null, ...SUM_AND_COUNT } }],
        byCategory: [{ $group: { _id: "$categoryId", ...SUM_AND_COUNT } }],
        byDay: [{ $group: { _id: "$date", ...SUM_AND_COUNT } }],
        byMode: [{ $group: { _id: "$paymentMode", ...SUM_AND_COUNT } }],
      },
    },
  ];
}

/**
 * Facet → the wire report. Categories largest first (ties by name) with their
 * current name + hidden flag; days oldest first; modes in the owner's order;
 * anything with nothing spent is omitted.
 */
export function foldExpenseReport(
  facet: ExpenseReportFacet | undefined,
  categories: readonly ExpenseCategoryDto[],
  range: DashboardRange,
): ExpenseReport {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const total = facet?.totals[0];

  const byCategory = (facet?.byCategory ?? [])
    .filter((g) => g.totalPaise > 0 || g.count > 0)
    .map((g) => {
      const categoryId = g._id.toString();
      const known = byId.get(categoryId);
      return {
        categoryId,
        name: known?.name ?? UNKNOWN_CATEGORY_NAME,
        hidden: known?.hidden ?? false,
        totalPaise: g.totalPaise,
        count: g.count,
      };
    })
    .sort((a, b) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name));

  const byDay = (facet?.byDay ?? [])
    .filter((g) => g.totalPaise > 0 || g.count > 0)
    .map((g) => ({ date: g._id, totalPaise: g.totalPaise, count: g.count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const byMode = EXPENSE_PAYMENT_MODES.flatMap((mode) => {
    const g = facet?.byMode.find((m) => m._id === mode);
    return g && (g.totalPaise > 0 || g.count > 0) ? [{ mode, totalPaise: g.totalPaise, count: g.count }] : [];
  });

  return { range, totalPaise: total?.totalPaise ?? 0, count: total?.count ?? 0, byCategory, byDay, byMode };
}

export async function buildExpenseReport(range: DashboardRange): Promise<ExpenseReport> {
  await connectDB();
  const [[facet], categories] = await Promise.all([
    ExpenseEntry.aggregate<ExpenseReportFacet>(expenseReportPipeline(range)),
    listExpenseCategories(),
  ]);
  return foldExpenseReport(facet, categories, range);
}
