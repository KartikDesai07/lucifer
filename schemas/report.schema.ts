import { z } from "zod";

// Largest span a single report may cover — bounds the aggregation so the route
// stays well under the Cloudflare CPU budget and the M0 cluster isn't asked to
// scan an unbounded date range (CLAUDE.md §3, §17).
export const MAX_REPORT_RANGE_DAYS = 366;

// Round-trip the parts so calendar-impossible dates are rejected, not silently
// rolled over (Date.parse("2026-02-30") would otherwise resolve to Mar 2).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Not a real date");

// Validates the reports query range: well-formed dates, start ≤ end, and a
// bounded span. String compare is valid for fixed-width YYYY-MM-DD values.
export const reportRangeSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((r) => r.startDate <= r.endDate, {
    message: "startDate must be on or before endDate",
    path: ["startDate"],
  })
  .refine(
    (r) => (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000 <= MAX_REPORT_RANGE_DAYS,
    {
      message: `Range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
      path: ["endDate"],
    },
  );

export type ReportRangeInput = z.infer<typeof reportRangeSchema>;
