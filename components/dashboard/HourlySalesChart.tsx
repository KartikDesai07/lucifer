"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HourlyStat } from "@/types";
import { inr } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

interface HourlySalesChartProps {
  data: HourlyStat[];
}

// 14 -> "2 PM", 0 -> "12 AM" — compact axis/tooltip label for a clock hour.
function formatHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 || 12;
  return `${h12} ${period}`;
}

// Bar chart of today's completed-order sales per cafe-local hour (peak-hours
// view). 'use client' — recharts needs the DOM; loaded dynamically by the page.
export function HourlySalesChart({ data }: HourlySalesChartProps) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="No sales yet today"
        description="Hourly sales will appear here as orders are completed."
        className="h-[260px] justify-center"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="hour"
          tickFormatter={formatHour}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={8}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={(v: number) => inr(v)}
        />
        <Tooltip
          cursor={{ fill: "transparent" }}
          labelFormatter={(label) => formatHour(label as number)}
          formatter={(value: number, name) =>
            name === "sales" ? [inr(value), "Sales"] : [value, "Orders"]
          }
        />
        <Bar dataKey="sales" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
