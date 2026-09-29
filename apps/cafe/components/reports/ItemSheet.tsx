"use client";

import { RotateCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { inr, cn } from "@/lib/utils";
import { sharePercent } from "@/lib/dashboard/format";
import { rangeDays } from "@/lib/dashboard/range";
import { useItemDetail } from "@/hooks/use-reports";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DashboardRange } from "@/types/dashboard";
import type { ItemSalesRow } from "@/types/reports";

// One item's drill-down (Batch 2), opened from the Items & categories chart or
// table. Same shell as DaySheet: right on desktop, bottom on a phone.

interface ItemSheetProps {
  item: ItemSalesRow | null;
  range: DashboardRange;
  onOpenChange: (open: boolean) => void;
}

export function ItemSheet({ item, range, onOpenChange }: ItemSheetProps) {
  const isMobile = useIsMobile();
  const detail = useItemDetail(range, item);
  // useItemDetail keeps the previous result while a new key loads — here that
  // would be ANOTHER item's figures under this item's title. Only this item's
  // data, for this exact range, counts (memory: keepPreviousData detail view
  // must match the echoed identity).
  const d =
    detail.data && item && detail.data.key === item.key && detail.data.range.from === range.from && detail.data.range.to === range.to
      ? detail.data
      : undefined;

  // ItemDetail.points already omits qty-0 buckets (contract comment) — its
  // length IS "days it sold on"; the range's own day count is the "of M".
  const daysWithSales = d?.points.length ?? 0;
  const totalDays = d ? rangeDays(d.range) : 0;

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{item?.label ?? "Item details"}</SheetTitle>
          {item && <p className="text-[12.5px] text-brand-muted">{item.categoryName}</p>}
        </SheetHeader>

        {detail.isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load this item. It will try again on its own.</p>
            <button
              type="button"
              onClick={() => void detail.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          </div>
        ) : !d || !item ? (
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
              <Figure label="Sold" value={String(item.qty)} />
              <Figure label="Sales" value={inr(item.sales)} />
              <Figure label="Share of sales" value={sharePercent(item.share)} />
            </div>

            {(item.freeQty > 0 || d.removed.qty > 0) && (
              <Section title="Given away & taken back">
                {item.freeQty > 0 && <Row label="Given free as rewards" value={String(item.freeQty)} />}
                {d.removed.qty > 0 && <Row label="Taken back (voided)" value={`${d.removed.qty} · ${inr(d.removed.value)}`} />}
              </Section>
            )}

            <Section title={d.mode === "hour" ? "By hour" : "By day"}>
              {d.points.length === 0 ? (
                <p className="py-3 text-[13px] text-brand-muted">No sales for this item in the period.</p>
              ) : (
                d.points.map((p) => <Row key={p.key} label={p.label} value={`${p.qty} · ${inr(p.sales)}`} />)
              )}
            </Section>

            {d.mode === "day" && (
              <p className="text-[12.5px] text-brand-muted">
                Sold on {daysWithSales} of {totalDays} days
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-[13.5px]", strong && "font-semibold")}>
      <span className="min-w-0 truncate text-brand-ink">{label}</span>
      <span className="shrink-0 tabular-nums text-brand-ink">{value}</span>
    </div>
  );
}
