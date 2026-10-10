"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { EXPENSE_CATEGORY_NAME_MAX_LEN } from "@pos/shared/expense";
import { useUpdateExpenseCategory } from "@/hooks/use-expenses";
import { BRAND_INPUT_CLASS } from "@/components/brand/brand-classes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExpenseCategoryDto } from "@/types/expenses";

const ROW_BUTTON_CLASS = "h-10 border-brand-rule bg-brand-slip px-3 text-brand-ink hover:bg-brand-wash pointer-coarse:h-11";

// One category: its name, a "Hidden" tag when it is hidden, Rename (in place)
// and Hide / Show. A hidden category is not offered when adding an expense, but
// old expenses keep its name. There is deliberately no delete.
export function ExpenseCategoryRow({ category }: { category: ExpenseCategoryDto }) {
  const update = useUpdateExpenseCategory();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const isPending = update.isPending;

  const startRename = () => {
    setDraft(category.name);
    setRenaming(true);
  };

  const saveRename = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || isPending) return;
    if (name === category.name) return setRenaming(false);
    update.mutate({ id: category.id, input: { name } }, { onSuccess: () => setRenaming(false) });
  };

  if (renaming) {
    return (
      <form onSubmit={saveRename} className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={EXPENSE_CATEGORY_NAME_MAX_LEN}
          aria-label={`New name for ${category.name}`}
          disabled={isPending}
          className={cn(BRAND_INPUT_CLASS, "h-11 min-w-0 basis-full sm:flex-1 sm:basis-0")}
        />
        <Button type="submit" disabled={isPending || draft.trim() === ""} className="h-10 flex-1 pointer-coarse:h-11 sm:flex-none">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => setRenaming(false)} className={cn(ROW_BUTTON_CLASS, "flex-1 sm:flex-none")}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex min-h-14 items-center gap-2 px-4 py-2">
      {/* A div, not a <p>: Badge renders a <div>. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("truncate text-[14.5px] font-medium", category.hidden ? "text-brand-muted" : "text-brand-ink")}>{category.name}</span>
        {category.hidden && (
          <Badge variant="outline" className="shrink-0 border-brand-rule text-brand-muted">
            Hidden
          </Badge>
        )}
      </div>
      <Button type="button" variant="outline" disabled={isPending} onClick={startRename} aria-label={`Rename ${category.name}`} className={ROW_BUTTON_CLASS}>
        Rename
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => update.mutate({ id: category.id, input: { hidden: !category.hidden } })}
        aria-label={`${category.hidden ? "Show" : "Hide"} ${category.name}`}
        className={ROW_BUTTON_CLASS}
      >
        {category.hidden ? "Show" : "Hide"}
      </Button>
    </div>
  );
}
