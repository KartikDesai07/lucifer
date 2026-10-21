// Why a new file (U1 Task 9): PaymentModal.tsx is at its ~300-line budget; Cash and Online's amount moved here in the
// owner's HTML (values 11.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.11): "Amount received" and
// ONE 44px field ("₹" + the amount, right-aligned), today's partial-payment line where the HTML's "Short by" line sits
// (both modes accept a partial collection; the shortfall becomes a due), and for Cash the HTML's "Change to return" row.
// No quick amounts (owner Q14). The values and their rules stay in PaymentModal.

import { inr } from "@/lib/utils";
import {
  PAYMENT_CHANGE_LABEL,
  PAY_BLOCK_CLASS,
  PAY_CAPTION_CLASS,
  PAY_CHANGE_LABEL_CLASS,
  PAY_CHANGE_ROW_CLASS,
  PAY_CHANGE_VALUE_CLASS,
  PAY_FIELD_CLASS,
  PAY_FIELD_INPUT_CLASS,
  PAY_FIELD_PREFIX_CLASS,
  PAY_PARTIAL_CLASS,
} from "@/lib/payment-sheet";

interface PaymentCollectFieldsProps {
  /** Cash shows the change to return; Online does not. */
  showChange: boolean;
  collected: number;
  onCollectedChange: (amount: number) => void;
  change: number;
  /** What stays unpaid (0 = paid in full or more). */
  remainder: number;
  customerName: string | undefined;
  /** In flight or frozen on an unconfirmed sale. */
  disabled: boolean;
}

export function PaymentCollectFields({
  showChange,
  collected,
  onCollectedChange,
  change,
  remainder,
  customerName,
  disabled,
}: PaymentCollectFieldsProps) {
  return (
    <>
      <div data-ui="pay-received" className={PAY_BLOCK_CLASS}>
        <label htmlFor="amount-received" className={PAY_CAPTION_CLASS}>Amount received</label>
        <div data-ui="pay-received-field" className={PAY_FIELD_CLASS}>
          <span aria-hidden="true" className={PAY_FIELD_PREFIX_CLASS}>₹</span>
          <input
            id="amount-received"
            type="number"
            min={0}
            placeholder="0"
            disabled={disabled}
            value={collected === 0 ? "" : collected}
            onChange={(e) => onCollectedChange(Math.max(0, Number(e.target.value) || 0))}
            className={PAY_FIELD_INPUT_CLASS}
          />
        </div>
        {remainder > 0 && (
          <p data-ui="pay-partial" className={PAY_PARTIAL_CLASS}>
            {inr(remainder)} unpaid — added to {customerName ?? "the customer"}&apos;s dues.
          </p>
        )}
      </div>
      {showChange && (
        <div data-ui="pay-change" className={PAY_CHANGE_ROW_CLASS}>
          <span className={PAY_CHANGE_LABEL_CLASS}>{PAYMENT_CHANGE_LABEL}</span>
          <span data-ui="pay-change-value" className={PAY_CHANGE_VALUE_CLASS}>{inr(change)}</span>
        </div>
      )}
    </>
  );
}
