"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn, inr } from "@/lib/utils";
import { deltaRatio } from "@/lib/dashboard/fold";
import { compareShort, compareWords, noCompareWords } from "@/lib/dashboard/labels";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { HeroChangeRow, HeroMiniChange } from "@/components/dashboard/KpiChange";
import { MaskedValue } from "@/components/dashboard/SalesReveal";
import type { RangeCardProps } from "@/components/dashboard/RangeCards";

// The dashboard's Net sales hero, exactly the owner's HTML (U0 match Task 6, values 3.3): the --nav card, the figure in
// Geist Mono 60px (42px when the content is under 560px wide), its change as a pill and "vs" the comparison, the
// reveal button and its hint on the right (SalesReveal, passed in), and below a --nav-2 rule Orders, Average order
// and Collected. Sales figures are masked ("₹ • • • •") until the signed-in person shows them (values 3.17); Orders
// and every change % always show. Our words where they are ours: the period's name, the comparison from our rule,
// Collected's "still due" and our extra earlier-dues line (ruling R12). Loading holds each line with a skeleton;
// `updating` dims the old range's figures while a newly picked range loads.

const SKELETON_ON_NAV = "bg-on-ink/10";
const GREY = "text-[#a1a1aa]";
const RISE = "motion-safe:animate-[brand-rise_0.5s_cubic-bezier(0.2,0.8,0.2,1)_both]";

/** values 3.2's count-up: on entering the dashboard the figures grow 0 -> 1 over 1.1 s, eased 1 - (1 - t)^3. */
const COUNT_UP_MS = 1100;

/**
 * The count-up the HTML plays once each time the dashboard opens (values 3.2: `E`, applied to Net sales, Orders and
 * Collected, and the receipt's total). 1 until the figures first arrive, then 0 -> 1; it never replays for a newly
 * picked period, and a device asking for reduced motion sees the figures at once.
 */
export function useCountUp(ready: boolean): number {
  const [grow, setGrow] = useState(1);
  const played = useRef(false);
  // A layout effect: the first frame with figures paints them at 0, never full and then 0.
  useLayoutEffect(() => {
    if (!ready || played.current) return;
    played.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let done = false;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNT_UP_MS);
      setGrow(1 - Math.pow(1 - p, 3));
      if (p < 1) frame = requestAnimationFrame(step);
      else done = true;
    };
    setGrow(0);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // Stopped half-way (React's dev double-run, or the figures went): show them whole, and let a re-run play.
      if (!done) {
        played.current = false;
        setGrow(1);
      }
    };
  }, [ready]);
  return grow;
}

export interface SalesHeroProps extends RangeCardProps {
  /** The figures show (the reveal is on for this person); otherwise they are masked. */
  shown: boolean;
  /** The count-up's progress (useCountUp); 1 = the figures as they are. */
  grow?: number;
  /** The reveal button and its hint (SalesReveal), in the top row's right column. */
  reveal?: ReactNode;
}

interface Mini {
  label: string;
  value: ReactNode;
  delta: number | null;
  note: string;
  /** Collected's second line (ruling R12): "+ ₹X paid against earlier dues". */
  dues?: string;
}

