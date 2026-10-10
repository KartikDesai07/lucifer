// Pure display helpers for the Expenses screens (Step EXP) — grouping a list
// by day, naming a day, resolving a category name. No React, so node:test can
// import it directly. Money stays integer PAISE here; the components render it
// with inrPaise.
import { weekdayDayLabel, addDays } from "@/lib/dashboard/range";
import type { ExpenseCategoryDto, ExpenseDto } from "@/types/expenses";

export interface ExpenseDayGroup {
  date: string; // "YYYY-MM-DD"
  rows: ExpenseDto[];
  /** Sum of the rows loaded for this day (a cut-off list can leave the last day partial). */
  totalPaise: number;
}

/** Newest day first, rows keep the server's order inside a day (it already sorts them). */
export function groupExpensesByDate(rows: readonly ExpenseDto[]): ExpenseDayGroup[] {
  const groups: ExpenseDayGroup[] = [];
  const byDate = new Map<string, ExpenseDayGroup>();
  for (const row of rows) {
    let group = byDate.get(row.date);
    if (!group) {
      group = { date: row.date, rows: [], totalPaise: 0 };
      byDate.set(row.date, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.totalPaise += row.amountPaise;
  }
  return groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** "Today" · "Yesterday" · "Tue, 22 Sep". */
export function dayHeading(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return weekdayDayLabel(date);
}

export function categoryNameMap(categories: readonly ExpenseCategoryDto[] | undefined): Map<string, string> {
  return new Map((categories ?? []).map((c) => [c.id, c.name]));
}

/** "" until the category list has loaded, so a row never shows a wrong name. */
export const UNKNOWN_CATEGORY_NAME = "Unknown category";
export function categoryNameOf(names: ReadonlyMap<string, string>, id: string): string {
  if (names.size === 0) return "";
  return names.get(id) ?? UNKNOWN_CATEGORY_NAME;
}
