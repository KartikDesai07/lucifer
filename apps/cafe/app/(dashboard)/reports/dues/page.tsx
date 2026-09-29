"use client";

import { useState } from "react";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { duesCsvRows } from "@/lib/reports/csv";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useDuesReport } from "@/hooks/use-reports";
import { DashCard } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatCard } from "@/components/reports/StatCard";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { ReceivePaymentDialog } from "@/components/customers/ReceivePaymentDialog";
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { OutstandingDueRow, DuesReceiptRow } from "@/types/reports";

const DATETIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CAFE_TIMEZONE,
});

// Customer dues (Batch 1's third report): who owes right now (LIVE, not
// ranged), and what came in during the picked period. "Receive payment" is
// the existing ReceivePaymentDialog — recording invalidates REPORT_KEYS.all
// already (hooks/use-customers.ts), so this page needs no invalidation of
// its own.
export default function DuesReportPage() {
  const { range, restored } = useReportRange();
  const report = useDuesReport(range, restored);
  const r = report.data;
  const loading = !r;
  // keepPreviousData: while a newly picked period loads, the previous numbers
  // stay up — dimmed, and labelled with THEIR period (never a blank flash).
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [receiving, setReceiving] = useState<{ _id: string; name: string; totalDue: number } | null>(null);
  // ReceivePaymentDialog's own DueCustomer shape keys on `_id`; the report's
  // OutstandingDueRow (a plain aggregate row, not a Customer document) keys
  // on `customerId` — same identity, different field name.
  const openReceive = (row: OutstandingDueRow) => setReceiving({ _id: row.customerId, name: row.name, totalDue: row.totalDue });

  const compareCaption = r ? `for ${range.from === range.to ? "this day" : "this period"}` : "";
  const change = r ? r.creditGiven.total - r.collected.total : 0;

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(duesCsvRows(r), `dues-${r.range.from}-to-${r.range.to}`);
  };

  const outstandingColumns: ReportTableColumn<OutstandingDueRow>[] = [
    { key: "name", label: "Customer", cell: (row) => row.name, total: "Total" },
    { key: "mobile", label: "Mobile", cell: (row) => row.mobile },
    { key: "due", label: "Due", align: "right", strong: true, cell: (row) => inr(row.totalDue), total: r ? inr(r.outstanding.total) : "" },
    {
      key: "action",
      label: "",
      align: "right",
      cell: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openReceive(row);
          }}
          aria-label={`Receive payment from ${row.name}`}
          className="rounded-md border border-brand-rule px-2.5 py-1 text-[12.5px] font-medium text-brand-ink hover:bg-brand-wash"
        >
          Receive payment
        </button>
      ),
    },
  ];

  const receiptColumns: ReportTableColumn<DuesReceiptRow>[] = [
    { key: "at", label: "Date & time", cell: (row) => DATETIME_FORMAT.format(new Date(row.at)), total: "Total" },
    { key: "customer", label: "Customer", cell: (row) => row.customerName || "—" },
    { key: "mode", label: "Mode", cell: (row) => row.mode },
    { key: "by", label: "Received by", cell: (row) => row.receivedBy },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      strong: true,
      cell: (row) => inr(row.amount),
      total: r ? inr(r.collected.total) : "",
    },
  ];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Customer dues"
        description="Who owes you, and what came in"
        compareCaption={compareCaption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Outstanding now"
          value={inr(r?.outstanding.total ?? 0)}
          sub={r ? `${r.outstanding.customers} customers · live, not limited by the dates` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Received in this period"
          value={inr(r?.collected.total ?? 0)}
          sub={r ? `${inr(r.collected.cash)} cash + ${inr(r.collected.online)} online` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Credit given in this period"
          value={inr(r?.creditGiven.total ?? 0)}
          sub={r ? `on ${r.creditGiven.orders} bills` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Change"
          value={inr(Math.abs(change))}
          sub={change === 0 ? "No change" : `Dues went ${change > 0 ? "up" : "down"} by ${inr(Math.abs(change))}`}
          loading={loading}
          updating={updating}
        />
      </div>

      <DashCard
        title="Outstanding now"
        period={r ? `${r.outstanding.customers} customers owe money right now` : undefined}
        status={r && r.outstanding.rows.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No outstanding dues", description: "All customers are settled up." }}
        bodyMinHeight={240}
      >
        {r && (
          <>
            <ReportTable<OutstandingDueRow>
              columns={outstandingColumns}
              rows={r.outstanding.rows}
              rowKey={(row) => row.customerId}
              // The phone card itself opens Receive payment (there is no room
              // for a separate action button on a 360px card) — its own
              // "Details for …" label is overridden per row below.
              onRowClick={(row) => openReceive(row)}
              hideChevron
              phoneCard={{
                title: (row) => row.name,
                value: (row) => inr(row.totalDue),
                lines: (row) => [<span key="m">{row.mobile}</span>, <span key="a">· tap to receive payment</span>],
              }}
              emptyTitle="No outstanding dues"
              emptyDescription="All customers are settled up."
            />
            {r.outstanding.truncated && (
              <p className="mt-2 text-[12px] text-brand-muted">Showing the largest balances — not every customer with a due is listed.</p>
            )}
          </>
        )}
      </DashCard>

      {/* Rendered only once the data is in: as a skeleton below the first table it
          would be shoved down by however many rows that table grows to (measured
          CLS 0.22-0.37); landing together, nothing on screen moves. */}
      {r && (
        <DashCard
          title="Received in this period"
          period={r ? `${r.collected.count} payments` : undefined}
          status={r && r.collected.rows.length === 0 ? "empty" : cardStatus}
          updating={updating}
          empty={{ title: "No dues received in this period", description: "Payments against outstanding balances show here." }}
          bodyMinHeight={240}
        >
          {r && (
            <>
              <ReportTable<DuesReceiptRow>
                columns={receiptColumns}
                rows={r.collected.rows}
                rowKey={(row) => row.id}
                phoneCard={{
                  title: (row) => row.customerName || "—",
                  value: (row) => inr(row.amount),
                  lines: (row) => [
                    <span key="d">{DATETIME_FORMAT.format(new Date(row.at))}</span>,
                    <span key="m">· {row.mode}</span>,
                    <span key="b">· by {row.receivedBy}</span>,
                  ],
                }}
                emptyTitle="No dues received in this period"
                emptyDescription="Payments against outstanding balances show here."
              />
              {r.collected.truncated && <p className="mt-2 text-[12px] text-brand-muted">Showing the most recent receipts in this period.</p>}
            </>
          )}
        </DashCard>
      )}

      <ReceivePaymentDialog customer={receiving} onOpenChange={(open) => !open && setReceiving(null)} />
    </>
  );
}
