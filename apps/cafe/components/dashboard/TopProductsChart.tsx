"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ProductStat } from "@/types";
import { inr } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

interface TopProductsChartProps {
  data: ProductStat[];
  limit?: number;
}

// Tailwind primary-ish palette cycled across bars for visual separation.
const BAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#ef4444",
  "#84cc16",
  "#a855f7",
];

// Horizontal bar chart of top products by revenue. Reused by dashboard (today)
// and reports (date range). 'use client' — recharts needs DOM.
export function TopProductsChart({ data, limit = 8 }: TopProductsChartProps) {
  const rows = data.slice(0, limit);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No sales yet"
        description="Top-selling products will appear here."
        className="h-[260px] justify-center"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 34)}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "transparent" }}
          formatter={(value: number) => [inr(value), "Revenue"]}
        />
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((row, i) => (
            <Cell key={row.name} fill={BAR_COLORS[i % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
