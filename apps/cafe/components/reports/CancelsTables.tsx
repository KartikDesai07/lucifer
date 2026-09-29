import { CAFE_TIMEZONE } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import type { CancelledBillRow, DiscountRow, DiscountRowKind, RemovedItemRow, StaffLeakRow } from "@/types/reports";

// The Cancel & discounts page's list tables — split out to keep the page file
// under the line budget. Every table is read-only here; the page owns the
// CancelDaySheet / CSV download. The three list tables' footer Totals come
// from the report's OWN totals (uncapped), never from the listed rows — the
// rows can be capped (truncated), the totals never are.

const DATETIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CAFE_TIMEZONE,
});

const KIND_LABEL: Record<DiscountRowKind, string> = {
  manual: "Manual",
  gst: "GST discount",
  reward: "Reward",
};

export function StaffLeakTable({ rows, loading }: { rows: readonly StaffLeakRow[]; loading: boolean }) {
  const totals = rows.reduce(
    (acc, r) => ({
      cancelled: acc.cancelled + r.cancelled.value,
      removed: acc.removed + r.removed.value,
      discounts: acc.discounts + r.discounts.amount,
    }),
    { cancelled: 0, removed: 0, discounts: 0 },
  );
  const total = totals.cancelled + totals.removed + totals.discounts;

  const columns: ReportTableColumn<StaffLeakRow>[] = [
    { key: "name", label: "Staff", cell: (row) => row.name || "Not recorded", total: "Total" },
    { key: "cancelled", label: "Cancelled", align: "right", cell: (row) => `${row.cancelled.count} · ${inr(row.cancelled.value)}`, total: inr(totals.cancelled) },
    { key: "removed", label: "Items removed", align: "right", cell: (row) => `${row.removed.lines} · ${inr(row.removed.value)}`, total: inr(totals.removed) },
    { key: "discounts", label: "Discounts", align: "right", cell: (row) => `${row.discounts.orders} · ${inr(row.discounts.amount)}`, total: inr(totals.discounts) },
    {
      key: "total",
      label: "Total",
      align: "right",
      strong: true,
      cell: (row) => inr(row.cancelled.value + row.removed.value + row.discounts.amount),
      total: inr(total),
    },
  ];

  return (
    <ReportTable<StaffLeakRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.name || "not-recorded"}
      loading={loading}
      phoneCard={{
        title: (row) => row.name || "Not recorded",
        value: (row) => inr(row.cancelled.value + row.removed.value + row.discounts.amount),
        lines: (row) => [
          <span key="c">Cancelled {row.cancelled.count} · {inr(row.cancelled.value)}</span>,
          <span key="r">· Removed {row.removed.lines} · {inr(row.removed.value)}</span>,
          <span key="d">· Discounts {row.discounts.orders} · {inr(row.discounts.amount)}</span>,
        ],
      }}
      emptyTitle="No staff activity in this period"
      emptyDescription="Cancels, removals and discounts by staff show here."
    />
  );
}

interface ListTableProps<Row, Total> {
  rows: readonly Row[];
  loading: boolean;
  onRowClick: (row: Row) => void;
  total: Total;
}

export function CancelledBillsTable({ rows, loading, onRowClick, total }: ListTableProps<CancelledBillRow, { count: number; value: number }>) {
  const totalLabel = `Total · ${plural(total.count, "bill")}`;
  const columns: ReportTableColumn<CancelledBillRow>[] = [
    { key: "at", label: "When", cell: (row) => DATETIME_FORMAT.format(new Date(row.at)) },
    { key: "bill", label: "Bill", cell: (row) => (row.billNumber !== undefined ? `Bill #${row.billNumber}` : row.orderId) },
    { key: "amount", label: "Amount", align: "right", strong: true, cell: (row) => inr(row.value), total: inr(total.value) },
    { key: "paid", label: "Paid", align: "right", cell: (row) => inr(row.paid) },
    { key: "by", label: "By", cell: (row) => row.by || "—" },
    { key: "reason", label: "Reason", wrap: true, cell: (row) => row.reason || "—" },
  ];
  return (
    <ReportTable<CancelledBillRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onRowClick}
      totalLabel={totalLabel}
      totalCard={{ title: totalLabel, value: inr(total.value) }}
      actionLabel={(row) => `Open ${DATETIME_FORMAT.format(new Date(row.at))}`}
      loading={loading}
      phoneCard={{
        title: (row) => (row.billNumber !== undefined ? `Bill #${row.billNumber}` : row.orderId),
        value: (row) => inr(row.value),
        lines: (row) => [
          <span key="w">{DATETIME_FORMAT.format(new Date(row.at))}</span>,
          <span key="b">· by {row.by || "—"}</span>,
          <span key="r">· {row.reason || "—"}</span>,
        ],
      }}
      emptyTitle="No cancelled bills in this period"
      emptyDescription="Cancelled bills show here."
    />
  );
}

