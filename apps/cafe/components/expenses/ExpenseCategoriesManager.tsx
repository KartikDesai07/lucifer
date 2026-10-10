"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Tags } from "lucide-react";

import { EXPENSES_PATH, EXPENSE_CATEGORIES_MAX, EXPENSE_CATEGORY_NAME_MAX_LEN } from "@pos/shared/expense";
import { useCreateExpenseCategory, useExpenseCategories } from "@/hooks/use-expenses";
import { BRAND_INPUT_CLASS } from "@/components/brand/brand-classes";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpenseCategoryRow } from "@/components/expenses/ExpenseCategoryRow";
import { cn } from "@/lib/utils";

const SKELETON_ROWS = 6;

// Admin only (the page wraps it in AdminGuard). Add a category, rename one, or
// hide / show it. Visible categories come first, hidden ones after.
export function ExpenseCategoriesManager() {
  const categories = useExpenseCategories();
  const create = useCreateExpenseCategory();
  const [name, setName] = useState("");

  const list = categories.data ?? [];
  const visible = list.filter((c) => !c.hidden);
  const hidden = list.filter((c) => c.hidden);
  const ordered = [...visible, ...hidden];
  const atLimit = list.length >= EXPENSE_CATEGORIES_MAX;

  const add = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending || atLimit) return;
    create.mutate({ name: trimmed }, { onSuccess: () => setName("") });
  };

  const body = () => {
    if (categories.isError && !categories.data) {
      return (
        <ErrorState
          title="Couldn't load categories"
          description="Something went wrong while loading. Please try again."
          onRetry={() => void categories.refetch()}
          retryLabel="Try again"
        />
      );
    }
    if (!categories.data) {
      return (
        <div className="space-y-2" aria-busy aria-label="Loading categories">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <BrandSkeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      );
    }
    if (ordered.length === 0) {
      return <EmptyState icon={<Tags className="h-8 w-8" />} title="No categories yet" description="Add your first one above, like Ingredients or Rent." />;
    }
    return (
      <ul className="divide-y divide-brand-rule overflow-hidden rounded-xl border border-brand-rule bg-brand-slip">
        {ordered.map((category) => (
          <li key={category.id}>
            <ExpenseCategoryRow category={category} />
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={EXPENSES_PATH}
            className="-ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-brand-muted hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent pointer-coarse:min-h-11"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Expenses
          </Link>
        }
        title="Expense categories"
        description="What you pick from when adding an expense. Hiding one keeps your old expenses as they were."
      />

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={EXPENSE_CATEGORY_NAME_MAX_LEN}
          placeholder="New category, e.g. Cleaning"
          aria-label="New category name"
          autoComplete="off"
          disabled={create.isPending || atLimit}
          className={cn(BRAND_INPUT_CLASS, "h-11 min-w-0 basis-full sm:flex-1 sm:basis-0")}
        />
        <Button type="submit" disabled={create.isPending || atLimit || name.trim() === ""} className="h-11 w-full sm:w-auto sm:px-5">
          {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
          Add category
        </Button>
      </form>

      {categories.data && (
        <p className="text-[12.5px] text-brand-muted">
          {list.length} of {EXPENSE_CATEGORIES_MAX} categories
          {atLimit ? ". That is the most allowed. To add another, rename one you no longer use (its old expenses will show the new name too)." : ""}
        </p>
      )}

      {body()}
    </>
  );
}
