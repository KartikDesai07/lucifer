import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/dashboard/format";
import { STATUS_CLASSES } from "@/lib/ui";

// A headline figure's change against the comparison period: an arrow, the
// direction in words for a screen reader ("Up" / "Down" / "No change,"), the
// percentage and what it is compared with — so the direction never rides on
// colour alone. `upIsGood` picks which direction wears the good colour.
// `tone="dark"` is for the ink hero card; `pill` puts the arrow and the
// percentage in a pill (the hero's Net sales).

/**
 * The ink card's own up/down colours (the mock-up's dark set): the light page's
 * green and red (#16733a, #a2191f) measure about 3:1 on the ink. They are
 * the --on-ink-up / --on-ink-down tokens, each reading at 4.5:1 or more on the
 * ink and on its pill tint in both themes (lib/dashboard-layout-paths.test.ts).
 */
export const KPI_CHANGE_DARK = {
  good: "text-on-ink-up",
  bad: "text-on-ink-down",
  flat: "text-on-ink/65",
  note: "text-on-ink/65",
  goodPill: "bg-[rgb(66_190_101/0.16)]",
  badPill: "bg-[rgb(250_77_86/0.16)]",
  flatPill: "bg-on-ink/10",
} as const;

const KPI_CHANGE_LIGHT = {
  good: "text-brand-up",
  bad: "text-brand-danger",
  flat: "text-brand-muted",
  note: "text-brand-muted",
  goodPill: STATUS_CLASSES.ok.tint,
  badPill: STATUS_CLASSES.bad.tint,
  flatPill: STATUS_CLASSES.neutral.tint,
} as const;

const TONES = { light: KPI_CHANGE_LIGHT, dark: KPI_CHANGE_DARK } as const;

export interface KpiChangeProps {
  delta: number | null;
  compareLabel: string;
  /** Said instead of a change when the comparison period had nothing ("No orders on Tue, 22 Sep"). */
  noCompareText: string;
  upIsGood?: boolean;
  tone?: keyof typeof TONES;
  pill?: boolean;
  className?: string;
}

export function KpiChange({ delta, compareLabel, noCompareText, upIsGood = true, tone = "light", pill = false, className }: KpiChangeProps) {
  const d = formatDelta(delta);
  const t = TONES[tone];
  const way = !d || d.direction === "flat" ? "flat" : (d.direction === "up") === upIsGood ? "good" : "bad";
  const Icon = !d || d.direction === "flat" ? Minus : d.direction === "up" ? ArrowUpRight : ArrowDownRight;
  const icon = <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  const said = d && <span className="sr-only">{d.direction === "up" ? "Up" : d.direction === "down" ? "Down" : "No change,"}</span>;

  if (pill && d) {
    return (
      <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-6", className, t.note)}>
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-semibold", t[way], t[`${way}Pill` as const])}>
          {icon}
          {said}
          {d.text}
        </span>
        <span>{compareLabel}</span>
      </p>
    );
  }
  return (
    <p className={cn("mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5", className, t[way])}>
      {icon}
      {d ? (
        <>
          {said}
          <span className="font-medium">{d.text}</span>
          <span className={t.note}>{compareLabel}</span>
        </>
      ) : (
        <span>{noCompareText}</span>
      )}
    </p>
  );
}
