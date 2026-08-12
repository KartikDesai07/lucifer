"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { inr } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

interface SalesByDayChartProps {
  data: { date: string; sales: number; orders: number }[];
}

// Compact axis labels: "2026-06-20" -> "20 Jun".
function shortDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// Line chart of daily sales across the selected range (reports page).
export function SalesByDayChart({ data }: SalesByDayChartProps) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="No sales in this range"
        description="Pick a different date range to see daily sales."
        className="h-[300px] justify-center"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDay}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={(v: number) => inr(v)}
        />
        <Tooltip
          labelFormatter={(label) => shortDay(label as string)}
          formatter={(value: number, name) =>
            name === "sales"
              ? [inr(value), "Sales"]
              : [value, "Orders"]
          }
        />
        <Line
          type="monotone"
          dataKey="sales"
          stroke="#6366f1"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
