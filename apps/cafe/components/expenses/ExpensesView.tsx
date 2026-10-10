"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, MoreHorizontal, Plus, Tags, Wallet } from "lucide-react";

import {
  EXPENSE_CATEGORIES_PATH,
  EXPENSE_LIST_MAX,
  EXPENSE_LIST_PAGE,
  EXPENSE_REPORT_PATH,
  type ExpensePaymentMode,
} from "@pos/shared/expense";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";
import { useAuth } from "@/hooks/use-auth";
import { useExpenseCategories, useExpenses, type ExpenseListFilters } from "@/hooks/use-expenses";
import { rangeOfPeriod, useStoredPeriod } from "@/hooks/use-stored-period";
import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS } from "@/components/brand/brand-classes";
import type { DashboardSelection } from "@/components/dashboard/RangeBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ALL_FILTER, ExpenseFilters } from "@/components/expenses/ExpenseFilters";
import { ExpenseFormSheet } from "@/components/expenses/ExpenseFormSheet";
import { ExpenseList, ExpenseListSkeleton } from "@/components/expenses/ExpenseList";
import { ExpenseTable, ExpenseTableSkeleton } from "@/components/expenses/ExpenseTable";
import { ExpenseTotals } from "@/components/expenses/ExpenseTotals";
import type { ExpenseDto } from "@/types/expenses";

const PERIOD_STORAGE_KEY = "pos.expenses.period";
const FALLBACK_PRESET = "today" as const;
// The header's Add button is as wide as its label (BRAND_BUTTON_CLASS is full width); in an empty state it fills its box.
const HEADER_ADD_CLASS = "h-10 w-auto shrink-0 px-4 pointer-coarse:h-11";
const MORE_BUTTON_CLASS = "size-10 shrink-0 border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash pointer-coarse:size-11";
const MENU_ITEM_CLASS = "min-h-9 pointer-coarse:min-h-11";

interface SheetState {
  open: boolean;
  key: number;
  expense: ExpenseDto | null;
}

