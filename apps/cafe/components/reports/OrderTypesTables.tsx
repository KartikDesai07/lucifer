import { inr } from "@/lib/utils";
import { sharePercent } from "@/lib/dashboard/format";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import type { DashboardChannel } from "@/types/dashboard";
import type { OrderTypeRow, HourRow } from "@/types/reports-b3";

// The Order types & busy hours page's two tables — split out to keep the page
// file under the line budget, same idiom as ItemsTables.tsx. Tapping a type
// row filters the hours table + chart below (the page owns that state);
// tapping an hour row opens HourSheet.

interface OrderTypesTableProps {
  types: readonly OrderTypeRow[];
  loading: boolean;
  selectedKey: DashboardChannel | null;
  onSelect: (key: DashboardChannel) => void;
  totalOrders: number;
  totalSales: number;
  totalAverageOrder: number;
}

export function OrderTypesTable({ types, loading, selectedKey, onSelect, totalOrders, totalSales, totalAverageOrder }: OrderTypesTableProps) {
  const columns: ReportTableColumn<OrderTypeRow>[] = [
    { key: "type", label: "Type", cell: (row) => row.label, total: "Total" },
    { key: "orders", label: "Orders", align: "right", cell: (row) => row.orders, total: totalOrders },
    { key: "sales", label: "Sales", align: "right", strong: true, cell: (row) => inr(row.sales), total: inr(totalSales) },
    { key: "avg", label: "Avg order", align: "right", cell: (row) => inr(row.averageOrder), total: inr(totalAverageOrder) },
    { key: "share", label: "Share %", align: "right", cell: (row) => sharePercent(row.share), total: "100%" },
  ];

  return (
    <ReportTable<OrderTypeRow>
      columns={columns}
      rows={types}
      rowKey={(row) => row.key}
      onRowClick={(row) => onSelect(row.key)}
      actionLabel={(row) => `Show only ${row.label}`}
      selectedKey={selectedKey}
      loading={loading}
      phoneCard={{
        title: (row) => row.label,
        value: (row) => inr(row.sales),
        lines: (row) => [
          <span key="o">{row.orders} orders</span>,
          <span key="a">· {inr(row.averageOrder)} avg</span>,
          <span key="s">· {sharePercent(row.share)} of sales</span>,
        ],
      }}
      emptyTitle="No order types in this period"
      emptyDescription="Pick another period to see order type sales."
    />
  );
}

interface HoursTableProps {
  hours: readonly HourRow[];
  loading: boolean;
  /** When set, every row's figures come from that type's slice (byType). */
  type: DashboardChannel | null;
  totalLabel?: string;
  totalOrders: number;
  totalSales: number;
  totalAverageOrder: number;
  onRowClick: (row: HourRow) => void;
}

export function HoursTable({ hours, loading, type, totalLabel, totalOrders, totalSales, totalAverageOrder, onRowClick }: HoursTableProps) {
  const figuresOf = (row: HourRow) => (type ? row.byType[type] : row);

  const columns: ReportTableColumn<HourRow>[] = [
    { key: "hour", label: "Hour", cell: (row) => row.span, total: "Total" },
    { key: "orders", label: "Orders", align: "right", cell: (row) => figuresOf(row).orders, total: totalOrders },
    {
      key: "shareOfOrders",
      label: "% of orders",
      align: "right",
      cell: (row) => sharePercent(totalOrders > 0 ? figuresOf(row).orders / totalOrders : 0),
      total: "100%",
    },
    { key: "sales", label: "Sales", align: "right", strong: true, cell: (row) => inr(figuresOf(row).sales), total: inr(totalSales) },
    {
      key: "avg",
      label: "Avg order",
      align: "right",
      cell: (row) => inr(figuresOf(row).orders > 0 ? figuresOf(row).sales / figuresOf(row).orders : 0),
      total: inr(totalAverageOrder),
    },
  ];

  return (
    <ReportTable<HourRow>
      columns={columns}
      rows={hours}
      rowKey={(row) => String(row.hour)}
      onRowClick={onRowClick}
      actionLabel={(row) => `Details for ${row.span}`}
      totalLabel={totalLabel}
      loading={loading}
      phoneCard={{
        title: (row) => row.span,
        value: (row) => inr(figuresOf(row).sales),
        lines: (row) => [
          <span key="o">{figuresOf(row).orders} orders</span>,
          <span key="p">· {sharePercent(totalOrders > 0 ? figuresOf(row).orders / totalOrders : 0)} of orders</span>,
        ],
      }}
      emptyTitle="No orders in this period"
      emptyDescription="Pick another period to see busy hours."
    />
  );
}

/** The "Showing <label> · Show all" chip, same idiom as the Items page's category filter. */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-brand-muted">
      <span>
        Showing <span className="font-medium text-brand-ink">{label}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-brand-rule px-2 py-0.5 font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        Show all
      </button>
    </div>
  );
}
