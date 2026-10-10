"use client";

import { inrPaise } from "@/lib/utils";
import { shareLabel, sharePercent } from "@/components/expenses/expense-report";
import type { ExpenseCategoryTotal } from "@/types/expenses";

interface ExpenseCategoryBarsProps {
  rows: readonly ExpenseCategoryTotal[];
  totalPaise: number;
}

// "By category" as plain CSS bars (no chart library): the bar is the category's
// share of everything spent, the words beside it carry the exact amount.
export function ExpenseCategoryBars({ rows, totalPaise }: ExpenseCategoryBarsProps) {
  return (
    <ul className="space-y-3.5">
      {rows.map((row) => (
        <li key={row.categoryId}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 truncate font-medium text-brand-ink">
              {row.name}
              {row.hidden && <span className="font-normal text-brand-muted"> (hidden)</span>}
            </span>
            <span className="shrink-0 tabular-nums text-brand-ink">
              {inrPaise(row.totalPaise)} <span className="text-brand-muted">· {shareLabel(row.totalPaise, totalPaise)}</span>
            </span>
          </div>
          <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-brand-wash">
            <div className="h-full min-w-0.5 rounded-full bg-brand-primary" style={{ width: `${sharePercent(row.totalPaise, totalPaise)}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-brand-muted">
            {row.count} {row.count === 1 ? "expense" : "expenses"}
          </p>
        </li>
      ))}
    </ul>
  );
}
