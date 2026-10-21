// Why a new file: PaymentModal.tsx was over the ~300-line budget; the bill
// summary card (and its row) moved here verbatim, plus the F8 "bill changed
// while this was open" line.
//
// U1 Task 9 (design 6.11; values 5.5 in docs/superpowers/specs/2026-10-20-pos-html-values.md): our bill rows as the
// HTML's 13px rows (--text-2, the amounts in --text, a discount in --ok-i), always shown here (payment is the final
// check); the total is the sheet's 36px "Amount to collect" above, so it is no row of its own. The bill-changed line is
// the HTML's note box in its warn tone.

import { discountLineLabel } from "@pos/shared/utils";
import type { OrderCharge } from "@pos/shared/order-charges";
import type { DiscountKind } from "@/lib/constants";
import { POS_BILL_ROW_CLASS, POS_BILL_VALUE_CLASS } from "@/lib/pos-layout";
import { inr } from "@/lib/utils";
import { noticeBoxClass } from "@/components/pos/WriteNotice";

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
      <div data-ui="pay-bill" className="flex flex-col gap-[5px] text-[13px] text-muted-foreground">
        <Row label="Subtotal" value={inr(subtotal)} />
        {discount > 0 && (
          <Row label={discountLineLabel(discountKind)} value={`−${inr(discount)}`} discount />
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
      </div>
      {billChangedFrom !== undefined && (
        <p role="status" data-ui="pay-bill-changed" className={noticeBoxClass("warn")}>
          The bill changed from {inr(billChangedFrom)} to {inr(total)} while this was open. Check the amount before you confirm.
        </p>
      )}
    </>
  );
}

function Row({
  label,
  value,
  discount,
}: {
  label: string;
  value: string;
  discount?: boolean;
}) {
  return (
    <div className={POS_BILL_ROW_CLASS}>
      <span className="min-w-0 truncate" title={label}>{label}</span>
      <span className={discount ? "whitespace-nowrap text-status-ok-ink" : POS_BILL_VALUE_CLASS}>{value}</span>
    </div>
  );
}
