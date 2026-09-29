"use client";

// One picked period shared by every /reports/* page (sales, payments, dues) —
// so switching a report keeps the same range instead of resetting to the
// default, and the three report queries key off the exact same range object
// shape the Dashboard uses. Reports are admin-only (the layout's AdminGuard
// already refuses a non-admin the whole section), so every preset + Custom is
// always offered — no staff-only narrowing like the Dashboard's RangeBar.
import { createContext, useContext, type ReactNode } from "react";
import { MAX_REPORT_RANGE_DAYS } from "@pos/shared/schemas/report.schema";
import { useStoredPeriod, rangeOfPeriod } from "@/hooks/use-stored-period";
import { presetRange } from "@/lib/dashboard/range";
import type { DashboardSelection } from "@/components/dashboard/RangeBar";
import type { DashboardRange } from "@/types/dashboard";

const PERIOD_STORAGE_KEY = "pos.reports.period";
const FALLBACK_PRESET = "7d" as const;

export { MAX_REPORT_RANGE_DAYS };

interface ReportRangeValue {
  selection: DashboardSelection;
  range: DashboardRange;
  restored: boolean;
  onSelect: (next: DashboardSelection) => void;
}

const ReportRangeCtx = createContext<ReportRangeValue | null>(null);

export function ReportRangeProvider({ children }: { children: ReactNode }) {
  const { period, restored, save } = useStoredPeriod({
    key: PERIOD_STORAGE_KEY,
    fallback: FALLBACK_PRESET,
    maxDays: MAX_REPORT_RANGE_DAYS,
  });
  const range = rangeOfPeriod(period, FALLBACK_PRESET);
  const selection: DashboardSelection = { preset: period.preset, range };
  const onSelect = (next: DashboardSelection) =>
    save(next.preset === "custom" ? { preset: "custom", custom: next.range } : { preset: next.preset });

  const value: ReportRangeValue = { selection, range, restored, onSelect };
  return <ReportRangeCtx.Provider value={value}>{children}</ReportRangeCtx.Provider>;
}

export function useReportRange(): ReportRangeValue {
  const ctx = useContext(ReportRangeCtx);
  if (!ctx) throw new Error("useReportRange must be used inside ReportRangeProvider");
  return ctx;
}

// Re-exported so a page that only needs "today, as a default" doesn't need
// its own import of presetRange purely for that one fallback case.
export { presetRange };
