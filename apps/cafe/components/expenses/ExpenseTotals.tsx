"use client";

import { inrPaise, cn } from "@/lib/utils";
import { BrandSkeleton } from "@/components/dashboard/DashCard";

interface ExpenseTotalsProps {
  /** The muted word before the amount: "Total" (admin) or "Added today" (staff). */
  label: string;
  totalPaise: number | undefined;
  count: number | undefined;
  updating?: boolean;
  className?: string;
}

// One slim line: "Total ₹4,250 · 12 expenses" — from the server's count/total,
// which cover EVERY matching row even when the list below was cut at a page.
export function ExpenseTotals({ label, totalPaise, count, updating, className }: ExpenseTotalsProps) {
  const ready = totalPaise !== undefined && count !== undefined;
  if (!ready) return <BrandSkeleton className={cn("h-6 w-52 max-w-full", className)} />;
  return (
    <p
      className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[13px] text-brand-muted transition-opacity", updating && "opacity-55", className)}
      aria-busy={updating}
    >
      <span>{label}</span>
      <span className="text-[18px] font-semibold tabular-nums tracking-[-0.01em] text-brand-ink">{inrPaise(totalPaise)}</span>
      <span>
        · {count} {count === 1 ? "expense" : "expenses"}
      </span>
    </p>
  );
}
