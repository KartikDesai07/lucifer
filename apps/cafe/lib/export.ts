import { cafeDateString } from "@/lib/utils";

// Escape a single CSV field per RFC 4180: wrap in quotes when it contains a
// comma, quote, or newline, and double any embedded quotes.
function escapeField(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV string from an array of plain objects and trigger a browser
 * download. Headers are taken from the first row's keys. Browser-only (uses
 * Blob + anchor click) — call from client components.
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  filename: string,
): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => escapeField(row[h])).join(","),
  );
  const csv = [headers.map(escapeField).join(","), ...rows].join("\r\n");

  downloadCsvString(csv, `${filename}-${cafeDateString()}`);
}

/**
 * Trigger a browser download of a pre-built CSV string under an exact filename
 * (no date stamp). Browser-only. Used e.g. for the bulk-import template.
 */
export function downloadCsvString(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
