// Why a new file: PaymentModal.tsx was over the ~300-line budget; the Split
// mode's Cash + Online inputs moved here, holding one `split` object (F8).

import type { Dispatch, SetStateAction } from "react";

import type { SplitAmounts } from "@/lib/payment-result";
import { inr, cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PaymentSplitFieldsProps {
  split: SplitAmounts;
  onSplitChange: Dispatch<SetStateAction<SplitAmounts>>;
  total: number;
  mismatch: boolean;
  disabled: boolean;
}

const amountOf = (raw: string) => Math.max(0, Number(raw) || 0);

export function PaymentSplitFields({ split, onSplitChange, total, mismatch, disabled }: PaymentSplitFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="split-cash">Cash</Label>
        <Input
          id="split-cash"
          type="number"
          min={0}
          disabled={disabled}
          value={split.cash === 0 ? "" : split.cash}
          onChange={(e) => {
            const cash = amountOf(e.target.value);
            onSplitChange((s) => ({ ...s, cash }));
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="split-online">Online</Label>
        <Input
          id="split-online"
          type="number"
          min={0}
          disabled={disabled}
          value={split.online === 0 ? "" : split.online}
          onChange={(e) => {
            const online = amountOf(e.target.value);
            onSplitChange((s) => ({ ...s, online }));
          }}
        />
      </div>
      <p
        className={cn(
          "col-span-2 text-xs",
          mismatch ? "text-destructive" : "text-muted-foreground",
        )}
      >
        Cash + Online = {inr(split.cash + split.online)} (must equal {inr(total)})
      </p>
    </div>
  );
}
