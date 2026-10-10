"use client";

import type { ReactNode } from "react";

import { EXPENSE_PAYMENT_MODES, EXPENSE_PAYMENT_MODE_LABELS, type ExpensePaymentMode } from "@pos/shared/expense";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { RangeBar, type DashboardSelection } from "@/components/dashboard/RangeBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ExpenseCategoryDto } from "@/types/expenses";

// "No filter" — a value no category id or payment mode can take.
export const ALL_FILTER = "__all__";

// Two equal columns on a phone; from sm up each is 13rem wide.
const TRIGGER_CLASS = cn(BRAND_CONTROL_CLASS, "w-full min-w-0 border-brand-field bg-brand-slip text-brand-ink pointer-coarse:h-11 sm:w-52");
const ITEM_CLASS = "pointer-coarse:min-h-11";

interface ExpenseFiltersProps {
  selection: DashboardSelection;
  onSelection: (next: DashboardSelection) => void;
  categories: ExpenseCategoryDto[] | undefined;
  categoryId: string;
  onCategory: (id: string) => void;
  mode: string;
  onMode: (mode: ExpensePaymentMode | typeof ALL_FILTER) => void;
  /** The total line: on the second row, pushed right from sm up; its own line on a phone. */
  summary?: ReactNode;
}

// Admin only. Row 1: the period. Row 2: a category and a payment filter, and
// the total on the right.
export function ExpenseFilters({ selection, onSelection, categories, categoryId, onCategory, mode, onMode, summary }: ExpenseFiltersProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 sm:flex">
        <RangeBar value={selection} onChange={onSelection} isAdmin maxDays={MAX_REPORT_RANGE_DAYS} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Select value={categoryId} onValueChange={onCategory}>
            <SelectTrigger aria-label="Category" className={TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER} className={ITEM_CLASS}>
                All categories
              </SelectItem>
              {(categories ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id} className={ITEM_CLASS}>
                  {c.hidden ? `${c.name} (hidden)` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={mode} onValueChange={(v) => onMode(v as ExpensePaymentMode | typeof ALL_FILTER)}>
            <SelectTrigger aria-label="Paid by" className={TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER} className={ITEM_CLASS}>
                Any payment type
              </SelectItem>
              {EXPENSE_PAYMENT_MODES.map((m) => (
                <SelectItem key={m} value={m} className={ITEM_CLASS}>
                  {EXPENSE_PAYMENT_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {summary && <div className="min-w-0 max-w-full sm:ml-auto">{summary}</div>}
      </div>
    </div>
  );
}