// The Expenses screen. Everyone can add an expense; staff then see only what
// they added today, read-only. An admin also gets the period + filters, the full
// list (a table from md up, a day-grouped list on phones; open a row to edit or
// delete), and a "..." menu with the Categories and Expense report links.
export function ExpensesView() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const categories = useExpenseCategories();
  const { period, restored, save } = useStoredPeriod({ key: PERIOD_STORAGE_KEY, fallback: FALLBACK_PRESET, maxDays: MAX_REPORT_RANGE_DAYS });
  const range = rangeOfPeriod(period, FALLBACK_PRESET);
  const [categoryId, setCategoryId] = useState<string>(ALL_FILTER);
  const [mode, setMode] = useState<string>(ALL_FILTER);
  const [limit, setLimit] = useState(EXPENSE_LIST_PAGE);
  const [sheet, setSheet] = useState<SheetState>({ open: false, key: 0, expense: null });

  const filters: ExpenseListFilters = isAdmin
    ? {
        from: range.from,
        to: range.to,
        categoryId: categoryId === ALL_FILTER ? undefined : categoryId,
        mode: mode === ALL_FILTER ? undefined : (mode as ExpensePaymentMode),
        limit,
      }
    : { limit };
  // An admin's query waits for the remembered period, so a stored choice never first fetches "today".
  const list = useExpenses(filters, !authLoading && (isAdmin ? restored : true));
  const data = list.data;
  const filtered = categoryId !== ALL_FILTER || mode !== ALL_FILTER;

  const openAdd = () => setSheet((s) => ({ open: true, key: s.key + 1, expense: null }));
  const openEdit = (expense: ExpenseDto) => setSheet((s) => ({ open: true, key: s.key + 1, expense }));

  const onSelection = (next: DashboardSelection) => {
    setLimit(EXPENSE_LIST_PAGE);
    save(next.preset === "custom" ? { preset: "custom", custom: next.range } : { preset: next.preset });
  };
  const clearFilters = () => {
    setCategoryId(ALL_FILTER);
    setMode(ALL_FILTER);
    setLimit(EXPENSE_LIST_PAGE);
  };

  const addButton = (className?: string) => (
    <Button type="button" onClick={openAdd} className={cn(BRAND_BUTTON_CLASS, className)}>
      <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add expense
    </Button>
  );
  // The total, once, as one slim line - under the filters for an admin, under the header for staff.
  // Hidden when the list failed or is offline: the ErrorState below says so, and a skeleton here would read as "loading".
  const summary = authLoading || (!data && (list.isError || list.isPaused)) ? null : (
    <ExpenseTotals label={isAdmin ? "Total" : "Added today"} totalPaise={data?.totalPaise} count={data?.count} updating={list.isPlaceholderData} />
  );

  const body = () => {
    if (authLoading || (!data && !list.isError && !list.isPaused)) {
      return (
        <>
          <div className="md:hidden">
            <ExpenseListSkeleton />
          </div>
          <ExpenseTableSkeleton />
        </>
      );
    }
    if (!data) {
      return (
        <ErrorState
          title={list.isError ? "Couldn't load expenses" : "You're offline"}
          description={list.isError ? "Something went wrong while loading. Please try again." : "Reconnect to see your expenses."}
          onRetry={() => void list.refetch()}
          retryLabel="Try again"
        />
      );
    }
    if (data.rows.length === 0) {
      if (!isAdmin) {
        return (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Nothing added yet today"
            description="Tap Add expense whenever you spend money for the business."
            action={<div className="mt-2 flex w-full max-w-xs">{addButton()}</div>}
          />
        );
      }
      return (
        <EmptyState
          icon={<Wallet className="h-8 w-8" />}
          title={filtered ? "No expenses match these filters" : "No expenses in these dates"}
          description={filtered ? "Try other dates, or clear the category and payment filters." : "Pick other dates, or add what you spent."}
          action={
            filtered ? (
              <Button type="button" variant="outline" onClick={clearFilters} className="mt-2 h-10 pointer-coarse:h-11">
                Clear filters
              </Button>
            ) : (
              <div className="mt-2 flex w-full max-w-xs">{addButton()}</div>
            )
          }
        />
      );
    }
    return (
      <>
        <div className="md:hidden">
          <ExpenseList rows={data.rows} categories={categories.data} onOpen={isAdmin ? openEdit : undefined} updating={list.isPlaceholderData} />
        </div>
        <ExpenseTable rows={data.rows} categories={categories.data} onOpen={isAdmin ? openEdit : undefined} updating={list.isPlaceholderData} />
        {data.truncated && limit < EXPENSE_LIST_MAX && (
          <Button
            type="button"
            variant="outline"
            disabled={list.isFetching}
            onClick={() => setLimit((l) => Math.min(l + EXPENSE_LIST_PAGE, EXPENSE_LIST_MAX))}
            className="h-11 w-full border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash"
          >
            Show more
          </Button>
        )}
        {data.truncated && limit >= EXPENSE_LIST_MAX && (
          <p className="text-center text-[12.5px] text-brand-muted">Showing the latest {EXPENSE_LIST_MAX}. Pick fewer dates to see the rest.</p>
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        className="flex-nowrap"
        actions={
          <div className="flex shrink-0 items-center gap-2">
            {addButton(HEADER_ADD_CLASS)}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon" aria-label="More" className={MORE_BUTTON_CLASS}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
                    <Link href={EXPENSE_CATEGORIES_PATH} prefetch={false}>
                      <Tags aria-hidden /> Categories
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className={MENU_ITEM_CLASS}>
                    <Link href={EXPENSE_REPORT_PATH} prefetch={false}>
                      <BarChart3 aria-hidden /> Expense report
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />

      {isAdmin && (
        <ExpenseFilters
          selection={{ preset: period.preset, range }}
          onSelection={onSelection}
          categories={categories.data}
          categoryId={categoryId}
          onCategory={(id) => {
            setCategoryId(id);
            setLimit(EXPENSE_LIST_PAGE);
          }}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setLimit(EXPENSE_LIST_PAGE);
          }}
          summary={summary}
        />
      )}

      {!isAdmin && summary}
      {body()}

      <ExpenseFormSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        formKey={sheet.key}
        expense={sheet.expense}
        categories={categories.data}
        categoriesFailed={categories.isError && !categories.data}
        isAdmin={isAdmin}
      />
    </>
  );
}
