"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { EXPENSE_NAME_MAX_LEN, EXPENSE_NOTE_MAX_LEN, EXPENSE_PAYMENT_MODES, EXPENSE_PAYMENT_MODE_LABELS, type ExpensePaymentMode } from "@pos/shared/expense";
import { useCreateExpense, useDeleteExpense, useUpdateExpense } from "@/hooks/use-expenses";
import { ApiError } from "@/lib/api-client";
import { cafeDateString, cn } from "@/lib/utils";
import { BRAND_INPUT_CLASS } from "@/components/brand/brand-classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/DatePicker";
import { ExpenseDeleteConfirm } from "@/components/expenses/ExpenseDeleteConfirm";
import {
  DATE_TRIGGER_CLASS,
  ExpenseField,
  ExpenseFormFooter,
  ExpenseSelectField,
  type SaveMode,
  type SelectOption,
} from "@/components/expenses/ExpenseFormFields";
import {
  buildCreateInput,
  buildUpdateInput,
  expenseDateBounds,
  initialExpenseValues,
  offeredCategoryId,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormField,
  type ExpenseFormValues,
} from "@/components/expenses/expense-form";
import type { ExpenseCategoryDto, ExpenseDto } from "@/types/expenses";

const STALE_ROW_STATUS = 409;
const GONE_ROW_STATUS = 404;

const PAYMENT_OPTIONS: readonly SelectOption[] = EXPENSE_PAYMENT_MODES.map((mode) => ({
  value: mode,
  label: EXPENSE_PAYMENT_MODE_LABELS[mode],
}));

interface ExpenseFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped by the page on every open, so each open is a fresh form with its own clientRef. */
  formKey: number;
  /** The row being edited (admin only); null = add a new expense. */
  expense: ExpenseDto | null;
  categories: ExpenseCategoryDto[] | undefined;
  categoriesFailed: boolean;
  isAdmin: boolean;
}

// Add + edit in one slide-in sheet. Fields run in the order people think:
// how much, what, which category, when, how paid, a note. The form mounts only
// while the sheet is open, so state and the idempotency key reset on every open.
// Adding offers two saves: "Add expense" (closes) and "Save & add another".
export function ExpenseFormSheet({ open, onOpenChange, formKey, expense, categories, categoriesFailed, isAdmin }: ExpenseFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* [&>button] = the primitive's own close X (the only direct-child button): a 44 px target. */}
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button]:right-1.5 [&>button]:top-1.5 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center">
        <ExpenseForm
          key={formKey}
          expense={expense}
          categories={categories}
          categoriesFailed={categoriesFailed}
          isAdmin={isAdmin}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

interface ExpenseFormProps {
  expense: ExpenseDto | null;
  categories: ExpenseCategoryDto[] | undefined;
  categoriesFailed: boolean;
  isAdmin: boolean;
  onClose: () => void;
}

