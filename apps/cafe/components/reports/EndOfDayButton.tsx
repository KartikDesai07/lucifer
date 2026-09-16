"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";

import { useOrders, useOrderSummary } from "@/hooks/use-orders";
import { useSettings } from "@/hooks/use-settings";
import { effectiveSummaryDate } from "@/lib/summary-date";
import { cafeDateString } from "@/lib/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { slipPrintOptions } from "@/lib/desktop-shell";
import { RECEIPT_PAGE_STYLE } from "@/lib/print";
import { eodPrintJob } from "@/lib/print-routing";
import { useHostRouting } from "@/hooks/use-print-routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EndOfDaySummary } from "@/components/reports/EndOfDaySummary";

// A routed print's local fallback fires only once the enqueue has answered, and
// the off-screen summary it clones always shows whatever the CURRENT date's
// queries hold — including a zeroed body while a freshly-picked day is still
// loading. Unguarded, a deferred fallback would put another day's figures on
// paper under the tapped day's title, which for a cash-reconciliation slip is
// the worst kind of wrong. Refuse and say so instead.
const PRINT_DAY_CHANGED_MESSAGE =
  "The date moved on before that slip could print here — pick the day again and print.";

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
  // This button fires its own print trigger straight from onClick, so it is an
  // independent print site: without this it would keep printing on the tapping
  // device even while a print host owns every other slip (§B5 carve-out).
  // `enqueuePending` (PH-8 MUST): the eod payload is jobKey-less and the routed
  // lane is silent on "queued", so an un-disabled button double-taps into two
  // closing slips at the counter.
  const { routePrint, enqueuePending } = useHostRouting();

  const ref = useRef<HTMLDivElement>(null);
  const print = useReactToPrint(slipPrintOptions({
    contentRef: ref,
    documentTitle: `EOD-${effectiveDate}`,
    pageStyle: RECEIPT_PAGE_STYLE,
  }));

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

  // With a print host configured the closing slip comes out at the counter
  // rather than on the device that tapped it. The payload carries only the day
  // — its key and its label — because this slip is a LIVE aggregate over that
  // day's orders and the still-open tabs, so the host recomputes every figure
  // itself instead of trusting a snapshot taken here (§B1). routePrint enqueues
  // in that case and calls the local trigger only when this device must print
  // it after all; exactly one of the two ever runs.
  // What this button would print RIGHT NOW, readable from a callback that runs
  // after an await (the handler's own closure holds the day as it was at TAP
  // time, which is what this is compared against).
  // A LAYOUT effect, not a passive one: the passive flush is a scheduler task,
  // so the enqueue's promise continuation can slip between the commit that put
  // another day's figures in the print DOM and the mirror catching up.
  const shownDayRef = useRef({ dateKey: effectiveDate, ready });
  useLayoutEffect(() => {
    shownDayRef.current = { dateKey: effectiveDate, ready };
  }, [effectiveDate, ready]);

  const printEod = () => {
    // On the no-host lane routePrint calls this SYNCHRONOUSLY inside the click
    // tick, where the guard is trivially true — today's local path is unchanged
    // (§F). `ready` is re-asserted, not just trusted from the disabled button:
    // it gates the tap, never the deferred print behind it.
    const localPrint = () => {
      const shown = shownDayRef.current;
      if (shown.dateKey === effectiveDate && shown.ready) {
        print();
        return;
      }
      toast.error(PRINT_DAY_CHANGED_MESSAGE);
    };
    routePrint(() => eodPrintJob({ dateKey: effectiveDate, dateLabel }), localPrint);
  };

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
          onClick={printEod}
          disabled={!ready || enqueuePending}
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
