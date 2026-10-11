"use client";

import { REWARD_DAYS_MAX, REWARD_DAYS_MIN, type RewardSlot } from "@pos/shared/reward-levels";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { requiredNumber } from "@/lib/reward-levels-form";

interface RewardTtlFieldsProps {
  slot: Pick<RewardSlot, "scratchDays" | "useDays">;
  scratchError: string | null;
  useError: string | null;
  onChange: (patch: Partial<Pick<RewardSlot, "scratchDays" | "useDays">>) => void;
}

// The box's two clocks: how long the diner has to scratch the card, then how long to use what it revealed.
export function RewardTtlFields({ slot, scratchError, useError, onChange }: RewardTtlFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <RewardNumberField
        label="Days to scratch the card"
        value={slot.scratchDays}
        min={REWARD_DAYS_MIN}
        max={REWARD_DAYS_MAX}
        error={scratchError}
        hint="After this the card is gone unscratched."
        onText={(text) => onChange({ scratchDays: requiredNumber(text) })}
      />
      <RewardNumberField
        label="Days to use the reward"
        value={slot.useDays}
        min={REWARD_DAYS_MIN}
        max={REWARD_DAYS_MAX}
        error={useError}
        hint="Counted from the day the diner scratches it."
        onText={(text) => onChange({ useDays: requiredNumber(text) })}
      />
    </div>
  );
}
