"use client";

import { EXPENSE_PAYMENT_MODE_LABELS } from "@pos/shared/expense";
import { cn, cafeDateString, inrPaise } from "@/lib/utils";
import { BRAND_PANEL_CLASS, BRAND_TABLE_CONTAIN_CLASS } from "@/components/brand/brand-classes";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryNameMap, categoryNameOf, dayHeading } from "@/components/expenses/expense-format";
import type { ExpenseCategoryDto, ExpenseDto } from "@/types/expenses";

const SKELETON_ROWS = 6;

// The panel is the phone list's counterpart: only from md up. Its width never
// follows the table (BRAND_TABLE_CONTAIN_CLASS); the ui Table's own overflow box
// is the last resort, and the flexible Item cell + the Note cell truncate first.
const PANEL_CLASS = cn("hidden overflow-hidden rounded-xl border md:block", BRAND_PANEL_CLASS, BRAND_TABLE_CONTAIN_CLASS);
const HEAD_ROW_CLASS = "border-brand-rule hover:bg-transparent";
// Tighter cells below lg: at 768 px the open sidebar leaves ~464 px, and Date + Item + Category + Amount must
// fit it without the card scrolling sideways (s89b review).
const HEAD_CLASS = "h-10 whitespace-nowrap px-3 text-[12.5px] font-medium text-brand-muted lg:px-4"; // "Paid by" wrapped at 1440
const CELL_CLASS = "px-3 py-3 text-[14px] text-brand-ink lg:px-4";
// Paid by moves under the category below lg and the note appears from xl, so a
// tablet next to the open sidebar still leaves the Item name room to read.
const PAID_BY_COLUMN_CLASS = "hidden lg:table-cell";
const NOTE_COLUMN_CLASS = "hidden xl:table-cell";

export function ExpenseTableSkeleton() {
  return (
    <div className={cn(PANEL_CLASS, "space-y-2 p-3")} aria-busy aria-label="Loading expenses">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <BrandSkeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

interface ExpenseTableProps {
  rows: ExpenseDto[];
  categories: ExpenseCategoryDto[] | undefined;
  /** Admin only: a click on a row (or its name) opens the edit sheet. */
  onOpen?: (expense: ExpenseDto) => void;
  /** The previous filters' rows are still showing while new ones load. */
  updating?: boolean;
}

// The expenses as a table from md up, in the server's order (newest day first).
// Plain text everywhere — no pills; "edited" is said once, after the name.
export function ExpenseTable({ rows, categories, onOpen, updating }: ExpenseTableProps) {
  const today = cafeDateString();
  const names = categoryNameMap(categories);
  return (
    <div className={cn(PANEL_CLASS, "transition-opacity", updating && "opacity-60")} aria-busy={updating}>
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW_CLASS}>
            <TableHead className={HEAD_CLASS}>Date</TableHead>
            <TableHead className={HEAD_CLASS}>Item</TableHead>
            <TableHead className={HEAD_CLASS}>Category</TableHead>
            <TableHead className={cn(HEAD_CLASS, PAID_BY_COLUMN_CLASS)}>Paid by</TableHead>
            <TableHead className={cn(HEAD_CLASS, NOTE_COLUMN_CLASS)}>Note</TableHead>
            <TableHead className={cn(HEAD_CLASS, "text-right")}>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((expense) => {
            const category = categoryNameOf(names, expense.categoryId);
            const paidBy = EXPENSE_PAYMENT_MODE_LABELS[expense.paymentMode];
            return (
              <TableRow
                key={expense.id}
                onClick={onOpen ? () => onOpen(expense) : undefined}
                className={cn("border-brand-rule", onOpen ? "cursor-pointer hover:bg-brand-wash" : "hover:bg-transparent")}
              >
                <TableCell className={cn(CELL_CLASS, "whitespace-nowrap")}>{dayHeading(expense.date, today)}</TableCell>
                <TableCell className={cn(CELL_CLASS, "w-full min-w-24 max-w-0 lg:min-w-32")}>
                  <div className="flex min-w-0 items-baseline gap-2">
                    {onOpen ? (
                      <button
                        type="button"
                        aria-label={`Edit expense ${expense.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(expense);
                        }}
                        className="min-w-0 truncate rounded-sm text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                      >
                        {expense.name}
                      </button>
                    ) : (
                      <span className="min-w-0 truncate font-semibold">{expense.name}</span>
                    )}
                    {expense.edited && <span className="shrink-0 text-[12.5px] text-brand-muted">edited</span>}
                  </div>
                  {/* Below xl the Note column is hidden, so the note rides under the name — never lost. */}
                  {expense.note && <span className="block truncate text-[12.5px] text-brand-muted xl:hidden">{expense.note}</span>}
                </TableCell>
                <TableCell className={cn(CELL_CLASS, "max-w-32 lg:max-w-40 xl:max-w-56")}>
                  <span className="block truncate">{category}</span>
                  <span className={"block truncate text-[12.5px] text-brand-muted lg:hidden"}>{paidBy}</span>
                </TableCell>
                <TableCell className={cn(CELL_CLASS, PAID_BY_COLUMN_CLASS, "whitespace-nowrap")}>{paidBy}</TableCell>
                <TableCell className={cn(CELL_CLASS, NOTE_COLUMN_CLASS, "max-w-64 text-brand-muted")}>
                  <span className="block truncate">{expense.note || "—"}</span>
                </TableCell>
                <TableCell className={cn(CELL_CLASS, "whitespace-nowrap text-right text-[14.5px] font-semibold tabular-nums")}>
                  {inrPaise(expense.amountPaise)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
