"use client";

import { LOYALTY_REWARD_KINDS, type LoyaltyRewardKind } from "@pos/shared/public-diner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";

// The stamp card's reward kind as a pick-one dropdown, split out of MilestoneRewardFields.tsx to keep that file
// under the size cap (s89h). The milestone row renders it inside its kind Controller.

const STAMP_REWARD_KIND_LABELS: Record<LoyaltyRewardKind, string> = {
  flat: "Amount off",
  percent: "Percent off",
  item: "Free item",
};

// 44 px rows on a touch screen, the house Select idiom (ExpenseFormFields.tsx).
const KIND_ITEM_CLASS = "pointer-coarse:min-h-11";

// The form types a row's kind as a plain string; the Select needs the union.
export function isRewardKind(value: unknown): value is LoyaltyRewardKind {
  return LOYALTY_REWARD_KINDS.some((k) => k === value);
}

// The reward kind as a pick-one dropdown (owner rule: pick-one = dropdown; it was three chips). Every kind is
// offered, in the schema's order, under its plain label. Radix hands back a plain string, so a value that is
// not a kind is ignored rather than cast.
export function RewardKindSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LoyaltyRewardKind;
  onChange: (next: LoyaltyRewardKind) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isRewardKind(next)) onChange(next);
      }}
    >
      <SelectTrigger id={id} className={BRAND_CONTROL_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOYALTY_REWARD_KINDS.map((k) => (
          <SelectItem key={k} value={k} className={KIND_ITEM_CLASS}>
            {STAMP_REWARD_KIND_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
