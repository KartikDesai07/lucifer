// Single source of truth for the Reports redesign (Batch 1 — sales, payments,
// dues; Batch 2/3 append more). NO React/lucide import here — this file is
// imported by node:test suites directly (lib/reports-paths.test.ts) as well
// as the sidebar and every report page. Mirrors lib/settings-sections.ts's shape.

export const REPORTS_BASE_PATH = "/reports";

export type ReportSectionSlug = "sales" | "payments" | "dues";

export interface ReportSection {
  slug: ReportSectionSlug;
  title: string;
  description: string;
}

// Order here is also the sidebar sub-menu order (owner's Batch 1 plan).
export const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    slug: "sales",
    title: "Sales summary",
    description: "What you sold, what came in, and how it adds up",
  },
  {
    slug: "payments",
    title: "Payments & cash tally",
    description: "Match the cash drawer and the bank, day by day",
  },
  {
    slug: "dues",
    title: "Customer dues",
    description: "Who owes you, and what came in",
  },
];

export function reportSectionPath(slug: ReportSectionSlug): string {
  return `${REPORTS_BASE_PATH}/${slug}`;
}
