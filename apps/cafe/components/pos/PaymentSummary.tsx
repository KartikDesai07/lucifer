// Why a new file: PaymentModal.tsx was over the ~300-line budget; the bill
// summary card (and its row) moved here verbatim, plus the F8 "bill changed
// while this was open" line.

import { discountLineLabel } from "@pos/shared/utils";
import type { OrderCharge } from "@pos/shared/order-charges";
import type { DiscountKind } from "@/lib/constants";
import { inr, cn } from "@/lib/utils";

interface PaymentSummaryProps {
  subtotal: number;
  discount: number;
  discountKind?: DiscountKind;
  gstAmount: number;
  gstRate?: number;
  charge: number;
  chargeLabel?: string;
  charges: OrderCharge[];
  total: number;
  /** The total the popup opened with, when the bill has since moved. */
  billChangedFrom?: number;
}

export function PaymentSummary({
  subtotal,
  discount,
  discountKind,
  gstAmount,
  gstRate,
  charge,
  chargeLabel,
  charges,
  total,
  billChangedFrom,
}: PaymentSummaryProps) {
  return (
    <>
      <div className="space-y-1 rounded-lg border p-3 text-sm">
        <Row label="Subtotal" value={inr(subtotal)} />
        {discount > 0 && (
          <Row label={discountLineLabel(discountKind)} value={`−${inr(discount)}`} muted />
        )}
        {gstAmount > 0 && (
          <Row
            label={gstRate ? `GST @${gstRate}%` : "GST"}
            value={`+${inr(gstAmount)}`}
          />
        )}
        {charges.length > 0
          ? charges.map((c, i) => (
              <Row key={`${c.label}-${i}`} label={c.label} value={`+${inr(c.amount)}`} />
            ))
          : charge > 0 && (
              <Row label={chargeLabel || "Table charge"} value={`+${inr(charge)}`} />
            )}
        <div className="flex items-center justify-between border-t pt-1 text-base font-bold">
          <span>Total</span>
          <span>{inr(total)}</span>
        </div>
      </div>
      {billChangedFrom !== undefined && (
        <p role="status" className="rounded-md bg-amber-100 p-2 text-sm font-semibold text-amber-800">
          The bill changed from {inr(billChangedFrom)} to {inr(total)} while this was open. Check the amount before you confirm.
        </p>
      )}
    </>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        muted && "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
