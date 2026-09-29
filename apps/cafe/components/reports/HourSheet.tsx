"use client";

import Link from "next/link";
import { ChevronRight, RotateCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { rangeDays } from "@/lib/dashboard/range";
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { useHourDetail } from "@/hooks/use-reports";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DashboardChannel, DashboardRange } from "@/types/dashboard";
import type { HourRow } from "@/types/reports-b3";

// One hour's drill-down (Batch 3), opened from the Order types & busy hours
// chart or the By hour table. Same shell as ItemSheet/DaySheet: right on
// desktop, bottom on a phone. The figures at the top come from the row the
// page already has (no wait for the fetch); only "By day" waits on the detail.

interface HourSheetProps {
  row: HourRow | null;
  type: DashboardChannel | null;
  range: DashboardRange;
  onOpenChange: (open: boolean) => void;
}

export function HourSheet({ row, type, range, onOpenChange }: HourSheetProps) {
  const isMobile = useIsMobile();
  const detail = useHourDetail(range, row?.hour ?? null, type);
  // useHourDetail keeps the previous result while a new key loads — here that
  // would be ANOTHER hour's (or type's) days under this hour's title. Only
  // this exact identity's data counts (memory: keepPreviousData detail view
  // must match the echoed identity).
  const d =
    detail.data && row && detail.data.hour === row.hour && detail.data.type === type && detail.data.range.from === range.from && detail.data.range.to === range.to
      ? detail.data
      : undefined;

  const figures = row ? (type ? row.byType[type] : row) : null;
  const byTypeRows = row && !type ? Object.entries(row.byType).filter(([, cell]) => cell.orders > 0).sort(([, a], [, b]) => b.orders - a.orders) : [];

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{row?.span ?? "Hour details"}</SheetTitle>
          <p className="text-[12.5px] text-brand-muted">{type ? CHANNEL_LABELS[type] : "All order types"}</p>
        </SheetHeader>

        {row && figures && (
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Orders" value={String(figures.orders)} />
            <Figure label="Sales" value={inr(figures.sales)} />
            <Figure label="Avg order" value={inr(figures.orders > 0 ? figures.sales / figures.orders : 0)} />
          </div>
        )}

        {byTypeRows.length > 0 && (
          <Section title="By order type">
            {byTypeRows.map(([key, cell]) => (
              <Row key={key} label={CHANNEL_LABELS[key as DashboardChannel]} value={`${plural(cell.orders, "order")} · ${inr(cell.sales)}`} />
            ))}
          </Section>
        )}

        {detail.isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load this hour. It will try again on its own.</p>
            <button
              type="button"
              onClick={() => void detail.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          </div>
        ) : !d ? (
          <BrandSkeleton className="h-40 w-full" />
        ) : (
          <>
            <Section title="By day">
              {d.days.length === 0 ? (
                <p className="py-3 text-[13px] text-brand-muted">No orders in this hour.</p>
              ) : (
                d.days.map((day) => (
                  <Link
                    key={day.date}
                    href={`/orders?date=${day.date}`}
                    className="flex items-center justify-between gap-3 py-1.5 text-[13.5px] hover:bg-brand-wash"
                  >
                    <span className="min-w-0 truncate text-brand-ink">{day.label}</span>
                    <span className="flex shrink-0 items-center gap-1 tabular-nums text-brand-ink">
                      {plural(day.orders, "order")} · {inr(day.sales)}
                      <ChevronRight className="h-3.5 w-3.5 text-brand-muted" aria-hidden />
                    </span>
                  </Link>
                ))
              )}
            </Section>
            {d.days.length > 0 && (
              <p className="text-[12.5px] text-brand-muted">
                Orders in this hour on {d.days.length} of {rangeDays(d.range)} days · tap a day to open its orders
              </p>
            )}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
      <span className="min-w-0 truncate text-brand-ink">{label}</span>
      <span className="shrink-0 tabular-nums text-brand-ink">{value}</span>
    </div>
  );
}
