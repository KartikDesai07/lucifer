"use client";

import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { CalendarCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useOrders, useOrderSummary } from "@/hooks/use-orders";
import { useSettings } from "@/hooks/use-settings";
import { cafeDateString } from "@/lib/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { RECEIPT_PAGE_STYLE } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { EndOfDaySummary } from "@/components/reports/EndOfDaySummary";

// Admin-only "End of Day" print action for the dashboard. The summary exposes
// revenue + dues, so it self-hides for non-admins (the dashboard itself is
// all-staff). Self-fetches its own data so the dashboard page stays lean.
export function EndOfDayButton() {
  const { isAdmin } = useAuth();
  const summary = useOrderSummary();
  // All still-open tabs (not date-bounded); lift the 50-row cap so the EOD
  // can't under-count what's unsettled.
  const openTabs = useOrders({ payment: "Unpaid", limit: 200 });
  const settings = useSettings();

  const ref = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: ref,
    documentTitle: `EOD-${cafeDateString()}`,
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  // All hooks are called above this line (rules-of-hooks); only render gates.
  if (!isAdmin) return null;

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: CAFE_TIMEZONE,
  });
  // Don't print before the figures load — including the open-tabs query, so we
  // never print a false "all tabs settled" (isSuccess is true for an empty
  // list, false while loading or on error).
  const ready = !!summary.data && !!settings.data && openTabs.isSuccess;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => print()}
        disabled={!ready}
      >
        <CalendarCheck className="mr-2 h-4 w-4" /> End of day
      </Button>

      {/* Off-screen print source — cloned by react-to-print. */}
      <div
        className="pointer-events-none absolute left-[-9999px] top-0"
        aria-hidden
      >
        <EndOfDaySummary
          summary={summary.data}
          openTabs={openTabs.data ?? []}
          settings={settings.data}
          dateLabel={dateLabel}
          ref={ref}
        />
      </div>
    </>
  );
}
