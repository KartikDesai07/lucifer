"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import { REPORT_KEYS } from "@/hooks/use-reports";
import { EXPENSE_LIST_MAX, type ExpensePaymentMode } from "@pos/shared/expense";
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from "@/schemas";
import type { DashboardRange } from "@/types/dashboard";
import type { ExpenseCategoryDto, ExpenseDto, ExpenseListDto } from "@/types/expenses";

// Expense management (Step EXP, 2026-10-10). Every expense write invalidates
// the lists AND the Expenses report (REPORT_KEYS.expenses); a category write
// also refreshes the report, which prints category names.
export const EXPENSE_KEYS = {
  all: ["expenses"] as const,
  categories: ["expenses", "categories"] as const,
  lists: ["expenses", "list"] as const,
  list: (f: ExpenseListFilters) =>
    ["expenses", "list", f.from ?? "", f.to ?? "", f.categoryId ?? "", f.mode ?? "", f.limit] as const,
};

/** Staff: the server ignores from/to/categoryId/mode and returns their own entries from today. */
export interface ExpenseListFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  mode?: ExpensePaymentMode;
  limit: number;
}

export function expenseListUrl(f: ExpenseListFilters): string {
  const q = new URLSearchParams();
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.categoryId) q.set("categoryId", f.categoryId);
  if (f.mode) q.set("mode", f.mode);
  q.set("limit", String(f.limit));
  return `/api/expenses?${q.toString()}`;
}

/** The CSV read: every row of the range, up to EXPENSE_LIST_MAX (check `truncated`). */
export function fetchExpensesForCsv(range: DashboardRange): Promise<ExpenseListDto> {
  return apiGet<ExpenseListDto>(expenseListUrl({ from: range.from, to: range.to, limit: EXPENSE_LIST_MAX }));
}

/** All categories, hidden ones included (flagged), in the owner's order. */
export function useExpenseCategories() {
  return useQuery({
    queryKey: EXPENSE_KEYS.categories,
    queryFn: () => apiGet<ExpenseCategoryDto[]>("/api/expense-categories"),
    staleTime: STALE_TIMES.CATEGORIES,
  });
}

export function useExpenses(filters: ExpenseListFilters, enabled = true) {
  return useQuery({
    enabled,
    queryKey: EXPENSE_KEYS.list(filters),
    queryFn: () => apiGet<ExpenseListDto>(expenseListUrl(filters)),
    staleTime: STALE_TIMES.LIVE,
    placeholderData: keepPreviousData,
  });
}

function refreshExpenses(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: EXPENSE_KEYS.lists });
  void qc.invalidateQueries({ queryKey: REPORT_KEYS.expensesAll });
}

function toastError(error: Error): void {
  toast.error(error.message);
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => apiSend<ExpenseDto>("/api/expenses", "POST", input),
    onSuccess: () => {
      toast.success("Expense added");
      refreshExpenses(qc);
    },
    onError: toastError,
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateExpenseInput }) =>
      apiSend<ExpenseDto>(`/api/expenses/${id}`, "PATCH", input),
    onSuccess: () => {
      toast.success("Expense updated");
      refreshExpenses(qc);
    },
    // A 409 (someone changed or deleted it meanwhile) also refreshes the list,
    // so the editor's next look is the current row.
    onError: (error: Error) => {
      toastError(error);
      refreshExpenses(qc);
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ deleted: true }>(`/api/expenses/${id}`, "DELETE"),
    onSuccess: () => {
      toast.success("Expense deleted");
      refreshExpenses(qc);
    },
    onError: (error: Error) => {
      toastError(error);
      refreshExpenses(qc);
    },
  });
}

function refreshCategories(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: EXPENSE_KEYS.categories });
  void qc.invalidateQueries({ queryKey: REPORT_KEYS.expensesAll });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseCategoryInput) =>
      apiSend<ExpenseCategoryDto>("/api/expense-categories", "POST", input),
    onSuccess: () => {
      toast.success("Category added");
      refreshCategories(qc);
    },
    onError: toastError,
  });
}

export function useUpdateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateExpenseCategoryInput }) =>
      apiSend<ExpenseCategoryDto>(`/api/expense-categories/${id}`, "PATCH", input),
    onSuccess: () => refreshCategories(qc),
    onError: (error: Error) => {
      toastError(error);
      refreshCategories(qc);
    },
  });
}