function ExpenseForm({ expense, categories, categoriesFailed, isAdmin, onClose }: ExpenseFormProps) {
  const today = cafeDateString();
  const bounds = expenseDateBounds(today);
  const [values, setValues] = useState<ExpenseFormValues>(() => initialExpenseValues(expense, today));
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // One key per expense (the ReceivePaymentDialog precedent): a double-tapped or
  // retried Save returns the first row instead of recording the expense twice. A
  // failed save keeps it (the retry is a replay); a successful "Save & add another"
  // mints a new one, or the server would replay the FIRST row and drop the next bill.
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());
  const [savedCount, setSavedCount] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);
  const refocusAmount = useRef(false);
  const [pressed, setPressed] = useState<SaveMode>("close");

  const create = useCreateExpense();
  const update = useUpdateExpense();
  const remove = useDeleteExpense();
  const isPending = create.isPending || update.isPending || remove.isPending;
  const editing = expense !== null;

  // Editing a field clears that field's own error only.
  const set = <K extends keyof ExpenseFormValues>(key: K, next: ExpenseFormValues[K], field?: ExpenseFormField) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Visible categories only; an edit also keeps the row's own category even if hidden since.
  const categoryOptions: SelectOption[] = (categories ?? [])
    .filter((c) => !c.hidden || c.id === expense?.categoryId)
    .map((c) => ({ value: c.id, label: c.hidden ? `${c.name} (hidden)` : c.name }));
  const categoryValue = offeredCategoryId(categories ? categoryOptions : null, values.categoryId);

  // The row changed (409) or was deleted (404) since this sheet opened: the hook has
  // already toasted why and refreshed the list, so close — reopening shows the current row.
  const closeIfStale = (error: Error) => {
    if (error instanceof ApiError && (error.status === STALE_ROW_STATUS || error.status === GONE_ROW_STATUS)) onClose();
  };

  // The amount field is disabled while a save is in flight, so focus can only land once it ends.
  useEffect(() => {
    if (!refocusAmount.current || isPending) return;
    refocusAmount.current = false;
    amountRef.current?.focus();
  }, [isPending, savedCount]);

  // Saved, sheet stays open: clear what changes bill to bill, keep date / category / paid by,
  // and mint the next expense's own clientRef.
  const startNextExpense = () => {
    setValues((prev) => ({ ...prev, amountText: "", name: "", note: "" }));
    setErrors({});
    setClientRef(crypto.randomUUID());
    setSavedCount((n) => n + 1);
    refocusAmount.current = true;
  };

  const save = (mode: SaveMode) => {
    if (isPending) return;
    const check = validateExpenseForm({ ...values, categoryId: categoryValue }, today, expense?.date);
    setErrors(check.errors);
    if (check.amountPaise === null || Object.keys(check.errors).length > 0) return;

    if (!expense) {
      setPressed(mode);
      create.mutate(buildCreateInput(values, check.amountPaise, clientRef), {
        onSuccess: mode === "again" ? startNextExpense : onClose,
      });
      return;
    }
    const input = buildUpdateInput(expense, values, check.amountPaise);
    if (!input) return onClose();
    update.mutate({ id: expense.id, input }, { onSuccess: onClose, onError: closeIfStale });
  };

  // Enter in a field submits the form's only submit button: "Add expense", which closes.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save("close");
  };

  // Failed wins over loading: a failed fetch with no cached list must not read as still loading.
  const categoryPlaceholder =
    categoryOptions.length > 0 ? "Pick a category" : categoriesFailed ? "Couldn't load" : categories ? "No categories yet" : "Loading…";
  const categoryEmptyHint = categoriesFailed
    ? "Couldn't load the categories. Close this and try again."
    : categories
      ? isAdmin
        ? "No categories to pick. Show or add one in Categories."
        : "No categories to pick. Ask the owner to add one."
      : "Loading categories…";

  return (
    <>
      <SheetHeader className="space-y-1 border-b border-brand-rule px-4 py-4 pr-14 text-left">
        <SheetTitle>{editing ? "Edit expense" : "Add expense"}</SheetTitle>
        <SheetDescription>
          {editing
            ? `Added by ${expense.createdBy}`
            : savedCount > 0
              ? `Added ${savedCount} so far. Fill in the next one.`
              : "Fill in what you paid for and how much."}
        </SheetDescription>
      </SheetHeader>

      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <ExpenseField id="expense-amount" label="Amount" error={errors.amount}>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-2xl font-semibold text-brand-muted">
                ₹
              </span>
              <Input
                id="expense-amount"
                ref={amountRef}
                inputMode="decimal"
                autoComplete="off"
                autoFocus={!editing}
                placeholder="0"
                value={values.amountText}
                onChange={(e) => set("amountText", e.target.value, "amount")}
                disabled={isPending}
                aria-invalid={!!errors.amount}
                className={cn(BRAND_INPUT_CLASS, "h-14 pl-10 text-2xl font-semibold tabular-nums md:text-2xl")}
              />
            </div>
          </ExpenseField>

          <ExpenseField id="expense-name" label="What was it?" error={errors.name}>
            <Input
              id="expense-name"
              autoComplete="off"
              placeholder="e.g. Milk, gas cylinder"
              maxLength={EXPENSE_NAME_MAX_LEN}
              value={values.name}
              onChange={(e) => set("name", e.target.value, "name")}
              disabled={isPending}
              aria-invalid={!!errors.name}
              className={BRAND_INPUT_CLASS}
            />
          </ExpenseField>

          <ExpenseSelectField
            id="expense-category"
            label="Category"
            value={categoryValue}
            onChange={(v) => set("categoryId", v, "categoryId")}
            options={categoryOptions}
            placeholder={categoryPlaceholder}
            disabled={isPending}
            error={errors.categoryId}
            hint={categoryOptions.length === 0 ? categoryEmptyHint : undefined}
          />

          <ExpenseField id="expense-date" label="Date" error={errors.date}>
            {/* The app's own calendar, never the browser's native date popup (owner rule). */}
            <DatePicker
              id="expense-date"
              min={bounds.min}
              max={bounds.max}
              value={values.date}
              onChange={(next) => set("date", next, "date")}
              disabled={isPending}
              invalid={!!errors.date}
              className={DATE_TRIGGER_CLASS}
            />
          </ExpenseField>

          <ExpenseSelectField
            id="expense-mode"
            label="Paid by"
            value={values.paymentMode}
            onChange={(v) => set("paymentMode", v as ExpensePaymentMode)}
            options={PAYMENT_OPTIONS}
            disabled={isPending}
          />

          <ExpenseField id="expense-note" label="Note (optional)">
            <Textarea
              id="expense-note"
              rows={2}
              maxLength={EXPENSE_NOTE_MAX_LEN}
              placeholder="e.g. bill number, who it was paid to"
              value={values.note}
              onChange={(e) => set("note", e.target.value)}
              disabled={isPending}
              className="rounded-md border-brand-field bg-brand-slip text-base text-brand-ink md:text-[15px]"
            />
          </ExpenseField>

          {editing && isAdmin && (
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => setConfirmingDelete(true)}
              className="h-10 w-full text-brand-danger hover:bg-brand-wash hover:text-brand-danger pointer-coarse:h-11"
            >
              Delete this expense
            </Button>
          )}
        </div>

        <ExpenseFormFooter editing={editing} isPending={isPending} saving={create.isPending || update.isPending} pressed={pressed} onAddAnother={() => save("again")} />
      </form>

      {editing && (
        <ExpenseDeleteConfirm
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          isPending={remove.isPending}
          onConfirm={() => remove.mutate(expense.id, { onSuccess: onClose, onError: closeIfStale })}
        />
      )}
    </>
  );
}
