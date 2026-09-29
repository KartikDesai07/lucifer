import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/dashboard/format";
import { BrandSkeleton, DASH_CARD_CLASS } from "@/components/dashboard/DashCard";

// One headline figure: label, the value (proportional figures — tabular digits
// look loose at display size), and the change against the comparison period in
// words + an arrow, so the direction never rides on colour alone. `upIsGood`
// picks which direction wears the good colour.

// The change line wraps to two lines on a phone; the hint line is reserved on every card.
const CHANGE_LINE_CLASS = "min-h-10 sm:min-h-5";
const HINT_LINE_CLASS = "mt-0.5 min-h-4";

interface KpiCardProps {
  label: string;
  value: string;
  delta: number | null;
  compareLabel: string;
  /** Said instead of a change when the comparison period had nothing ("No orders on Tue, 22 Sep"). */
  noCompareText: string;
  hint?: string;
  upIsGood?: boolean;
  loading?: boolean;
  updating?: boolean;
}

export function KpiCard({ label, value, delta, compareLabel, noCompareText, hint, upIsGood = true, loading, updating }: KpiCardProps) {
  const d = formatDelta(delta);
  const good = d && d.direction !== "flat" && (d.direction === "up") === upIsGood;
  const Icon = !d || d.direction === "flat" ? Minus : d.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <section className={cn(DASH_CARD_CLASS, "flex flex-col gap-1.5")} aria-busy={loading || updating}>
      <h3 className="text-[13px] font-medium text-brand-muted">{label}</h3>
      {/* Both states hold the same three lines — value, change (two lines on a
          phone, where it wraps), hint — so the figures landing never move the page. */}
      {loading ? (
        <div>
          <BrandSkeleton className="h-8 w-28" />
          <div className={cn("mt-1 flex items-center", CHANGE_LINE_CLASS)}>
            <BrandSkeleton className="h-4 w-40" />
          </div>
          <div className={HINT_LINE_CLASS} />
        </div>
      ) : (
        <div className={cn("transition-opacity duration-200", updating && "opacity-55")}>
          <p className="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">{value}</p>
          <p
            className={cn(
              "mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5",
              CHANGE_LINE_CLASS,
              !d || d.direction === "flat" ? "text-brand-muted" : good ? "text-brand-up" : "text-brand-danger",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {d ? (
              <>
                <span className="sr-only">{d.direction === "up" ? "Up" : d.direction === "down" ? "Down" : "No change,"}</span>
                <span className="font-medium">{d.text}</span>
                <span className="text-brand-muted">{compareLabel}</span>
              </>
            ) : (
              <span>{noCompareText}</span>
            )}
          </p>
          <p className={cn(HINT_LINE_CLASS, "text-[12px] leading-4 text-brand-muted")}>{hint}</p>
        </div>
      )}
    </section>
  );
}
