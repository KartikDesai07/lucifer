"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { PAYMENT_COLORS } from "@/lib/constants";
import { inr } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";

export interface PaymentSlice {
  mode: string;
  amount: number;
}

interface PaymentChartProps {
  data: PaymentSlice[];
}

// Pie chart of collected amount per payment mode. Reused by the dashboard
// (today) and the reports page (date range). 'use client' — recharts needs DOM.
export function PaymentChart({ data }: PaymentChartProps) {
  const slices = data.filter((d) => d.amount > 0);

  if (slices.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description="Payment breakdown will appear once orders are completed."
        className="h-[260px] justify-center"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="amount"
          nameKey="mode"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {slices.map((slice) => (
            <Cell
              key={slice.mode}
              fill={PAYMENT_COLORS[slice.mode] ?? "#94a3b8"}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name) => [inr(value), name as string]}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) => {
            const slice = slices.find((s) => s.mode === value);
            return `${value} · ${inr(slice?.amount ?? 0)}`;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
