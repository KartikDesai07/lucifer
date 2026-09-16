import type { PublicGstConfig, PublicOrderRequestStatusData } from "@pos/shared/public";
import { billFromStatusData } from "@/components/public/public-bill-rows";
import { PublicBillRows } from "@/components/public/PublicBillRows";
import { Button } from "@/components/ui/button";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";

// S8 — the read-only bill for a PAST order, shown from "My Orders". This is a
// RECEIPT, not the cart: no form controls, no note Input, no honeypot.
// PublicCartBill.tsx is the pre-submit FORM (kitchen note, identity,
// honeypot) and must not be reused here.
//
// `gst` is taken as a PROP rather than fetched here: PublicMyOrdersTab does
// not currently fetch the menu, and adding a second menu fetch just for this
// view would duplicate a request the shell already makes to render the menu
// tab. The shell is expected to thread its existing gst config down through
// PublicMyOrdersTab into this view.
interface PublicOrderBillViewProps {
  data: PublicOrderRequestStatusData;
  gst: PublicGstConfig;
  orderingAllowed: boolean;
  onRepeat: (items: PublicOrderRequestStatusData["items"]) => void;
}

// EXHAUSTIVE by construction, same discipline as PublicMyOrdersTab's own copy
// — a new status fails tsc here rather than rendering a raw enum to a diner.
const STATUS_WORDS: Record<PublicOrderRequestStatusData["status"], string> = {
  pending: "Waiting for the counter",
  accepting: "Being prepared",
  accepted: "Accepted",
  rejected: "Cancelled",
};

export function PublicOrderBillView({ data, gst, orderingAllowed, onRepeat }: PublicOrderBillViewProps) {
  const { lines, totals } = billFromStatusData(data, gst);
  const locationLine = data.parcel
    ? "Parcel"
    : data.tableLabel
      ? data.tableLabel
      : null;

  return (
    <div className="space-y-pub-gap">
      <div className="space-y-1 rounded-lg border p-pub-pad">
        <p className="text-sm font-medium">{STATUS_WORDS[data.status]}</p>
        <p className="text-xs text-muted-foreground">Order #{data.shortCode}</p>
        {locationLine && <p className="text-xs text-muted-foreground">{locationLine}</p>}
        <p className="text-xs text-muted-foreground">
          {new Date(data.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="rounded-lg border">
        <PublicBillRows lines={lines} totals={totals} />
      </div>

      {data.note && (
        <div className="rounded-lg border p-pub-pad">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Your note</p>
          <p className="text-sm">{data.note}</p>
        </div>
      )}

      {orderingAllowed && data.items.length > 0 && (
        <Button className={`w-full ${PUBLIC_TOUCH_TARGET_CLASS}`} onClick={() => onRepeat(data.items)}>
          Order this again
        </Button>
      )}
    </div>
  );
}
