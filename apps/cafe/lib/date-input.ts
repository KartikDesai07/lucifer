// Pure string<->Date helpers for DatePicker (UI batch 1, slice G — 2026-09-29).
// LOCAL date math only: never toISOString/Date.parse, which read the string
// as UTC and shift the day under IST (UTC+5:30). date-fns `parse`/`format`
// both operate on local wall-clock fields, matching every "YYYY-MM-DD" string
// already used across the app (cafeDateString() et al.).
import { format, isValid, parse } from "date-fns";

export const DATE_INPUT_FORMAT = "yyyy-MM-dd";

// "" or an invalid/malformed string → undefined (no date), never a bogus Date.
export function parseDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, DATE_INPUT_FORMAT, new Date());
  return isValid(parsed) ? parsed : undefined;
}

export function formatDateInput(date: Date): string {
  return format(date, DATE_INPUT_FORMAT);
}