export function RemovedItemsTable({ rows, loading, onRowClick, total }: ListTableProps<RemovedItemRow, { qty: number; value: number }>) {
  const totalLabel = `Total · ${plural(total.qty, "item")}`;
  const columns: ReportTableColumn<RemovedItemRow>[] = [
    { key: "at", label: "When", cell: (row) => DATETIME_FORMAT.format(new Date(row.at)) },
    { key: "item", label: "Item", wrap: true, cell: (row) => row.item },
    { key: "qty", label: "Qty", align: "right", cell: (row) => row.qty, total: total.qty },
    { key: "amount", label: "Amount", align: "right", strong: true, cell: (row) => inr(row.value), total: inr(total.value) },
    { key: "by", label: "By", cell: (row) => row.by || "—" },
    { key: "reason", label: "Reason", wrap: true, cell: (row) => row.reason || "—" },
  ];
  return (
    <ReportTable<RemovedItemRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.orderId}-${row.at}-${row.item}`}
      onRowClick={onRowClick}
      totalLabel={totalLabel}
      totalCard={{ title: totalLabel, value: inr(total.value) }}
      actionLabel={(row) => `Open ${row.item}`}
      loading={loading}
      phoneCard={{
        title: (row) => row.item,
        value: (row) => inr(row.value),
        lines: (row) => [
          <span key="w">{DATETIME_FORMAT.format(new Date(row.at))}</span>,
          <span key="q">· {row.qty} removed</span>,
          <span key="b">· by {row.by || "—"}</span>,
        ],
      }}
      emptyTitle="No items removed in this period"
      emptyDescription="Voided items show here."
    />
  );
}

export function DiscountsTable({ rows, loading, onRowClick, total }: ListTableProps<DiscountRow, { rows: number; amount: number }>) {
  const totalLabel = `Total · ${plural(total.rows, "bill")}`;
  const columns: ReportTableColumn<DiscountRow>[] = [
    { key: "at", label: "When", cell: (row) => DATETIME_FORMAT.format(new Date(row.at)) },
    { key: "bill", label: "Bill", cell: (row) => (row.billNumber !== undefined ? `Bill #${row.billNumber}` : row.orderId) },
    { key: "kind", label: "Type", cell: (row) => KIND_LABEL[row.kind] },
    { key: "amount", label: "Amount", align: "right", strong: true, cell: (row) => inr(row.amount), total: inr(total.amount) },
    { key: "billTotal", label: "Bill total", align: "right", cell: (row) => inr(row.billTotal) },
    { key: "by", label: "Taken by", cell: (row) => row.by || "—" },
  ];
  return (
    <ReportTable<DiscountRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.orderId}-${row.at}-${row.kind}`}
      onRowClick={onRowClick}
      totalLabel={totalLabel}
      totalCard={{ title: totalLabel, value: inr(total.amount) }}
      actionLabel={(row) => `Open ${row.billNumber !== undefined ? `bill #${row.billNumber}` : row.orderId}`}
      loading={loading}
      phoneCard={{
        title: (row) => (row.billNumber !== undefined ? `Bill #${row.billNumber}` : row.orderId),
        value: (row) => inr(row.amount),
        lines: (row) => [
          <span key="k">{KIND_LABEL[row.kind]}</span>,
          <span key="w">· {DATETIME_FORMAT.format(new Date(row.at))}</span>,
          <span key="b">· by {row.by || "—"}</span>,
        ],
      }}
      emptyTitle="No discounts or rewards in this period"
      emptyDescription="Manual discounts, GST discounts and rewards show here."
    />
  );
}
