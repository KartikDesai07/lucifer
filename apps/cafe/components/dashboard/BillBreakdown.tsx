import { cn, inr } from "@/lib/utils";
import { billPeriodTag } from "@/lib/dashboard/labels";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL, type MoneyLine } from "@/lib/money-breakdown";
import { maskMoney } from "@/lib/sales-reveal";
import { DashSkeleton } from "@/components/dashboard/DashCard";
import type { RangeCardProps } from "@/components/dashboard/RangeCards";
import type { MoneyBreakdown } from "@/types";

// The dashboard's bill breakdown, the owner's HTML receipt (U0 match Task 6, values 3.4): a surface card with no foot
// border and a torn lower edge, the period tag in Geist Mono, a dashed rule, our five rows in our words (they are our
// data: Gross bill, Discounts, Rewards given, GST added, Additional charges) in the HTML's colours and its − / + signs,
// a second dashed rule and the Net sales total. Masked rows read "• • • •" in text-3 and the total "₹ • • • •"
// (values 3.17). The reports keep their own receipt (components/reports/MoneyBreakdownCard.tsx).

// values 3.4: the gross in the text colour, the deductions in --bad-i, the additions in --text-2.
const ROW_COLOUR: Record<keyof MoneyBreakdown, string> = {
  gross: "text-foreground",
  discount: "text-status-bad-ink",
  reward: "text-status-bad-ink",
  gst: "text-muted-foreground",
  charges: "text-muted-foreground",
};
const MASKED_COLOUR = "text-subtle-foreground";
// The HTML writes U+2212 for a deduction.
const SIGN: Record<MoneyLine["sign"], string> = { "": "", "-": "− ", "+": "+ " };
const RULE = "border-t-[1.5px] border-dashed border-border";
// values 3.4's torn edge, verbatim (--color-card is the surface).
const TORN_EDGE = "radial-gradient(circle at 7px 9px,transparent 5px,var(--color-card) 5.5px) 0 0/14px 9px repeat-x";
const RISE = "motion-safe:animate-[brand-rise_0.5s_0.06s_cubic-bezier(0.2,0.8,0.2,1)_both]";

export interface BillBreakdownProps extends RangeCardProps {
  /** The figures show (the reveal is on for this person); otherwise they are masked. */
  shown: boolean;
  /** The hero's count-up (useCountUp), shared by the total; 1 = as it is. */
  grow?: number;
}

export function BillBreakdown(p: BillBreakdownProps) {
  const d = p.data;
  const loading = p.status !== "ready" || !d;
  const grow = p.grow ?? 1;
  return (
    <section
      data-ui="bill"
      aria-labelledby="dash-bill-breakdown"
      aria-busy={loading || p.updating}
      className={cn(
        "relative mb-2 min-w-0 rounded-t-[16px] border border-b-0 border-border bg-card px-[22px] pt-5 pb-[26px] text-foreground",
        RISE,
      )}
    >
      <div data-ui="bill-head" className="flex items-baseline justify-between gap-2">
        <h2 id="dash-bill-breakdown" className="text-[15px] font-semibold">
          Bill breakdown
        </h2>
        <span data-ui="bill-tag" className="font-mono text-[11px] uppercase tracking-[0.06em] text-subtle-foreground">
          {billPeriodTag(d?.range ?? { from: p.today, to: p.today }, p.today)}
        </span>
      </div>
      <div aria-hidden data-ui="bill-rule" className={cn(RULE, "mt-3.5 mb-1.5")} />
      <div className={cn("transition-opacity duration-200", p.updating && "opacity-55")}>
        {MONEY_BREAKDOWN_LINES.map((line) =>
          loading ? (
            <div key={line.key} className="py-[7px]">
              <DashSkeleton className="h-[18px] w-full" />
            </div>
          ) : (
            <div
              key={line.key}
              data-ui="bill-row"
              className={cn("flex justify-between gap-3 py-[7px] text-[13.5px]", p.shown ? ROW_COLOUR[line.key] : MASKED_COLOUR)}
            >
              <span>{line.label}</span>
              <span className="font-mono">{maskMoney(`${SIGN[line.sign]}${inr(d.money[line.key])}`, p.shown, "bill")}</span>
            </div>
          ),
        )}
      </div>
      <div aria-hidden data-ui="bill-rule" className={cn(RULE, "mt-1.5 mb-3")} />
      <div data-ui="bill-total" className="flex items-baseline justify-between">
        <span className="text-[15px] font-semibold">{MONEY_NET_LABEL}</span>
        {loading ? (
          <DashSkeleton className="h-7 w-28 self-center" />
        ) : (
          <span
            data-ui="bill-total-value"
            className={cn("font-mono text-[22px] font-semibold tracking-[-0.02em]", p.updating && "opacity-55")}
          >
            {maskMoney(inr(Math.round(d.kpis.current.sales * grow)), p.shown)}
          </span>
        )}
      </div>
      <div
        aria-hidden
        data-ui="bill-edge"
        className="absolute -bottom-2 -left-px -right-px h-[9px]"
        style={{ background: TORN_EDGE }}
      />
    </section>
  );
}
