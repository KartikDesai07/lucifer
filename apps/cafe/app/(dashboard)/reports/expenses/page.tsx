"use client";

import { useState } from "react";
import { toast } from "sonner";

import { EXPENSE_LIST_MAX, EXPENSE_PAYMENT_MODE_LABELS } from "@pos/shared/expense";
import { inr, inrPaise } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { weekdayDayLabel } from "@/lib/dashboard/range";
import { expensesCsvRows } from "@/lib/expenses/csv";
import { fetchExpensesForCsv, useExpenseCategories } from "@/hooks/use-expenses";
import { useExpenseReport, useSalesReport } from "@/hooks/use-reports";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { DashCard } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatCard } from "@/components/reports/StatCard";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { ExpenseCategoryBars } from "@/components/expenses/ExpenseCategoryBars";
import { categoryNameMap } from "@/components/expenses/expense-format";
import { salesMinusExpensesPaise, shareLabel } from "@/components/expenses/expense-report";
import type { ExpenseDayTotal, ExpenseModeTotal } from "@/types/expenses";

const NO_FIGURE = "—";
const ROUGH_GUIDE = "A rough guide, not your accounts";

// Expenses report: where the money went, by category, by day and by how it was
// paid, plus a "Sales − expenses" card beside the Sales report's own figure.
// /reports/* is already admin-only and shares one picked period (reports layout).
export default function ExpensesReportPage() {
  const { range, restored } = useReportRange();
  const report = useExpenseReport(range, restored);
  const sales = useSalesReport(range, restored);
  const categories = useExpenseCategories();
  const [downloading, setDownloading] = useState(false);

  const r = report.data;
  const loading = !r;
  const updating = report.isPlaceholderData || sales.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();
  const compareCaption = r ? `for ${range.from === range.to ? "this day" : "this period"}` : "";

  const salesRupees = sales.data?.kpis.current.sales;
  const salesLoading = salesRupees === undefined && !sales.isError;
  const left = r && salesRupees !== undefined ? salesMinusExpensesPaise(salesRupees, r.totalPaise) : undefined;
  const biggest = r?.byCategory[0];

  const handleDownload = async () => {
    if (!r || downloading) return;
    setDownloading(true);
    try {
      const result = await fetchExpensesForCsv(r.range);
      if (result.rows.length === 0) {
        toast.info("There are no expenses to download in these dates");
        return;
      }
      exportToCSV(expensesCsvRows(result.rows, categoryNameMap(categories.data)), `expenses-${r.range.from}-to-${r.range.to}`);
      if (result.truncated) toast.warning(`The file has the latest ${EXPENSE_LIST_MAX} expenses. Pick fewer dates to get the rest.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't prepare the download. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const dayColumns: ReportTableColumn<ExpenseDayTotal>[] = [
    { key: "date", label: "Date", cell: (row) => weekdayDayLabel(row.date), total: "Total" },
    { key: "count", label: "Expenses", align: "right", cell: (row) => row.count, total: r?.count },
    { key: "amount", label: "Amount", align: "right", strong: true, cell: (row) => inrPaise(row.totalPaise), total: r ? inrPaise(r.totalPaise) : "" },
  ];
  const modeColumns: ReportTableColumn<ExpenseModeTotal>[] = [
    { key: "mode", label: "Paid by", cell: (row) => EXPENSE_PAYMENT_MODE_LABELS[row.mode], total: "Total" },
    { key: "count", label: "Expenses", align: "right", cell: (row) => row.count, total: r?.count },
    { key: "amount", label: "Amount", align: "right", strong: true, cell: (row) => inrPaise(row.totalPaise), total: r ? inrPaise(r.totalPaise) : "" },
  ];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Expenses"
        description="Where the money went, and what is left from sales"
        compareCaption={compareCaption}
        onDownload={() => void handleDownload()}
        downloadDisabled={!r || !categories.data || downloading}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Total spent"
          value={inrPaise(r?.totalPaise ?? 0)}
          sub={r ? `${r.count} ${r.count === 1 ? "expense" : "expenses"}` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Sales"
          value={salesRupees === undefined ? NO_FIGURE : inr(salesRupees)}
          sub={salesRupees === undefined && sales.isError ? "Couldn't load sales" : "Net sales in this period"}
          loading={salesLoading}
          updating={updating}
        />
        <StatCard
          label="Sales − expenses"
          value={left === undefined ? NO_FIGURE : inrPaise(left)}
          sub={ROUGH_GUIDE}
          loading={loading || salesLoading}
          updating={updating}
        />
        <StatCard
          label="Biggest category"
          value={biggest ? inrPaise(biggest.totalPaise) : NO_FIGURE}
          sub={r ? (biggest ? `${biggest.name} · ${shareLabel(biggest.totalPaise, r.totalPaise)}` : "Nothing spent yet") : undefined}
          loading={loading}
          updating={updating}
        />
      </div>

      <DashCard
        title="By category"
        period={r ? `${r.count} ${r.count === 1 ? "expense" : "expenses"} in this period` : undefined}
        status={r && r.byCategory.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No expenses in this period", description: "Expenses you add on the Expenses page show up here." }}
        bodyMinHeight={240}
      >
        {r && <ExpenseCategoryBars rows={r.byCategory} totalPaise={r.totalPaise} />}
      </DashCard>

      {/* Rendered only once the data is in, so nothing below the first card gets shoved down as it grows. */}
      {r && r.byDay.length > 0 && (
        <DashCard title="By day" period="Only days with an expense" status="ready" updating={updating} bodyMinHeight={240}>
          <ReportTable<ExpenseDayTotal>
            columns={dayColumns}
            rows={r.byDay}
            rowKey={(row) => row.date}
            phoneCard={{
              title: (row) => weekdayDayLabel(row.date),
              value: (row) => inrPaise(row.totalPaise),
              lines: (row) => [<span key="n">{row.count} {row.count === 1 ? "expense" : "expenses"}</span>],
            }}
            totalCard={{
              title: "Total",
              value: inrPaise(r.totalPaise),
              lines: [<span key="n">{r.count} {r.count === 1 ? "expense" : "expenses"}</span>],
            }}
            emptyTitle="No expenses in this period"
            emptyDescription="Expenses you add on the Expenses page show up here."
          />
        </DashCard>
      )}

      {r && r.byMode.length > 0 && (
        <DashCard title="By payment mode" period="How the money was paid out" status="ready" updating={updating} bodyMinHeight={160}>
          <ReportTable<ExpenseModeTotal>
            columns={modeColumns}
            rows={r.byMode}
            rowKey={(row) => row.mode}
            phoneCard={{
              title: (row) => EXPENSE_PAYMENT_MODE_LABELS[row.mode],
              value: (row) => inrPaise(row.totalPaise),
              lines: (row) => [<span key="n">{row.count} {row.count === 1 ? "expense" : "expenses"}</span>],
            }}
            emptyTitle="No expenses in this period"
            emptyDescription="Expenses you add on the Expenses page show up here."
          />
        </DashCard>
      )}
    </>
  );
}
