// Single source of truth for the Reports redesign (Batch 1 — sales, payments,
// dues; Batch 2 — items, cancels, gst; Batch 3 — order types & busy hours).
// NO React/lucide import here — this file is imported by node:test suites
// directly (lib/reports-paths.test.ts) as well as the sidebar and every
// report page. Mirrors lib/settings-sections.ts's shape.

export const REPORTS_BASE_PATH = "/reports";

export type ReportSectionSlug = "sales" | "payments" | "items" | "order-types" | "cancels" | "gst" | "dues";

export interface ReportSection {
  slug: ReportSectionSlug;
  title: string;
  description: string;
}

// Order here is also the sidebar sub-menu order (owner's Batch 1/2 plan).
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
    slug: "items",
    title: "Items & categories",
    description: "What sells, and what it brings in",
  },
  {
    slug: "order-types",
    title: "Order types & busy hours",
    description: "Dine-in, takeaway, QR and counter — and your busiest hours",
  },
  {
    slug: "cancels",
    title: "Cancel & discounts",
    description: "Every cancel, removed item and discount — who and why",
  },
  {
    slug: "gst",
    title: "GST",
    description: "Tax on your bills, ready for your CA",
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
