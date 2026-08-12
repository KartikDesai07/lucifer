"use client";

import { useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { CalendarCheck } from "lucide-react";

import { useOrders, useOrderSummary } from "@/hooks/use-orders";
import { useSettings } from "@/hooks/use-settings";
import { effectiveSummaryDate } from "@/lib/summary-date";
import { cafeDateString } from "@/lib/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { RECEIPT_PAGE_STYLE } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EndOfDaySummary } from "@/components/reports/EndOfDaySummary";

// "End of Day" print action for the dashboard — staff-accessible (CR1.5 Slice
// 5): the cashier who took cash during the shift needs to reconcile the
// drawer too, not just an admin. Defaults to today; a past date can be picked
// to reprint an earlier day's closing slip. Self-fetches its own data so the
// dashboard page stays lean.
export function EndOfDayButton() {
  const today = cafeDateString();
  const [date, setDate] = useState(today);
  // Clamp a cleared `<input type="date">` (raw "") back to today — the RAW
  // `date` state still drives the input's own value so the box shows what the
  // user actually typed/cleared; every other derived value below reads ONLY
  // `effectiveDate`, matching what the server does with an absent/"" ?date.
  const effectiveDate = effectiveSummaryDate(date, today);
  const isToday = effectiveDate === today;

  // undefined for today (shares the dashboard's own cache key/entry) — the
  // hook only receives an explicit date for a past-day pick.
  const summary = useOrderSummary(isToday ? undefined : effectiveDate);
  // All still-open tabs (not date-bounded); lift the 50-row cap so the EOD
  // can't under-count what's unsettled. Status-filtered as well as payment-filtered
  // because a cancelled tab keeps its historical "Unpaid" payment — without it the
  // closing slip would report money still owed on a bill that was voided. Only
  // meaningful for TODAY's slip (a past day's still-open tabs aren't "that day's"
  // open tabs), so the query doesn't run at all for a past date.
  const openTabs = useOrders(
    { payment: "Unpaid", status: "Pending", limit: 200 },
    { enabled: isToday },
  );
  const settings = useSettings();

  const ref = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: ref,
    documentTitle: `EOD-${effectiveDate}`,
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  const dateLabel = new Date(effectiveDate).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: CAFE_TIMEZONE,
  });
  // Don't print before the figures load — including the open-tabs query when it
  // runs, so we never print a false "all tabs settled" (isSuccess is true for an
  // empty list, false while loading or on error). A past date skips that gate —
  // the query never runs for it.
  const ready =
    !!summary.data && !!settings.data && (!isToday || openTabs.isSuccess);

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 w-auto"
          aria-label="End of day date"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => print()}
          disabled={!ready}
        >
          <CalendarCheck className="mr-2 h-4 w-4" /> End of day
        </Button>
      </div>

      {/* Off-screen print source — cloned by react-to-print. */}
      <div
        className="pointer-events-none absolute left-[-9999px] top-0"
        aria-hidden
      >
        <EndOfDaySummary
          summary={summary.data}
          openTabs={isToday ? (openTabs.data ?? []) : null}
          settings={settings.data}
          dateLabel={dateLabel}
          ref={ref}
        />
      </div>
    </>
  );
}
