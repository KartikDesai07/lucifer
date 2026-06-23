"use client";

import type { Ref } from "react";

import { CAFE_TIMEZONE, SETTLEMENT_PAY_MODES } from "@/lib/constants";
import { inr } from "@/lib/utils";
import type { Order, OrderSummary, Settings } from "@/types";

const FALLBACK_NAME = "Lucifer Cafe";

function fmtDateTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

function fmtTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CAFE_TIMEZONE,
  });
}

const itemCount = (o: Order) => o.items.reduce((n, it) => n + it.qty, 0);

interface EndOfDaySummaryProps {
  summary?: OrderSummary | null;
  // ALL still-open (Unpaid) tabs, not just today's — anything unsettled needs
  // clearing before close. Distinct from the dashboard's today-only KPI.
  openTabs: Order[];
  settings?: Settings | null;
  dateLabel: string; // cafe-local business date being closed (formatted)
  ref?: Ref<HTMLDivElement>;
}

// 80mm thermal end-of-day report (~300px, monospace, black-only). Rendered
// off-screen and cloned by react-to-print, like OrderReceipt/KOTReceipt.
export function EndOfDaySummary({
  summary,
  openTabs,
  settings,
  dateLabel,
  ref,
}: EndOfDaySummaryProps) {
  const name = settings?.restaurantName?.trim() || FALLBACK_NAME;
  const heldTotal = openTabs.reduce((sum, o) => sum + o.total, 0);

  return (
    <div
      ref={ref}
      className="w-[300px] bg-white p-3 font-mono text-[12px] text-black"
    >
      <div className="text-center">
        <div className="text-base font-bold tracking-wide">{name}</div>
        <div className="text-[11px] font-semibold">END OF DAY</div>
        <div className="text-[10px]">{dateLabel}</div>
      </div>

      <Divider />

      <SectionTitle>Sales (completed)</SectionTitle>
      <Line label="Orders served" value={String(summary?.totalOrders ?? 0)} />
      <Line label="Gross sales" value={inr(summary?.totalSales ?? 0)} />
      <Line label="Collected" value={inr(summary?.collected ?? 0)} />

      <Divider />

      <SectionTitle>Payments collected</SectionTitle>
      {SETTLEMENT_PAY_MODES.map((mode) => {
        const stat = summary?.paymentBreakdown?.[mode];
        return (
          <Line
            key={mode}
            label={`${mode} (${stat?.count ?? 0})`}
            value={inr(stat?.amount ?? 0)}
          />
        );
      })}

      <Divider />

      <SectionTitle>Outstanding</SectionTitle>
      <Line
        label={`Dues (${summary?.outstandingDues.customers ?? 0} cust.)`}
        value={inr(summary?.outstandingDues.total ?? 0)}
      />

      <Divider />

      <SectionTitle>Open tabs (unsettled)</SectionTitle>
      {openTabs.length === 0 ? (
        <div className="text-[11px]">None — all tabs settled.</div>
      ) : (
        <>
          {openTabs.map((o) => (
            <div key={o._id} className="mt-1">
              <div className="flex justify-between">
                <span className="pr-2">{o.orderId}</span>
                <span>{inr(o.total)}</span>
              </div>
              <div className="pl-2 text-[10px]">
                {o.tableNo ?? "Walk-In"} · {itemCount(o)} item
                {itemCount(o) === 1 ? "" : "s"} · opened {fmtTime(o.createdAt)}
              </div>
            </div>
          ))}
          <div className="mt-1 flex justify-between text-[11px] font-bold">
            <span>{openTabs.length} open · held</span>
            <span>{inr(heldTotal)}</span>
          </div>
        </>
      )}

      <Divider />

      <div className="text-center text-[9px]">
        Printed {fmtDateTime(new Date())}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="whitespace-pre">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold underline">{children}</div>;
}

function Divider() {
  return <div className="my-1 border-t border-dashed border-black" />;
}
