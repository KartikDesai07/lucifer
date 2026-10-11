"use client";

import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/settings/SettingsFields";
import { numberText } from "@/lib/reward-levels-form";
import { REWARD_FIELD_CLASS } from "@/components/settings/rewards/reward-ui";

interface RewardNumberFieldProps {
  label: string;
  /** NaN / undefined show as blank, never the word "NaN". */
  value: number | undefined;
  /** The raw text; the caller turns it into a number with requiredNumber / optionalNumber. */
  onText: (text: string) => void;
  error?: string | null;
  hint?: string;
  min?: number;
  max?: number;
}

// One labelled whole-number field of the scratch-card editor. A required field left blank is reported by the save
// gate; an optional one is simply absent.
export function RewardNumberField({ label, value, onText, error, hint, min, max }: RewardNumberFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error ?? undefined} hint={hint}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className={REWARD_FIELD_CLASS}
        min={min}
        max={max}
        value={numberText(value)}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onText(event.target.value)}
      />
    </Field>
  );
}
