"use client";

import { AdminGuard } from "@/components/shared/AdminGuard";
import { ReportRangeProvider } from "@/components/reports/ReportRangeContext";
import { brandFontVariables } from "@/lib/brand-fonts";

// Shell for every /reports/* page — AdminGuard (reports are admin-only, same
// as the Reports sidebar row), the Dashboard's own Paper & Ink wrapper
// classes, and ONE ReportRangeProvider so the picked period survives a
// section switch (Sales -> Payments keeps "Last 7 days" instead of resetting).
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <ReportRangeProvider>
        <div className={`${brandFontVariables} -m-4 min-h-[calc(100svh-3.5rem)] bg-brand-paper p-4 font-brand-sans text-brand-ink md:-m-6 md:p-6`}>
          <div className="mx-auto flex max-w-[1440px] flex-col gap-4 sm:gap-5">{children}</div>
        </div>
      </ReportRangeProvider>
    </AdminGuard>
  );
}
