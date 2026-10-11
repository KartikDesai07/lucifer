"use client";

import { slotCost } from "@pos/shared/reward-levels-view";
import type { RewardSlot } from "@pos/shared/reward-levels";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { inr } from "@/lib/utils";
import { optionalNumber } from "@/lib/reward-levels-form";

interface RewardCostPreviewProps {
  slot: Pick<RewardSlot, "options">;
  /** The example bill in rupees. Lives in the section, is never saved; NaN while the field is blank. */
  exampleBill: number;
  onExampleBillChange: (bill: number) => void;
  priceOf: (productId: string) => number | undefined;
}

// A whole-rupee amount reads as ₹20; a part-rupee one keeps its paise (₹7.50) so an average is never rounded away.
const rupees = (amount: number): string => (Number.isInteger(amount) ? inr(amount) : `₹${amount.toFixed(2)}`);

const NO_PRICE_NOTE = "We couldn't find an item's price, so it counts as ₹0.";
const FILL_IN_NOTE = "Fill in the rewards above to see what this box costs.";
const SIZED_ITEM_NOTE = "For an item sold in sizes, its dearest size is used.";
const NEED_BILL_NOTE = "Enter an example bill to see what this box costs.";
const PRODUCT_KINDS: ReadonlySet<string> = new Set(["product-percent", "free-item"]);

// "Average ₹A, at most ₹W per card on a ₹B bill" — what a card from this box costs the cafe, from the settings alone.
export function RewardCostPreview({ slot, exampleBill, onExampleBillChange, priceOf }: RewardCostPreviewProps) {
  const billOk = Number.isFinite(exampleBill) && exampleBill >= 0;
  const cost = billOk ? slotCost(slot, { exampleBill, priceOf }) : null;
  const known = cost !== null && Number.isFinite(cost.avg) && Number.isFinite(cost.worst);
  const usesItems = slot.options.some((option) => PRODUCT_KINDS.has(option.kind));

  return (
    <div className="space-y-3 rounded-lg border border-brand-rule bg-brand-wash p-3 sm:p-4" aria-live="polite">
      <p className="text-sm font-semibold text-brand-ink">What this box costs you</p>
      <RewardNumberField
        label="Example bill (₹)"
        value={Number.isFinite(exampleBill) ? exampleBill : undefined}
        min={0}
        onText={(text) => onExampleBillChange(optionalNumber(text) ?? Number.NaN)}
        hint="Only used for this estimate. It is not saved."
      />
      {!billOk ? (
        <p className={HINT_CLASS}>{NEED_BILL_NOTE}</p>
      ) : !known || cost === null ? (
        <p className={HINT_CLASS}>{FILL_IN_NOTE}</p>
      ) : (
        <>
          <p className="text-sm text-brand-ink">
            {`Average ${rupees(cost.avg)}, at most ${rupees(cost.worst)} per card on a ${rupees(exampleBill)} bill`}
          </p>
          {!cost.priceKnown && <p className={HINT_CLASS}>{NO_PRICE_NOTE}</p>}
          {cost.priceKnown && usesItems && <p className={HINT_CLASS}>{SIZED_ITEM_NOTE}</p>}
        </>
      )}
    </div>
  );
}
