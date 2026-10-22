// Why a new file (U1 Task 9): PaymentModal.tsx is at its ~300-line budget; the HTML's amount block moved here — "Amount
// to collect", the 36px total and the customer pill (values 11.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.11). Where today's picker shows (a new sale, or a tab with no customer) the caller hands it in (CustomerSearch
// draws the pill and opens its own dialog over the payment); on a tab that already has its customer the name stays on
// screen as a read-only "Customer: {name}" (the builder-check answer, design 4); with neither, no pill.

import type { ReactNode } from "react";

import { inr, cn } from "@/lib/utils";
import {
  PAYMENT_AMOUNT_LABEL,
  PAY_AMOUNT_CLASS,
  PAY_AMOUNT_LABEL_CLASS,
  PAY_PILL_CLASS,
  PAY_PILL_READ_CLASS,
  PAY_TOTAL_CLASS,
  readOnlyPillText,
} from "@/lib/payment-sheet";

interface PaymentAmountProps {
  total: number;
  /** The customer on the bill, if any. */
  customerName?: string;
  /** The customer picker, when the customer can be chosen here. */
  picker?: ReactNode;
}

export function PaymentAmount({ total, customerName, picker }: PaymentAmountProps) {
  return (
    <div data-ui="pay-amount" className={PAY_AMOUNT_CLASS}>
      <div data-ui="pay-amount-label" className={PAY_AMOUNT_LABEL_CLASS}>{PAYMENT_AMOUNT_LABEL}</div>
      <div data-ui="pay-total" className={PAY_TOTAL_CLASS}>{inr(total)}</div>
      {picker ??
        (customerName ? (
          <span data-ui="pay-customer" title={customerName} className={cn(PAY_PILL_CLASS, PAY_PILL_READ_CLASS)}>
            {readOnlyPillText(customerName)}
          </span>
        ) : null)}
    </div>
  );
}
