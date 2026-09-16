import { CAFE_DATE_PATTERN } from "@/lib/constants";
import { cafeDateString } from "@/lib/utils";

// CR1.5 Slice 5 — parse the optional `?date` param on /api/orders/summary, so
// staff (and admins) can pull a past business day's closing figures, not just
// today's live cache.
//
// Absent/"" → today (cafe-local/IST), matching the pre-Slice-5 default.
// Otherwise `raw` must match CAFE_DATE_PATTERN AND round-trip through
// `cafeDateString`: `new Date("2026-02-30")` does NOT throw — JS Date
// overflow-normalizes it to March 2 — so the pattern check alone would
// silently accept a bogus calendar date. The round-trip is what actually
// catches it (cafeDateString(new Date("2026-02-30")) === "2026-03-02" !==
// the input).
// Clamp a (possibly-cleared) `<input type="date">` value to `today` when
// empty/blank. The EndOfDayButton derives isToday/dateLabel/documentTitle and
// the useOrderSummary(...) arg from this ONE value — a raw `date === ""` used
// directly diverges from the server (which treats ""→today the same way),
// producing a mislabeled EOD slip (isToday=false, "Invalid Date", open tabs
// wrongly suppressed) that still carries today's money.
export function effectiveSummaryDate(raw: string, today: string): string {
  return raw.trim() ? raw : today;
}

export function parseSummaryDateParam(
  raw: string | null,
): { day: Date } | { error: string } {
  if (!raw) return { day: new Date() };
  if (!CAFE_DATE_PATTERN.test(raw)) {
    return { error: "date must be in YYYY-MM-DD format" };
  }
  const day = new Date(raw);
  if (Number.isNaN(day.getTime()) || cafeDateString(day) !== raw) {
    return { error: "date must be in YYYY-MM-DD format" };
  }
  return { day };
}
