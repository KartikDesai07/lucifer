"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// The generic report table (R1/R4 "Day by day" / "Daily tally" / dues lists):
// a real <table> with a footer Total row on md+, one card per row on a phone
// (owner decision #5 — P2, no sideways scroll). Every report page hands it
// typed columns + rows; this file owns only the two renderings.

export interface ReportTableColumn<Row> {
  key: string;
  label: string;
  align?: "left" | "right";
  cell: (row: Row) => ReactNode;
  /** This column's value in the footer Total row (omit for a blank footer cell). */
  total?: ReactNode;
  /** Bold this column everywhere (e.g. Net sales). */
  strong?: boolean;
}

export interface ReportTablePhoneCard<Row> {
  title: (row: Row) => ReactNode;
  value: (row: Row) => ReactNode;
  lines: (row: Row) => ReactNode[];
}

interface ReportTableProps<Row> {
  columns: ReadonlyArray<ReportTableColumn<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row, index: number) => void;
  /** Screen-reader name of a row's action button ("Details for Tue, 23 Sep"). */
  actionLabel?: (row: Row) => string;
  /** The row already carries its own labelled action (e.g. "Receive payment") — no trailing chevron. */
  hideChevron?: boolean;
  selectedKey?: string | null;
  totalLabel?: string;
  phoneCard: ReportTablePhoneCard<Row>;
  totalCard?: { title: ReactNode; value: ReactNode; lines?: ReactNode[] };
  loading?: boolean;
  emptyTitle: string;
  emptyDescription: string;
}

const SKELETON_ROWS = 5;

export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  actionLabel,
  hideChevron,
  selectedKey,
  totalLabel = "Total",
  phoneCard,
  totalCard,
  loading,
  emptyTitle,
  emptyDescription,
}: ReportTableProps<Row>) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <BrandSkeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      {/* md+: a real table, clickable rows keyboard-reachable via a trailing
          button (the row itself is also clickable). */}
      {/* Scrolls inside the card on a narrow tablet. inline-size containment keeps the
          table's width from becoming the PAGE's minimum width (overflow alone does
          not: measured 768px -> 1024px before this). */}
      <div className="hidden overflow-x-auto rounded-lg border border-brand-rule [contain:inline-size] md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-brand-rule hover:bg-transparent">
              {columns.map((c) => (
                <TableHead key={c.key} className={cn("whitespace-nowrap text-brand-muted", c.align === "right" && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
              {onRowClick && !hideChevron && <TableHead className="w-10" aria-hidden />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const key = rowKey(row);
              const clickable = !!onRowClick;
              return (
                <TableRow
                  key={key}
                  onClick={clickable ? () => onRowClick(row, index) : undefined}
                  className={cn(
                    "border-brand-rule",
                    clickable && "cursor-pointer hover:bg-brand-wash",
                    selectedKey === key && "bg-brand-primary-soft",
                  )}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn("whitespace-nowrap", c.align === "right" && "text-right tabular-nums", c.strong && "font-semibold")}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  {clickable && !hideChevron && (
                    <TableCell className="text-right">
                      <button
                        type="button"
                        aria-label={actionLabel ? actionLabel(row) : `Details for ${key}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick(row, index);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-brand-muted hover:bg-brand-wash hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="border-brand-rule bg-brand-wash hover:bg-brand-wash">
              {columns.map((c, i) => (
                <TableCell key={c.key} className={cn("whitespace-nowrap font-semibold", c.align === "right" && "text-right tabular-nums")}>
                  {i === 0 ? totalLabel : c.total}
                </TableCell>
              ))}
              {onRowClick && !hideChevron && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Below md: one card per row (P2), then a highlighted Total card. */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((row, index) => {
          const key = rowKey(row);
          const content = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] font-medium text-brand-ink">{phoneCard.title(row)}</span>
                <span className="text-[14px] font-semibold tabular-nums text-brand-ink">{phoneCard.value(row)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-1.5 text-[12.5px] text-brand-muted">{phoneCard.lines(row)}</div>
            </>
          );
          return onRowClick ? (
            <button
              key={key}
              type="button"
              onClick={() => onRowClick(row, index)}
              className={cn(
                "min-h-[44px] rounded-lg border border-brand-rule bg-brand-slip p-3 text-left hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
                selectedKey === key && "border-brand-primary bg-brand-primary-soft",
              )}
            >
              {content}
            </button>
          ) : (
            <div key={key} className="min-h-[44px] rounded-lg border border-brand-rule bg-brand-slip p-3">
              {content}
            </div>
          );
        })}
        {totalCard && (
          <div className="rounded-lg border border-brand-primary bg-brand-primary-soft p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-semibold text-brand-ink">{totalCard.title}</span>
              <span className="text-[14px] font-semibold tabular-nums text-brand-ink">{totalCard.value}</span>
            </div>
            {totalCard.lines && totalCard.lines.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-1.5 text-[12.5px] text-brand-muted">{totalCard.lines}</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
