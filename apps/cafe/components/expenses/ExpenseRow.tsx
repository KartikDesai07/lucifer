"use client";

import { EXPENSE_PAYMENT_MODE_LABELS } from "@pos/shared/expense";
import { inrPaise, cn } from "@/lib/utils";
import type { ExpenseDto } from "@/types/expenses";

interface ExpenseRowProps {
  expense: ExpenseDto;
  categoryName: string;
  /** Admin only — a tap opens the edit sheet. Staff rows are plain and read-only. */
  onOpen?: (expense: ExpenseDto) => void;
}

const ROW_CLASS = "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left";

// One expense: what it was, its category and how it was paid, an optional note
// on one line, and the amount on the right. min-w-0 + truncate keep a long name
// from widening the page.
export function ExpenseRow({ expense, categoryName, onOpen }: ExpenseRowProps) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold text-brand-ink">{expense.name}</p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-brand-muted">
          {categoryName && <span className="max-w-full truncate rounded-full bg-brand-wash px-2 py-0.5 text-brand-ink">{categoryName}</span>}
          <span>{EXPENSE_PAYMENT_MODE_LABELS[expense.paymentMode]}</span>
          {expense.edited && <span>· edited</span>}
        </div>
        {expense.note && <p className="mt-0.5 truncate text-[12.5px] text-brand-muted">{expense.note}</p>}
      </div>
      <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-brand-ink">{inrPaise(expense.amountPaise)}</span>
    </>
  );

  if (!onOpen) return <div className={ROW_CLASS}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(expense)}
      aria-label={`Edit expense ${expense.name}`}
      className={cn(ROW_CLASS, "hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent")}
    >
      {body}
    </button>
  );
}
