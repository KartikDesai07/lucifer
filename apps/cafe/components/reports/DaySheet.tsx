"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { useIsMobile } from "@/hooks/use-mobile";
import { inr, cn } from "@/lib/utils";
import { weekdayDayLabel, hourLabel } from "@/lib/dashboard/range";
import { plural } from "@/lib/dashboard/format";
import { PAY_STYLES } from "@/lib/constants";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// One day's full breakdown (R2), opened from a report's chart or table row.
// Right sheet on desktop, bottom on a phone. Content is the EXISTING
// dashboard aggregate for that single day (GET /api/dashboard?from=to=day) —
// no new server code, and the numbers always agree with the Dashboard's own.
interface DaySheetProps {
  day: string | null;
  onOpenChange: (open: boolean) => void;
}

export function DaySheet({ day, onOpenChange }: DaySheetProps) {
  const isMobile = useIsMobile();
  const dash = useDashboard({ from: day ?? "", to: day ?? "" }, !!day);
  // useDashboard keeps the previous result while a new key loads — here that would
  // be ANOTHER day's figures under this day's title. Only this day's data counts.
  const d = dash.data && day && dash.data.range.from === day ? dash.data : undefined;

  return (
    <Sheet open={!!day} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{day ? weekdayDayLabel(day) : "Day details"}</SheetTitle>
        </SheetHeader>

        {dash.isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load this day. It will try again on its own.</p>
            <button
              type="button"
              onClick={() => void dash.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          </div>
        ) : !d ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <BrandSkeleton key={i} className="h-16 w-full" />
              ))}
            </div>
            <BrandSkeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Net sales" value={inr(d.kpis.current.sales)} />
              <Figure label="Orders" value={String(d.kpis.current.orders)} />
              <Figure label="Average bill" value={inr(d.kpis.current.averageOrder)} />
            </div>

            <Section title="Money">
              {MONEY_BREAKDOWN_LINES.map((line) => (
                <Row key={line.key} label={line.label} value={`${line.sign ? `${line.sign} ` : ""}${inr(d.money[line.key])}`} />
              ))}
              <Row label={MONEY_NET_LABEL} value={inr(d.kpis.current.sales)} strong />
            </Section>

            {d.payments.length > 0 && (
              <Section title="Payments">
                {d.payments.map((p) => (
                  <Row key={p.key} label={PAY_STYLES[p.key]?.label ?? p.label} value={inr(p.amount)} />
                ))}
              </Section>
            )}

            <BusiestHour series={d.series} mode={d.mode} />

            {d.topItems.length > 0 && (
              <Section title="Top items">
                {d.topItems.map((item) => (
                  <Row key={item.label} label={`${item.label} · ${item.qty} sold`} value={inr(item.revenue)} />
                ))}
              </Section>
            )}

            {(d.leaks.cancelled.count > 0 || d.leaks.voids.qty > 0) && (
              <Section title="Cancelled & voided">
                {d.leaks.cancelled.count > 0 && (
                  <Row label={`${plural(d.leaks.cancelled.count, "cancelled order")}`} value={inr(d.leaks.cancelled.value)} />
                )}
                {d.leaks.voids.qty > 0 && <Row label={`${plural(d.leaks.voids.qty, "voided item")}`} value={inr(d.leaks.voids.value)} />}
              </Section>
            )}

            <Link
              href={`/orders?date=${day}`}
              className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-brand-primary px-4 text-[14px] font-semibold text-brand-slip hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              See all {d.kpis.current.orders} orders of this day
            </Link>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-brand-rule bg-brand-slip p-2 text-center">
      <p className="text-[11.5px] text-brand-muted">{label}</p>
      <p className="text-[15px] font-semibold text-brand-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-semibold text-brand-ink">{title}</h3>
      <div className="flex flex-col divide-y divide-brand-rule/70">{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-[13.5px]", strong && "font-semibold")}>
      <span className="min-w-0 truncate text-brand-ink">{label}</span>
      <span className="shrink-0 tabular-nums text-brand-ink">{value}</span>
    </div>
  );
}

const HOURS_PER_DAY = 24;

function BusiestHour({ series, mode }: { series: { key: string; label: string; sales: number; orders: number }[]; mode: "hour" | "day" }) {
  if (mode !== "hour") return null;
  const peak = series.reduce<(typeof series)[number] | null>((best, s) => (!best || s.sales > best.sales ? s : best), null);
  if (!peak || peak.sales === 0) return null;
  // The point's key IS its IST hour — the hour-mode series starts at the first
  // hour anything sold, so a position in the array is not an hour.
  const nextLabel = hourLabel((Number(peak.key) + 1) % HOURS_PER_DAY);
  return (
    <Section title="Busiest hour">
      <Row label={`${peak.label} – ${nextLabel}`} value={`${plural(peak.orders, "order")} · ${inr(peak.sales)}`} />
    </Section>
  );
}
