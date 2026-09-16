"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  LOYALTY_CLAIM_WITHIN_DAYS_MIN,
  LOYALTY_CLAIM_WITHIN_DAYS_MAX,
} from "@pos/shared/loyalty-rules";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/settings/SettingsFields";
import { rowFieldMessage } from "@/components/settings/MilestoneRewardFields";

// CB-5D — split out of MilestoneRewardFields.tsx to stay under the ~300-line
// cap: these two controls are the "promo minting" concern (a code and its
// claim-by TTL), separate from the reward-SHAPE concern (kind/value/item/qty)
// the parent still owns. Same row, same caller, same error plumbing — just a
// second component so the parent keeps its own budget.
interface MilestoneRewardCodeFieldsProps {
  control: Control<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
}

export function MilestoneRewardCodeFields({ control, errors, index }: MilestoneRewardCodeFieldsProps) {
  return (
    <>
      <Field
        label="Promo code"
        error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "promoCode")}
        hint="Created now, before any diner reaches this box — handed to the diner only when they claim the reward."
      >
        {/* CB-5D — minted at CONFIG time, not claim time (owner decision): the
            code exists in Settings' own promo list the moment this is saved,
            and claiming a reward only ASSIGNS the already-existing code to
            that customer. Uppercased to match PROMO_CODE_PATTERN and the
            promo list's own convention. */}
        <Controller
          control={control}
          name={`loyaltyRules.milestones.${index}.promoCode`}
          render={({ field }) => (
            <Input
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
              maxLength={16}
              placeholder="SAVE10"
            />
          )}
        />
      </Field>

      <Field
        label="Claim within (days)"
        error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "claimWithinDays")}
        hint="Leave blank for no deadline"
      >
        {/* How long after EARNING this rung a diner may still claim it —
            distinct from the promo code's own validity once claimed. */}
        <Controller
          control={control}
          name={`loyaltyRules.milestones.${index}.claimWithinDays`}
          render={({ field }) => (
            <Input
              type="number"
              min={LOYALTY_CLAIM_WITHIN_DAYS_MIN}
              max={LOYALTY_CLAIM_WITHIN_DAYS_MAX}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          )}
        />
      </Field>
    </>
  );
}
