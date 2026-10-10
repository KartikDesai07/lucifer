"use client";

import { inrPaise, cafeDateString } from "@/lib/utils";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { ExpenseRow } from "@/components/expenses/ExpenseRow";
import { categoryNameMap, categoryNameOf, dayHeading, groupExpensesByDate } from "@/components/expenses/expense-format";
import type { ExpenseCategoryDto, ExpenseDto } from "@/types/expenses";

const SKELETON_ROWS = 5;

export function ExpenseListSkeleton() {
  return (
    <div className="space-y-2" aria-busy aria-label="Loading expenses">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <BrandSkeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

interface ExpenseListProps {
  rows: ExpenseDto[];
  categories: ExpenseCategoryDto[] | undefined;
  /** Admin only: a tap on a row opens the edit sheet. */
  onOpen?: (expense: ExpenseDto) => void;
  /** The previous filters' rows are still showing while new ones load. */
  updating?: boolean;
}

// The rows grouped by day, newest first: a day heading with that day's subtotal
// (of the rows loaded), then the day's rows in one card.
export function ExpenseList({ rows, categories, onOpen, updating }: ExpenseListProps) {
  const today = cafeDateString();
  const names = categoryNameMap(categories);
  return (
    <div className={updating ? "space-y-4 opacity-60 transition-opacity" : "space-y-4 transition-opacity"} aria-busy={updating}>
      {groupExpensesByDate(rows).map((group) => (
        <section key={group.date} aria-label={dayHeading(group.date, today)}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
            <h3 className="min-w-0 truncate text-[13px] font-medium text-brand-muted">{dayHeading(group.date, today)}</h3>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-brand-muted">{inrPaise(group.totalPaise)}</span>
          </div>
          <ul className="divide-y divide-brand-rule overflow-hidden rounded-xl border border-brand-rule bg-brand-slip">
            {group.rows.map((expense) => (
              <li key={expense.id}>
                <ExpenseRow expense={expense} categoryName={categoryNameOf(names, expense.categoryId)} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
