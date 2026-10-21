// Why a new file: PaymentModal.tsx was over the ~300-line budget; the Split
// mode's Cash + Online inputs moved here, holding one `split` object (F8).
//
// U1 Task 9 (values 11.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.11): the HTML's split block —
// its caption (our words: cash and online), the two boxes (Cash with the --accent rule, Online on --surface-2), both
// editable as today, and today's "must equal" line where the HTML's quick split buttons sit (owner Q14: none).

import { useId, type Dispatch, type SetStateAction } from "react";

import type { SplitAmounts } from "@/lib/payment-result";
import { inr, cn } from "@/lib/utils";
import {
  PAY_BLOCK_CLASS,
  PAY_CAPTION_CLASS,
  PAY_SPLIT_AMOUNT_CLASS,
  PAY_SPLIT_BOX_CLASS,
  PAY_SPLIT_CASH_CLASS,
  PAY_SPLIT_GRID_CLASS,
  PAY_SPLIT_INPUT_CLASS,
  PAY_SPLIT_LABEL_CLASS,
  PAY_SPLIT_ONLINE_CLASS,
  PAY_SPLIT_SUM_BAD_CLASS,
  PAY_SPLIT_SUM_CLASS,
} from "@/lib/payment-sheet";

interface PaymentSplitFieldsProps {
  split: SplitAmounts;
  onSplitChange: Dispatch<SetStateAction<SplitAmounts>>;
  total: number;
  mismatch: boolean;
  disabled: boolean;
}

const amountOf = (raw: string) => Math.max(0, Number(raw) || 0);

export function PaymentSplitFields({ split, onSplitChange, total, mismatch, disabled }: PaymentSplitFieldsProps) {
  const captionId = useId();
  return (
    <div data-ui="pay-split" role="group" aria-labelledby={captionId} className={PAY_BLOCK_CLASS}>
      <span id={captionId} className={PAY_CAPTION_CLASS}>Split between cash and online</span>
      <div className={PAY_SPLIT_GRID_CLASS}>
        <div data-ui="pay-split-cash" className={cn(PAY_SPLIT_BOX_CLASS, PAY_SPLIT_CASH_CLASS)}>
          <label htmlFor="split-cash" className={PAY_SPLIT_LABEL_CLASS}>Cash</label>
          <span className={PAY_SPLIT_AMOUNT_CLASS}>
            <span aria-hidden="true">₹</span>
            <input
              id="split-cash"
              type="number"
              min={0}
              placeholder="0"
              disabled={disabled}
              value={split.cash === 0 ? "" : split.cash}
              onChange={(e) => {
                const cash = amountOf(e.target.value);
                onSplitChange((s) => ({ ...s, cash }));
              }}
              className={PAY_SPLIT_INPUT_CLASS}
            />
          </span>
        </div>
        <div data-ui="pay-split-online" className={cn(PAY_SPLIT_BOX_CLASS, PAY_SPLIT_ONLINE_CLASS)}>
          <label htmlFor="split-online" className={PAY_SPLIT_LABEL_CLASS}>Online</label>
          <span className={PAY_SPLIT_AMOUNT_CLASS}>
            <span aria-hidden="true">₹</span>
            <input
              id="split-online"
              type="number"
              min={0}
              placeholder="0"
              disabled={disabled}
              value={split.online === 0 ? "" : split.online}
              onChange={(e) => {
                const online = amountOf(e.target.value);
                onSplitChange((s) => ({ ...s, online }));
              }}
              className={PAY_SPLIT_INPUT_CLASS}
            />
          </span>
        </div>
      </div>
      <p data-ui="pay-split-sum" className={cn(PAY_SPLIT_SUM_CLASS, mismatch && PAY_SPLIT_SUM_BAD_CLASS)}>
        Cash + Online = {inr(split.cash + split.online)} (must equal {inr(total)})
      </p>
    </div>
  );
}
