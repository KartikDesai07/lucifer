import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/shared/StatusPill";
import type { StatusKind } from "@/lib/ui";

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
  /** The bar's fill class; the default is the brand colour. */
  barClass?: string;
  /** A status dot before the label (the payment rows). */
  dot?: StatusKind;
  /** A tile before the row (the channel icon); the bar then sits beside the tile. */
  icon?: ReactNode;
}

const DEFAULT_BAR_CLASS = "bg-brand-primary/85 ";

/** Row pitch the cards reserve (label line + bar + gap), so every state holds one height. */
export const RANKED_ROW_PX = 46;

export function RankedList({ rows, className }: { rows: RankedRow[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col", className)}>
      {rows.map((r) => (
        <li key={r.key} className={cn("flex justify-center", r.icon ? "items-center gap-3" : "flex-col gap-1.5")} style={{ minHeight: RANKED_ROW_PX }}>
          {r.icon}
          <div className={cn("flex flex-col justify-center gap-1.5", r.icon && "min-w-0 flex-1")}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px] leading-5">
            <span className="flex min-w-0 items-center gap-2 text-brand-ink" title={r.label}>
              {r.dot && <StatusDot kind={r.dot} />}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap">
              <span className="font-semibold text-brand-ink">{r.value}</span>
              {r.detail && <span className="ml-2 text-brand-muted">{r.detail}</span>}
            </span>
          </div>
          {r.bar !== undefined && (
            <div className="h-1.5 rounded-full bg-brand-paper" aria-hidden>
              <div
                className={cn("h-1.5 rounded-full transition-[width] duration-500 ease-out", r.barClass ?? DEFAULT_BAR_CLASS)}
                style={{ width: `${Math.max(r.bar > 0 ? 2 : 0, Math.round(r.bar * 100))}%` }}
              />
            </div>
          )}
          </div>
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
