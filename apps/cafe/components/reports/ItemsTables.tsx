import { inr } from "@/lib/utils";
import { sharePercent } from "@/lib/dashboard/format";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import type { CategorySalesRow, ItemSalesRow } from "@/types/reports";

// The Items & categories page's two tables — split out to keep the page file
// under the line budget. Tapping a category row filters the items table (the
// page owns that state); tapping an item row opens ItemSheet.

interface CategoriesTableProps {
  categories: readonly CategorySalesRow[];
  loading: boolean;
  selected: string | null;
  onSelect: (key: string) => void;
}

export function CategoriesTable({ categories, loading, selected, onSelect }: CategoriesTableProps) {
  const totalItems = categories.reduce((s, c) => s + c.items, 0);
  const totalQty = categories.reduce((s, c) => s + c.qty, 0);
  const totalSales = categories.reduce((s, c) => s + c.sales, 0);

  const columns: ReportTableColumn<CategorySalesRow>[] = [
    { key: "category", label: "Category", cell: (row) => row.label, total: "Total" },
    { key: "items", label: "Items", align: "right", cell: (row) => row.items, total: totalItems },
    { key: "qty", label: "Qty", align: "right", cell: (row) => row.qty, total: totalQty },
    { key: "sales", label: "Sales", align: "right", strong: true, cell: (row) => inr(row.sales), total: inr(totalSales) },
    { key: "share", label: "Share %", align: "right", cell: (row) => sharePercent(row.share), total: "100%" },
  ];

  return (
    <ReportTable<CategorySalesRow>
      columns={columns}
      rows={categories}
      rowKey={(row) => row.key}
      onRowClick={(row) => onSelect(row.key)}
      actionLabel={(row) => `Show only ${row.label}`}
      selectedKey={selected}
      loading={loading}
      phoneCard={{
        title: (row) => row.label,
        value: (row) => inr(row.sales),
        lines: (row) => [
          <span key="i">{row.items} items</span>,
          <span key="q">· {row.qty} sold</span>,
          <span key="s">· {sharePercent(row.share)} of sales</span>,
        ],
      }}
      emptyTitle="No categories in this period"
      emptyDescription="Pick another period to see category sales."
    />
  );
}

interface ItemsTableProps {
  items: readonly ItemSalesRow[];
  loading: boolean;
  showFree: boolean;
  totalSales: number;
  totalQty: number;
  /** Footer label — names the category when the table is filtered. */
  totalLabel?: string;
  onRowClick: (row: ItemSalesRow) => void;
}

export function ItemsTable({ items, loading, showFree, totalSales, totalQty, totalLabel, onRowClick }: ItemsTableProps) {
  const totalFree = items.reduce((s, i) => s + i.freeQty, 0);

  const columns: ReportTableColumn<ItemSalesRow>[] = [
    { key: "item", label: "Item", wrap: true, cell: (row) => row.label, total: "Total" },
    { key: "category", label: "Category", wrap: true, cell: (row) => row.categoryName },
    { key: "qty", label: "Qty", align: "right", cell: (row) => row.qty, total: totalQty },
    ...(showFree
      ? [{ key: "free", label: "Free", align: "right" as const, cell: (row: ItemSalesRow) => row.freeQty, total: totalFree }]
      : []),
    { key: "sales", label: "Sales", align: "right", strong: true, cell: (row) => inr(row.sales), total: inr(totalSales) },
    { key: "share", label: "Share %", align: "right", cell: (row) => sharePercent(row.share), total: "100%" },
  ];

  return (
    <ReportTable<ItemSalesRow>
      columns={columns}
      rows={items}
      rowKey={(row) => row.key}
      onRowClick={onRowClick}
      actionLabel={(row) => `Details for ${row.label}`}
      totalLabel={totalLabel}
      loading={loading}
      phoneCard={{
        title: (row) => row.label,
        value: (row) => inr(row.sales),
        lines: (row) => [
          <span key="c">{row.categoryName}</span>,
          <span key="q">· {row.qty} sold</span>,
          ...(row.freeQty > 0 ? [<span key="f">· {row.freeQty} free</span>] : []),
          <span key="s">· {sharePercent(row.share)}</span>,
        ],
      }}
      emptyTitle="No items in this period"
      emptyDescription="Pick another period to see item sales."
    />
  );
}
