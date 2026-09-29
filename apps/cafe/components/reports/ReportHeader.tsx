"use client";

import { Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { periodDates, periodLabel } from "@/lib/dashboard/labels";
import { cafeDateString } from "@/lib/utils";
import { useReportRange, MAX_REPORT_RANGE_DAYS } from "@/components/reports/ReportRangeContext";
import { RangeBar } from "@/components/dashboard/RangeBar";
import type { DashboardRange } from "@/types/dashboard";

interface ReportHeaderProps {
  title: string;
  description: string;
  /** Compare caption, e.g. "compared with the 7 days before" ("" while loading). */
  compareCaption: string;
  /**
   * The range of the report on screen (its own echoed range). While a newly
   * picked period loads, the previous numbers stay up — the header must name
   * THEIR period, never the picker's pending one (lib/dashboard/labels.ts rule).
   */
  shownRange?: DashboardRange;
  onDownload: () => void;
  downloadDisabled: boolean;
}

// The shared top of every report page (R1/R3): a "Reports" crumb, the report's
// own title + description, the shared RangeBar, a caption line that reserves
// its height (so data landing never shifts the page), and a Download CSV
// button. Stacks on phones exactly like the Dashboard's picker row.
export function ReportHeader({ title, description, compareCaption, shownRange, onDownload, downloadDisabled }: ReportHeaderProps) {
  const { isAdmin } = useAuth();
  const { selection, range, onSelect } = useReportRange();
  const today = cafeDateString();
  const shown = shownRange ?? range;
  const periodName = periodLabel(shown, today);
  const dates = periodDates(shown);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-brand-muted">Reports</p>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.015em]">{title}</h1>
          <p className="mt-0.5 text-[13.5px] text-brand-muted">{description}</p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloadDisabled}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-brand-rule bg-brand-slip px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download CSV
        </button>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {/* Reserves two lines' worth of height so the caption landing never
            shifts the page (same idiom as the Dashboard's period caption). */}
        <p className="min-h-9 text-[12.5px] leading-[18px] text-brand-muted sm:min-h-[18px]">
          {periodName === dates ? "" : `${dates} · `}
          {compareCaption || "Loading…"}
        </p>
        <RangeBar value={selection} onChange={onSelect} isAdmin={isAdmin} maxDays={MAX_REPORT_RANGE_DAYS} />
      </div>
    </div>
  );
}
