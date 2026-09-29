import { cn } from "@/lib/utils";

// A ranked list with a thin bar under each row — how the Dashboard shows every
// "which one is biggest" answer (payments, items, categories, channels). Five
// values read better as words + a bar than as a pie. One colour for every bar
// (one series); the label and the numbers carry identity, never the colour.

export interface RankedRow {
  key: string;
  label: string;
  value: string; // "₹48,200"
  detail?: string; // "53%" · "12 sold"
  /** Bar length, 0..1 of the longest row (omit for no bar). */
  bar?: number;
}

/** Row pitch the cards reserve (label line + bar + gap), so every state holds one height. */
export const RANKED_ROW_PX = 46;

export function RankedList({ rows, className }: { rows: RankedRow[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col justify-center gap-1.5" style={{ minHeight: RANKED_ROW_PX }}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px] leading-5">
            <span className="min-w-0 truncate text-brand-ink" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 whitespace-nowrap">
              <span className="font-semibold text-brand-ink">{r.value}</span>
              {r.detail && <span className="ml-2 text-brand-muted">{r.detail}</span>}
            </span>
          </div>
          {r.bar !== undefined && (
            <div className="h-1.5 rounded-full bg-brand-paper" aria-hidden>
              <div
                className="h-1.5 rounded-full bg-brand-primary/85 transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(r.bar > 0 ? 2 : 0, Math.round(r.bar * 100))}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Bars relative to the longest row. */
export function barsOf<T>(rows: T[], amount: (row: T) => number): number[] {
  const max = Math.max(0, ...rows.map(amount));
  return rows.map((r) => (max > 0 ? amount(r) / max : 0));
}
