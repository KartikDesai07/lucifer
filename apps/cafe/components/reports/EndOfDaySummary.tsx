"use client";

import type { Ref } from "react";

import { CAFE_TIMEZONE, SETTLEMENT_PAY_MODES, DUES_RECEIPT_MODES } from "@/lib/constants";
import { inr } from "@/lib/utils";
import type { Order, OrderSummary, Settings } from "@/types";

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
  // clearing before close. `null` when the slip is for a PAST date (CR1.5
  // Slice 5) — a past day's open tabs aren't "that day's" open tabs, so the
  // section renders a not-applicable line instead.
  openTabs: Order[] | null;
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
  // Empty when unset — the paper never shows a hardcoded product placeholder
  // brand (per-cafe name comes from Settings only).
  const name = settings?.restaurantName?.trim() ?? "";
  const heldTotal = (openTabs ?? []).reduce((sum, o) => sum + o.total, 0);

  return (
    <div
      ref={ref}
      className="w-[300px] bg-white p-3 font-mono text-[12px] text-black"
    >
      <div className="text-center">
        {name && <div className="text-base font-bold tracking-wide">{name}</div>}
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

      {/* Money taken today against a PRE-EXISTING due (CR1.4) — separate from
          "Collected" above (which stays order-paidAmount-only), so the closing
          cashier can tally the physical drawer without double-counting a bill
          that was both settled and had a due paid the same day. Staff-
          accessible since CR1.5 Slice 5 — the cashier who took this cash can
          now see it. */}
      <SectionTitle>Dues collected</SectionTitle>
      {DUES_RECEIPT_MODES.map((mode) => (
        <Line
          key={mode}
          label={mode}
          value={inr(summary?.duesCollected?.byMode?.[mode] ?? 0)}
        />
      ))}
      <Line
        label={`Total (${summary?.duesCollected?.count ?? 0})`}
        value={inr(summary?.duesCollected?.total ?? 0)}
      />

      <Divider />

      <SectionTitle>Outstanding</SectionTitle>
      <Line
        label={
          // openTabs === null is the established past-date signal (see the
          // prop comment above) — outstandingDues is a live, NOW balance
          // (server comment: not day-scoped), so a past date's slip must say
          // so; the figure itself is accurate as-of-now data, unlike open
          // tabs, so it still prints unqualified for today.
          openTabs === null
            ? `Dues (as of print, ${summary?.outstandingDues.customers ?? 0} cust.)`
            : `Dues (${summary?.outstandingDues.customers ?? 0} cust.)`
        }
        value={inr(summary?.outstandingDues.total ?? 0)}
      />

      <Divider />

      <SectionTitle>Open tabs (unsettled)</SectionTitle>
      {openTabs === null ? (
        <div className="text-[11px]">
          Open tabs: not applicable for a past date.
        </div>
      ) : openTabs.length === 0 ? (
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
