import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/dashboard/format";

// A headline figure's change against the comparison period, so the direction never rides on colour alone (a word
// for a screen reader: "Up" / "Down" / "No change,"). `KpiChange` is the reports' light card line (an arrow icon, the
// percentage, what it is compared with). The dashboard's dark Net sales hero (U0 match Task 6, values 3.3) draws the
// owner's HTML instead: its dl() text "↑ 12.4%" in a pill, then "vs" and the comparison (HeroChangeRow), and on each
// mini "↑ 6.8% " then a grey note (HeroMiniChange).

/**
 * The hero's own colours (values 3.3 dl(d, true)): up #6FDC8C on rgba(66,190,101,.16), down #FF8389 on
 * rgba(250,77,86,.16), as the --on-ink-up / --on-ink-down tokens with the pills flattened over the hero's --nav;
 * a flat change and the notes are the HTML's #A1A1AA, the flat pill white at 10 % (ruling R12). Each pairing reads
 * at 4.5:1 or more (lib/dashboard-layout-paths.test.ts).
 */
export const KPI_CHANGE_DARK = {
  good: "text-on-ink-up",
  bad: "text-on-ink-down",
  flat: "text-[#a1a1aa]",
  note: "text-[#a1a1aa]",
  goodPill: "bg-on-ink-up-tint",
  badPill: "bg-on-ink-down-tint",
  flatPill: "bg-on-ink/10",
} as const;

const KPI_CHANGE_LIGHT = {
  good: "text-brand-up",
  bad: "text-brand-danger",
  flat: "text-brand-muted",
  note: "text-brand-muted",
} as const;

export interface KpiChangeProps {
  delta: number | null;
  compareLabel: string;
  /** Said instead of a change when the comparison period had nothing ("No orders on Tue, 22 Sep"). */
  noCompareText: string;
  upIsGood?: boolean;
  className?: string;
}

export function KpiChange({ delta, compareLabel, noCompareText, upIsGood = true, className }: KpiChangeProps) {
  const d = formatDelta(delta);
  const t = KPI_CHANGE_LIGHT;
  const way = !d || d.direction === "flat" ? "flat" : (d.direction === "up") === upIsGood ? "good" : "bad";
  const Icon = !d || d.direction === "flat" ? Minus : d.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5", className, t[way])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {d ? (
        <>
          <span className="sr-only">{d.direction === "up" ? "Up" : d.direction === "down" ? "Down" : "No change,"}</span>
          <span className="font-medium">{d.text}</span>
          <span className={t.note}>{compareLabel}</span>
        </>
      ) : (
        <span>{noCompareText}</span>
      )}
    </p>
  );
}

const PERCENT = 100;
const FLAT_BELOW_PERCENT = 0.05; // rounds to 0.0 % - no change, as formatDelta

export interface HeroChange {
  /** The HTML's dl() text: "↑ 12.4%", "↓ 2.1%", or "0%" for no change (ruling R12). */
  text: string;
  said: "Up" | "Down" | "No change,";
  way: "good" | "bad" | "flat";
}

/** values 3.3 dl(d): the change to one decimal as the HTML's data has it (a whole number without one); null = no comparison. */
export function heroChange(ratio: number | null): HeroChange | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = ratio * PERCENT;
  const abs = Math.abs(pct);
  if (abs < FLAT_BELOW_PERCENT) return { text: "0%", said: "No change,", way: "flat" };
  const shown = String(Math.round(abs * 10) / 10);
  return pct > 0 ? { text: `↑ ${shown}%`, said: "Up", way: "good" } : { text: `↓ ${shown}%`, said: "Down", way: "bad" };
}

/**
 * The hero's delta row (values 3.3 and 0.2): the pill, then "vs" and the comparison as their own flex items (the HTML's
 * template splits them, so its 8px gap sits between all three); 13px #A1A1AA, 12px under the figure. No comparison:
 * no pill, the line says so ("No orders last Monday").
 */
export function HeroChangeRow({ delta, compareWords, noCompareWords }: { delta: number | null; compareWords: string; noCompareWords: string }) {
  const change = heroChange(delta);
  const t = KPI_CHANGE_DARK;
  return (
    <div data-ui="hero-delta" className={cn("mt-3 flex items-center gap-2 text-[13px]", t.note)}>
      {change ? (
        <>
          <span data-ui="hero-pill" className={cn("flex h-6 items-center rounded-[12px] px-[9px] font-semibold", t[change.way], t[`${change.way}Pill`])}>
            <span className="sr-only">{change.said}</span>
            {change.text}
          </span>
          <span>vs</span>
          <span>{compareWords}</span>
        </>
      ) : (
        <span>{noCompareWords}</span>
      )}
    </div>
  );
}

/** A mini's change line (values 3.3): "↑ 6.8% " in the change colour, 12/500, then the note at 400 in #A1A1AA. */
export function HeroMiniChange({ delta, note }: { delta: number | null; note: string }) {
  const change = heroChange(delta);
  const t = KPI_CHANGE_DARK;
  return (
    <span data-ui="hero-mini-delta" className={cn("text-[12px] font-medium", change ? t[change.way] : t.note)}>
      {change && <span className="sr-only">{change.said}</span>}
      {change ? `${change.text} ` : null}
      <span data-ui="hero-mini-note" className={cn("font-normal", t.note)}>
        {note}
      </span>
    </span>
  );
}
