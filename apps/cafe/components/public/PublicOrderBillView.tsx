import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  DINER_CANCELLED_REASON,
  publicOrderStatusPath,
  type PublicGstConfig,
  type PublicOrderRequestStatusData,
} from "@pos/shared/public";
import { billFromStatusData } from "@/components/public/public-bill-rows";
import { PublicBillRows } from "@/components/public/PublicBillRows";
import { PublicStatusChip, isActiveOrderStatus } from "@/components/public/PublicStatusChip";
import { PublicStatusTimeline } from "@/components/public/PublicStatusTimeline";
import { Button, buttonVariants } from "@/components/ui/button";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PUB_SCREEN_TITLE_CLASS, PUB_SECTION_HEADING_CLASS, PUB_EYEBROW_CLASS, PUB_TONAL_CARD_CLASS, PUB_PILL_BUTTON_CLASS } from "@/components/public/public-ui";
import { cn } from "@/lib/utils";

// CB-6D-B (rewritten CB-6C) — the read-only receipt for a PAST order, shown
// from "My Orders" (Home vocabulary: calm whitespace, ONE primary action per
// screen — Track / Order again, never both). This is a RECEIPT, not the
// cart: no form controls, no note Input, no honeypot. PublicCartBill.tsx is
// the pre-submit FORM (kitchen note, identity, honeypot) and must not be
// reused here.
//
// `gst` is taken as a PROP rather than fetched here: PublicMyOrdersTab does
// not fetch the menu itself, and adding a second menu fetch just for this
// view would duplicate a request the shell already makes to render the menu
// tab. The shell is expected to thread its existing gst config down through
// PublicMyOrdersTab into this view.
interface PublicOrderBillViewProps {
  data: PublicOrderRequestStatusData;
  gst: PublicGstConfig;
  orderingAllowed: boolean;
  onRepeat: (items: PublicOrderRequestStatusData["items"]) => void;
}

// F5 (CB-6D-B review fix, LOW) — the bare toLocaleString() printed seconds
// and a slash-style date ("22/9/2026, 2:32:05 am"). Named format options
// drop the seconds and read as a short month name instead ("22 Sept, 02:32
// am"), matching PublicOrderRow's own HH:MM-in-viewer-clock read.
const ORDER_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

// Same date/time read as PublicOrderRow's own — this is "when did I order",
// the viewer's own clock, not a cafe-timezone calendar fact.
function orderDateTime(createdAt: string): string {
  return new Date(createdAt).toLocaleString([], ORDER_DATE_TIME_FORMAT);
}

export function PublicOrderBillView({ data, gst, orderingAllowed, onRepeat }: PublicOrderBillViewProps) {
  const { lines, totals } = billFromStatusData(data, gst);
  const locationLine = data.parcel ? "Parcel" : data.tableLabel;
  const active = isActiveOrderStatus(data.status);

  return (
    <div className="space-y-6">
      <div>
        <PublicStatusChip status={data.status} className="px-3 py-1.5 text-sm" />
        <p className={cn(PUB_SCREEN_TITLE_CLASS, "mt-3")}>Order #{data.shortCode}</p>
        <p className="text-sm text-muted-foreground">
          {locationLine ? `${locationLine} · ` : ""}
          {orderDateTime(data.createdAt)}
        </p>
      </div>

      {data.status === "rejected" ? (
        <div className="rounded-3xl bg-destructive/10 p-5 text-destructive">
          <p className="flex items-center gap-2 text-base font-medium">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {data.rejectedReason === DINER_CANCELLED_REASON
              ? "You cancelled this order"
              : "The cafe couldn't take this order"}
          </p>
          {data.rejectedReason && data.rejectedReason !== DINER_CANCELLED_REASON && (
            <p className="mt-1 text-sm">{data.rejectedReason}</p>
          )}
        </div>
      ) : (
        <PublicStatusTimeline
          status={data.status}
          acceptedAt={data.acceptedAt}
          className={cn(PUB_TONAL_CARD_CLASS, "border-0 p-5")}
        />
      )}

      <div>
        <p className={PUB_SECTION_HEADING_CLASS}>Your bill</p>
        <div className={cn(PUB_TONAL_CARD_CLASS, "mt-3")}>
          <PublicBillRows lines={lines} totals={totals} />
        </div>
      </div>

      {data.note && (
        <div className={cn(PUB_TONAL_CARD_CLASS, "p-5")}>
          <p className={PUB_EYEBROW_CLASS}>Your note</p>
          <p className="mt-1 text-base">{data.note}</p>
        </div>
      )}

      {active ? (
        <Link
          href={publicOrderStatusPath(data.shortCode)}
          className={cn(buttonVariants(), PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
        >
          Track this order
        </Link>
      ) : (
        orderingAllowed &&
        data.items.length > 0 && (
          <Button
            className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS)}
            onClick={() => onRepeat(data.items)}
          >
            Order this again
          </Button>
        )
      )}
    </div>
  );
}
