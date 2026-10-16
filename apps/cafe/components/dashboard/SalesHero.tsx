import { cn } from "@/lib/utils";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { KpiChange } from "@/components/dashboard/KpiChange";
import { kpiFigures, type KpiFigure, type RangeCardProps } from "@/components/dashboard/RangeCards";

// The dashboard's hero (owner's mock-up): one dark ink card that leads with
// Net sales — big, its change as a pill — and, below a thin rule, Orders,
// Average order and Collected with their changes and the earlier-dues hint.
// The same four figures, words and comparison the KPI row showed; only the
// look is new. Loading holds each line's height with skeletons; `updating`
// dims the old range's figures while the newly picked range loads.

const SKELETON_ON_INK = "bg-on-ink/10";
// Three columns where they fit (a 30-day figure at 24 px needs about 9rem),
// otherwise two and one; one column on a phone.
const MINIS_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]";
// A mini's change line can wrap to two lines in a narrow column.
const MINI_CHANGE_CLASS = "min-h-5 content-start sm:min-h-10";
const HINT_LINE_CLASS = "mt-0.5 min-h-4";

const changeOf = (f: KpiFigure) => ({
  delta: f.delta,
  compareLabel: f.compareLabel,
  noCompareText: f.noCompareText,
  upIsGood: f.upIsGood,
});

export function SalesHero(p: RangeCardProps) {
  const loading = p.status !== "ready" || !p.data;
  const [net, ...minis] = kpiFigures(p.data);
  const dim = cn("transition-opacity duration-200", p.updating && "opacity-55");
  return (
    <section
      aria-busy={loading || p.updating}
      className="flex min-w-0 flex-col gap-[22px] rounded-2xl bg-ink p-5 text-on-ink sm:px-[26px] sm:py-6"
    >
      <div>
        <h3 className="text-[13px] font-medium text-on-ink/65">
          {net.label} · {p.period}
        </h3>
        {loading ? (
          <div>
            <BrandSkeleton className={cn(SKELETON_ON_INK, "mt-2.5 h-8 w-44 sm:h-10 sm:w-56")} />
            <BrandSkeleton className={cn(SKELETON_ON_INK, "mt-3 h-6 w-40 rounded-full")} />
          </div>
        ) : (
          <div className={dim}>
            <p className="mt-2.5 text-[32px] font-semibold leading-8 tracking-[-0.03em] tabular-nums sm:text-[40px] sm:leading-10">
              {net.value}
            </p>
            <KpiChange {...changeOf(net)} tone="dark" pill className="mt-3 min-h-6" />
          </div>
        )}
      </div>
      <div className={cn(MINIS_GRID_CLASS, "border-t border-on-ink/15 pt-[18px]")}>
        {minis.map((m) => (
          <div key={m.label} className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-[12.5px] text-on-ink/65">{m.label}</h3>
            {loading ? (
              <div>
                <BrandSkeleton className={cn(SKELETON_ON_INK, "h-7 w-24")} />
                <div className={cn("mt-1 flex items-start", MINI_CHANGE_CLASS)}>
                  <BrandSkeleton className={cn(SKELETON_ON_INK, "mt-0.5 h-4 w-28")} />
                </div>
                <div className={HINT_LINE_CLASS} />
              </div>
            ) : (
              <div className={dim}>
                <p className="whitespace-nowrap text-[24px] font-semibold leading-7 tracking-[-0.02em] tabular-nums">{m.value}</p>
                <KpiChange {...changeOf(m)} tone="dark" className={MINI_CHANGE_CLASS} />
                <p className={cn(HINT_LINE_CLASS, "text-[12px] leading-4 text-on-ink/65")}>{m.hint}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
