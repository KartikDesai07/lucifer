"use client";

import Link from "next/link";
import { useIsMobile } from "@/hooks/use-mobile";
import { inr, cn } from "@/lib/utils";
import { weekdayDayLabel } from "@/lib/dashboard/range";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CancelsReport } from "@/types/reports";

// One day's cancel/discount detail (Batch 2), opened from the "Given away and
// lost" chart or the day's row. Same shell as DaySheet: right on desktop,
// bottom on a phone — but its content is a SLICE of the already-loaded
// CancelsReport (row.day === day), not a fresh fetch, so it can never race
// another day's numbers the way a keepPreviousData query could.

interface CancelDaySheetProps {
  day: string | null;
  report: CancelsReport | undefined;
  onOpenChange: (open: boolean) => void;
}

const KIND_LABEL: Record<"manual" | "gst" | "reward", string> = {
  manual: "Manual",
  gst: "GST discount",
  reward: "Reward",
};

export function CancelDaySheet({ day, report, onOpenChange }: CancelDaySheetProps) {
  const isMobile = useIsMobile();
  const cancelled = day && report ? report.cancelled.rows.filter((r) => r.day === day) : [];
  const removed = day && report ? report.removed.rows.filter((r) => r.day === day) : [];
  const discounts = day && report ? report.discounts.rows.filter((r) => r.day === day) : [];
  const truncated = !!report && (report.cancelled.truncated || report.removed.truncated || report.discounts.truncated);

  return (
    <Sheet open={!!day} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{day ? weekdayDayLabel(day) : "Day details"}</SheetTitle>
        </SheetHeader>

        {!report ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {cancelled.length > 0 && (
              <Section title="Cancelled bills">
                {cancelled.map((r) => (
                  <Row key={r.id} label={`${r.billNumber !== undefined ? `Bill #${r.billNumber}` : r.orderId} · ${r.by || "—"} · ${r.reason || "—"}`} value={inr(r.value)} />
                ))}
              </Section>
            )}
            {removed.length > 0 && (
              <Section title="Items removed">
                {removed.map((r, i) => (
                  <Row key={`${r.orderId}-${i}`} label={`${r.item} · ${r.by || "—"} · ${r.reason || "—"}`} value={`${r.qty} · ${inr(r.value)}`} />
                ))}
              </Section>
            )}
            {discounts.length > 0 && (
              <Section title="Discounts & rewards">
                {discounts.map((r, i) => (
                  <Row
                    key={`${r.orderId}-${i}`}
                    label={`${r.billNumber !== undefined ? `Bill #${r.billNumber}` : r.orderId} · ${KIND_LABEL[r.kind]} · ${r.by}`}
                    value={inr(r.amount)}
                  />
                ))}
              </Section>
            )}
            {cancelled.length === 0 && removed.length === 0 && discounts.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing cancelled, removed or discounted on this day.</p>
            )}
            {truncated && (
              <p className="text-[12px] text-brand-muted">The lists for this period are cut to the latest entries, so an older day may be missing some here — pick just this day to see every one.</p>
            )}

            <Link
              href={`/orders?date=${day}`}
              className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-brand-primary px-4 text-[14px] font-semibold text-brand-slip hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              See all orders of this day
            </Link>
          </>
        )}
      </SheetContent>
    </Sheet>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-[13.5px]")}>
      <span className="min-w-0 break-words text-brand-ink">{label}</span>
      <span className="shrink-0 tabular-nums text-brand-ink">{value}</span>
    </div>
  );
}
