"use client";

import { useState } from "react";
import { format } from "date-fns";
import { History, Trash2 } from "lucide-react";

import { formatQty, type StockEntryKind } from "@pos/shared/inventory";
import { useDeleteStockEntry, useStockEntries } from "@/hooks/use-inventory";
import { parseDateInput } from "@/lib/date-input";
import { entryChangeText } from "@/lib/inventory/stock-adjust-form";
import {
  SETTINGS_HUB_ITEM_CLASS,
  SETTINGS_HUB_LIST_CLASS,
  SETTINGS_HUB_ROW_SUB_CLASS,
  SETTINGS_HUB_ROW_TITLE_CLASS,
  SETTINGS_REMOVE_BUTTON_CLASS,
} from "@/lib/settings-card-layout";
import { cn, inrPaise } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StockEntryDto, StockEntryLineDto } from "@/types/inventory";

const SKELETON_ROWS = 6;
const SKELETON_ROW_CLASS = "h-16 w-full rounded-none border-t border-border-2 first:border-t-0";
const ROW_CLASS = "flex min-h-16 items-center gap-3 px-4 py-3 text-foreground";
const SHORT_DATE_FORMAT = "d MMM";
const SEPARATOR = " · ";

const KIND_LABEL: Record<StockEntryKind, string> = { purchase: "Purchase", waste: "Wastage", count: "Count", payment: "Payment" };

/** "13 Nov"; the stored day itself if it cannot be read. */
function shortDate(date: string): string {
  const parsed = parseDateInput(date);
  return parsed ? format(parsed, SHORT_DATE_FORMAT) : date;
}

function titleOf(entry: StockEntryDto): string {
  const names = entry.lines.map((l) => l.name).join(", ");
  return names === "" ? KIND_LABEL[entry.kind] : `${KIND_LABEL[entry.kind]}${SEPARATOR}${names}`;
}

// A purchase: who it was from, what it cost, and what is still owed on it.
function purchaseParts(entry: StockEntryDto): string[] {
  const owed = entry.duePaise !== undefined && entry.duePaise > 0 ? [`${inrPaise(entry.duePaise)} to pay`] : [];
  return [entry.supplierName ?? "", entry.totalPaise === undefined ? "" : inrPaise(entry.totalPaise), ...owed];
}

function subLineOf(entry: StockEntryDto): string {
  if (entry.kind === "payment") return [shortDate(entry.date), entry.supplierName ?? "", `by ${entry.createdBy}`].filter((part) => part !== "").join(SEPARATOR);
  if (entry.kind === "purchase") return [shortDate(entry.date), ...purchaseParts(entry), `by ${entry.createdBy}`].filter((part) => part !== "").join(SEPARATOR);
  const counted = entry.lines.flatMap((l) => (l.countedMilli === undefined ? [] : [`Counted ${formatQty(l.countedMilli, l.unit)}`])).join(", ");
  const what = entry.kind === "count" ? counted : (entry.reason ?? "");
  return [shortDate(entry.date), what, `by ${entry.createdBy}`].filter((part) => part !== "").join(SEPARATOR);
}

// What deleting does to stock, per line: a purchase's amount comes back out; a wastage's goes back in; a count's change is undone.
function undoSentence(entry: StockEntryDto, line: StockEntryLineDto): string {
  if (line.qtyMilli === 0) return `${line.name}'s stock does not change.`;
  if (entry.kind === "purchase") return `${formatQty(Math.abs(line.qtyMilli), line.unit)} comes out of ${line.name}'s stock.`;
  if (entry.kind === "waste") return `${formatQty(Math.abs(line.qtyMilli), line.unit)} goes back into ${line.name}'s stock.`;
  return `${line.name}'s stock moves back by ${entryChangeText({ ...line, qtyMilli: -line.qtyMilli })}.`;
}

function deleteDescription(entry: StockEntryDto): string {
  // A payment moves no stock; deleting it puts the amount back onto what is owed.
  if (entry.kind === "payment") return `${inrPaise(entry.totalPaise ?? 0)} paid to ${entry.supplierName ?? "the supplier"} is removed, so it counts as owed again.`;
  const stock = entry.lines.length === 0 ? ["It leaves the history. Stock does not change."] : entry.lines.map((l) => undoSentence(entry, l));
  // A purchase also took what was unpaid onto the supplier's dues; deleting it removes that too.
  const owed = entry.duePaise !== undefined && entry.duePaise > 0 ? [`${inrPaise(entry.duePaise)} owed to ${entry.supplierName ?? "the supplier"} is removed.`] : [];
  return [...stock, ...owed].join(" ");
}

function EntryListSkeleton() {
  return (
    <div className={SETTINGS_HUB_LIST_CLASS} aria-busy aria-label="Loading history">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <Skeleton key={i} className={SKELETON_ROW_CLASS} />
      ))}
    </div>
  );
}

// The admin's history of purchases, payments, wastage and counts, newest first, a page at a time; with a supplierId, only that
// supplier's purchases and payments. Deleting an entry takes its stock change (or its payment) back out (once; the server guards a
// double tap), after a confirm that says what happens.
export function EntryList({ supplierId }: { supplierId?: string }) {
  const entries = useStockEntries(true, supplierId);
  const remove = useDeleteStockEntry();
  const [deleting, setDeleting] = useState<StockEntryDto | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      // The hook toasts the refusal; the confirm stays open.
    }
  };

  if (!entries.data && !entries.isError && !entries.isPaused) return <EntryListSkeleton />;
  if (!entries.data) {
    return (
      <ErrorState
        title={entries.isError ? "Couldn't load history" : "You're offline"}
        description={entries.isError ? "Something went wrong while loading. Please try again." : "Reconnect to see your history."}
        onRetry={() => void entries.refetch()}
        retryLabel="Try again"
      />
    );
  }
  const rows = entries.data.pages.flatMap((page) => page.rows);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-8 w-8" />}
        title={supplierId === undefined ? "No entries yet" : "Nothing here yet"}
        description={supplierId === undefined ? "Purchases, payments, wastage and counts show here." : "Purchases from this supplier and payments to them show here."}
      />
    );
  }

  return (
    <>
      <ul className={SETTINGS_HUB_LIST_CLASS}>
        {rows.map((entry) => (
          <li key={entry.id} className={SETTINGS_HUB_ITEM_CLASS}>
            <div className={ROW_CLASS}>
              <div className="min-w-0 flex-1">
                <div className={cn(SETTINGS_HUB_ROW_TITLE_CLASS, "truncate")}>{titleOf(entry)}</div>
                <div className={SETTINGS_HUB_ROW_SUB_CLASS}>{subLineOf(entry)}</div>
                {entry.note && <div className={cn(SETTINGS_HUB_ROW_SUB_CLASS, "break-words")}>{entry.note}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end text-[14.5px] font-semibold tabular-nums">
                {entry.kind === "payment" && entry.totalPaise !== undefined && <span>{inrPaise(entry.totalPaise)}</span>}
                {entry.lines.map((line) => (
                  <span key={line.itemId} className={cn(line.qtyMilli < 0 && "text-status-bad-ink")}>
                    {entryChangeText(line)}
                  </span>
                ))}
              </div>
              <button type="button" aria-label="Delete entry" disabled={remove.isPending} className={cn(SETTINGS_REMOVE_BUTTON_CLASS, "shrink-0")} onClick={() => setDeleting(entry)}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {entries.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
          className="h-11 w-full border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash"
        >
          Show older
        </Button>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description={deleting ? deleteDescription(deleting) : undefined}
        confirmLabel="Delete"
        isLoading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