export function SalesHero(p: SalesHeroProps) {
  const d = p.data;
  const loading = p.status !== "ready" || !d;
  const grow = p.grow ?? 1;
  const dim = cn("transition-opacity duration-200", p.updating && "opacity-55");
  const range = d?.range;
  const cur = d?.kpis.current;
  const prev = d?.kpis.previous;
  const words = range ? compareWords(range, p.today) : "";
  const none = range ? noCompareWords(range, p.today) : "";
  const salesDelta = deltaRatio(cur?.sales ?? 0, prev?.sales ?? 0);
  const ordersDelta = deltaRatio(cur?.orders ?? 0, prev?.orders ?? 0);
  const due = Math.max(0, (cur?.sales ?? 0) - (cur?.collected ?? 0));
  const minis: Mini[] = [
    {
      label: "Orders",
      value: String(Math.round((cur?.orders ?? 0) * grow)),
      delta: ordersDelta,
      // The note is the comparison; with nothing to compare it says why (ruling R12).
      note: ordersDelta === null ? none : range ? `vs ${compareShort(range, p.today).toLowerCase()}` : "",
    },
    {
      label: "Average order",
      value: <MaskedValue text={inr(cur?.averageOrder ?? 0)} shown={p.shown} label="Average order hidden" />,
      delta: deltaRatio(cur?.averageOrder ?? 0, prev?.averageOrder ?? 0),
      note: "per bill",
    },
    {
      label: "Collected",
      value: <MaskedValue text={inr(Math.round((cur?.collected ?? 0) * grow))} shown={p.shown} label="Collected hidden" />,
      delta: deltaRatio(cur?.collected ?? 0, prev?.collected ?? 0),
      note: p.shown ? (due > 0 ? `${inr(due)} still due` : "all collected") : "still due hidden",
      // The line is its amount: while the figures are masked it is left out, so the masked hero is the HTML's own.
      dues: p.shown && d && d.duesCollected > 0 ? `+ ${inr(d.duesCollected)} paid against earlier dues` : undefined,
    },
  ];

  return (
    <section
      data-ui="hero"
      aria-busy={loading || p.updating}
      className={cn(
        "flex min-w-0 flex-col gap-[22px] rounded-[16px] border border-nav-2 bg-nav p-5 text-white @min-[560px]:px-[26px] @min-[560px]:py-6",
        RISE,
      )}
    >
      <div data-ui="hero-top" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 data-ui="hero-label" className={cn("text-[13px]", GREY)}>
            Net sales · {p.period}
          </h2>
          {loading ? (
            <div>
              <BrandSkeleton className={cn(SKELETON_ON_NAV, "mt-2.5 h-[42px] w-44 @min-[560px]:h-[60px] @min-[560px]:w-60")} />
              <BrandSkeleton className={cn(SKELETON_ON_NAV, "mt-3 h-6 w-40 rounded-full")} />
            </div>
          ) : (
            <div className={dim}>
              <p
                data-ui="hero-figure"
                className="mt-2.5 font-mono text-[42px] font-medium leading-none tracking-[-0.04em] @min-[560px]:text-[60px]"
              >
                <MaskedValue text={inr(Math.round((cur?.sales ?? 0) * grow))} shown={p.shown} label="Net sales hidden" />
              </p>
              <HeroChangeRow delta={salesDelta} compareWords={words} noCompareWords={none} />
            </div>
          )}
        </div>
        {p.reveal}
      </div>
      <div data-ui="hero-minis" className="grid grid-cols-1 gap-4 border-t border-nav-2 pt-[18px] @min-[560px]:grid-cols-3">
        {minis.map((m) => (
          <div key={m.label} data-ui="hero-mini" className="flex min-w-0 flex-col gap-1.5">
            <span data-ui="hero-mini-label" className={cn("text-[12.5px]", GREY)}>
              {m.label}
            </span>
            {loading ? (
              <>
                <BrandSkeleton className={cn(SKELETON_ON_NAV, "h-[31px] w-24")} />
                <BrandSkeleton className={cn(SKELETON_ON_NAV, "h-4 w-28")} />
              </>
            ) : (
              <>
                <span
                  data-ui="hero-mini-value"
                  className={cn("whitespace-nowrap font-mono text-[24px] font-medium tracking-[-0.03em]", dim)}
                >
                  {m.value}
                </span>
                <div className={cn("flex flex-col", dim)}>
                  <HeroMiniChange delta={m.delta} note={m.note} />
                  {m.dues && (
                    <span data-ui="hero-dues" className={cn("text-[12px]", GREY)}>
                      {m.dues}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
