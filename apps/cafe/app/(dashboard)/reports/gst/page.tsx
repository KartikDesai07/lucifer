"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { gstDayCsvRows, gstBillCsvRows } from "@/lib/reports/csv-b2";
import { formatHalfGst, gstRateLabel } from "@/lib/reports/gst-display";
import { dayLabel, weekdayDayLabel } from "@/lib/dashboard/range";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useGstReport, fetchGstBills } from "@/hooks/use-reports";
import { StatCard } from "@/components/reports/StatCard";
import { DashCard } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { TallyCard } from "@/components/reports/TallyCard";
import { DaySheet } from "@/components/reports/DaySheet";
import type { GstDayRow, GstRateRow } from "@/types/reports";

const RATE_ROW_KEY_NO_GST = "no-gst";
const RATE_ROW_KEY_CHARGES = "charges";
const GST_TALLY_RESERVE_LINES = 4;
const BILL_CSV_FAIL_MESSAGE = "Couldn't build the bill-wise CSV. Please try again.";

interface RateDisplayRow {
  key: string;
  label: string;
  bills: number | null;
  taxable: number | null;
  gst: number | null;
  value: number;
}

export default function GstReportPage() {
  const { range, restored } = useReportRange();
  const report = useGstReport(range, restored);
  const r = report.data;
  const loading = !r;
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();
  const queryClient = useQueryClient();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [billsPending, setBillsPending] = useState(false);

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(gstDayCsvRows(r), `gst-${r.range.from}-to-${r.range.to}`);
  };

  const handleBillsDownload = async () => {
    if (!r) return;
    setBillsPending(true);
    try {
      const rows = await fetchGstBills(queryClient, r.range);
      exportToCSV(gstBillCsvRows(rows), `gst-bills-${r.range.from}-to-${r.range.to}`);
    } catch {
      toast.error(BILL_CSV_FAIL_MESSAGE);
    } finally {
      setBillsPending(false);
    }
  };

  const rateRows: RateDisplayRow[] = r
    ? [
        ...r.rates.map((rate: GstRateRow) => ({
          key: String(rate.rate),
          label: `${rate.rate}%`,
          bills: rate.bills,
          taxable: rate.taxable,
          gst: rate.gst,
          value: rate.value,
        })),
        ...(r.noGst > 0 ? [{ key: RATE_ROW_KEY_NO_GST, label: "No GST", bills: r.noGstBills, taxable: null, gst: null, value: r.noGst }] : []),
        ...(r.charges > 0 ? [{ key: RATE_ROW_KEY_CHARGES, label: "Charges (no GST)", bills: null, taxable: null, gst: null, value: r.charges }] : []),
      ]
    : [];

  const rateColumns: ReportTableColumn<RateDisplayRow>[] = [
    { key: "rate", label: "Rate", cell: (row) => row.label, total: "Total" },
    { key: "bills", label: "Bills", align: "right", cell: (row) => row.bills ?? "—", total: r?.bills ?? 0 },
    { key: "taxable", label: "Taxable value", align: "right", cell: (row) => (row.taxable !== null ? inr(row.taxable) : "—"), total: inr(r?.taxable ?? 0) },
    { key: "cgst", label: "CGST", align: "right", cell: (row) => (row.gst !== null ? formatHalfGst(row.gst) : "—"), total: formatHalfGst(r?.gst ?? 0) },
    { key: "sgst", label: "SGST", align: "right", cell: (row) => (row.gst !== null ? formatHalfGst(row.gst) : "—"), total: formatHalfGst(r?.gst ?? 0) },
    { key: "gst", label: "Total GST", align: "right", cell: (row) => (row.gst !== null ? inr(row.gst) : "—"), total: inr(r?.gst ?? 0) },
    { key: "value", label: "Value", align: "right", strong: true, cell: (row) => inr(row.value), total: inr(r?.netSales ?? 0) },
  ];

  const dayColumns: ReportTableColumn<GstDayRow>[] = [
    { key: "day", label: "Day", cell: (row) => dayLabel(row.date), total: "Total" },
    { key: "bills", label: "Bills", align: "right", cell: (row) => row.bills, total: r?.bills ?? 0 },
    {
      key: "numbers",
      label: "Bill numbers",
      align: "right",
      cell: (row) => (row.docs.first !== null && row.docs.last !== null ? `#${row.docs.first} – #${row.docs.last}` : "—"),
    },
    { key: "taxable", label: "Taxable value", align: "right", cell: (row) => inr(row.taxable), total: inr(r?.taxable ?? 0) },
    { key: "cgst", label: "CGST", align: "right", cell: (row) => formatHalfGst(row.gst), total: formatHalfGst(r?.gst ?? 0) },
    { key: "sgst", label: "SGST", align: "right", cell: (row) => formatHalfGst(row.gst), total: formatHalfGst(r?.gst ?? 0) },
    { key: "value", label: "Bill value", align: "right", strong: true, cell: (row) => inr(row.value), total: inr(r?.netSales ?? 0) },
  ];

  const netIssued = r ? r.docs.numbered - r.docs.cancelled : 0;

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="GST"
        description="Tax on your bills, ready for your CA"
        compareCaption={r ? "Completed bills · GST as printed on each bill" : ""}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Taxable value" value={inr(r?.taxable ?? 0)} sub="food & drinks before GST" loading={loading} updating={updating} />
        <StatCard
          label={r ? gstRateLabel(r.rates, true) : "CGST"}
          value={formatHalfGst(r?.gst ?? 0)}
          sub="half of the GST"
          loading={loading}
          updating={updating}
        />
        <StatCard
          label={r ? gstRateLabel(r.rates, false) : "SGST"}
          value={formatHalfGst(r?.gst ?? 0)}
          sub="half of the GST"
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Bills"
          value={String(r?.bills ?? 0)}
          sub={
            r
              ? `${r.docs.cancelled} cancelled after billing${r.docs.unnumbered > 0 ? ` · ${r.docs.unnumbered} without a number` : ""}`
              : undefined
          }
          loading={loading}
          updating={updating}
        />
      </div>

      <TallyCard
        title="How it adds up"
        period="Every number here matches the table and the CSV"
        lines={
          r
            ? [
                { label: "Taxable value", amount: r.taxable },
                { label: "GST", amount: r.gst, sign: "+" },
                ...(r.noGst > 0 ? [{ label: "Bills without GST", amount: r.noGst, sign: "+" as const }] : []),
                ...(r.charges > 0 ? [{ label: "Charges (no GST)", amount: r.charges, sign: "+" as const }] : []),
                { label: "Net sales", amount: r.netSales, tone: "total" as const },
              ]
            : []
        }
        check={{
          label: "Taxable + GST + no-GST + charges = net sales",
          parts: r ? [r.taxable, r.gst, r.noGst, r.charges] : [],
          total: r?.netSales ?? 0,
        }}
        status={cardStatus}
        onRetry={retry}
        updating={updating}
        reserveLines={GST_TALLY_RESERVE_LINES}
      />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3 2xl:items-start">
        <DashCard className="2xl:col-span-2" title="By GST rate" status={r && rateRows.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No GST in this period", description: "GST by rate shows here." }} bodyMinHeight={200}>
          {r && (
            <ReportTable<RateDisplayRow>
              columns={rateColumns}
              rows={rateRows}
              rowKey={(row) => row.key}
              loading={false}
              phoneCard={{
                title: (row) => row.label,
                value: (row) => inr(row.value),
                lines: (row) => [
                  ...(row.bills !== null ? [<span key="b">{row.bills} bills</span>] : []),
                  ...(row.taxable !== null ? [<span key="t">· taxable {inr(row.taxable)}</span>] : []),
                  ...(row.gst !== null ? [<span key="g">· GST {inr(row.gst)}</span>] : []),
                ],
              }}
              emptyTitle="No GST in this period"
              emptyDescription="GST by rate shows here."
            />
          )}
        </DashCard>

        <DashCard title="Documents issued" period="For GSTR-1 Table 13" status={cardStatus} onRetry={retry} updating={updating} bodyMinHeight={220}>
          {r && (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col divide-y divide-brand-rule/70 text-[13.5px]">
                <DocsRow label="Bill numbers issued" value={String(r.docs.numbered)} />
                <DocsRow label="Cancelled after billing" value={String(r.docs.cancelled)} />
                <DocsRow label="Net issued" value={String(netIssued)} strong />
                {r.docs.unnumbered > 0 && <DocsRow label="Bills without a number" value={String(r.docs.unnumbered)} />}
              </dl>
              <p className="text-[12px] text-brand-muted">
                Bill numbers restart every day — each day&apos;s first and last number is in the table below.
              </p>
              <button
                type="button"
                onClick={() => void handleBillsDownload()}
                disabled={billsPending}
                className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-brand-rule bg-brand-slip px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {billsPending ? "Preparing…" : "Download bill-wise CSV"}
              </button>
            </div>
          )}
        </DashCard>
      </div>

      <DashCard title="Day by day" period="Tap a day for its full details" status={r && r.days.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No GST in this period", description: "Pick another period to see day-by-day GST." }} bodyMinHeight={240}>
        {r && (
          <ReportTable<GstDayRow>
            columns={dayColumns}
            rows={r.days}
            rowKey={(row) => row.date}
            onRowClick={(row) => setOpenDay(row.date)}
            actionLabel={(row) => `Details for ${weekdayDayLabel(row.date)}`}
            selectedKey={openDay}
            loading={false}
            phoneCard={{
              title: (row) => dayLabel(row.date),
              value: (row) => inr(row.value),
              lines: (row) => [
                <span key="b">{row.bills} bills</span>,
                <span key="t">· taxable {inr(row.taxable)}</span>,
                <span key="g">· GST {inr(row.gst)}</span>,
              ],
            }}
            emptyTitle="No GST in this period"
            emptyDescription="Pick another period to see day-by-day GST."
          />
        )}
      </DashCard>

      <DaySheet day={openDay} onOpenChange={(open) => !open && setOpenDay(null)} />
    </>
  );
}

function DocsRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${strong ? "font-semibold text-brand-ink" : "text-brand-ink"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
