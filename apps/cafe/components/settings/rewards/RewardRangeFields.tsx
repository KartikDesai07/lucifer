"use client";

import { useId, useState } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { REWARD_SELECT_ITEM_CLASS, REWARD_SELECT_TRIGGER_CLASS } from "@/components/settings/rewards/reward-ui";
import { requiredNumber } from "@/lib/reward-levels-form";

// What the number counts: shown in the labels so the owner never has to guess the unit.
export type RewardRangeUnit = "percent" | "rupees" | "points";

const UNIT_SUFFIX: Record<RewardRangeUnit, string> = { percent: " (%)", rupees: " (₹)", points: " (points)" };
const EXACT = "exact";
const RANDOM = "random";

interface RewardRangeFieldsProps {
  unit: RewardRangeUnit;
  min: number;
  max: number;
  minError: string | null;
  maxError: string | null;
  limits: { min: number; max: number };
  onChange: (min: number, max: number) => void;
}

// "Exact" gives every diner the same amount (it stores min = max); "Random between" draws a value from a range.
// The mode is the owner's choice, not derived from the values, so typing a "To" equal to "From" never flips it.
export function RewardRangeFields({ unit, min, max, minError, maxError, limits, onChange }: RewardRangeFieldsProps) {
  const modeId = useId();
  const [random, setRandom] = useState(min !== max);
  const suffix = UNIT_SUFFIX[unit];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={modeId} className={BRAND_LABEL_CLASS}>
          Amount
        </Label>
        <Select
          value={random ? RANDOM : EXACT}
          onValueChange={(next) => {
            const wantRandom = next === RANDOM;
            setRandom(wantRandom);
            // Back to Exact: both ends become the lowest value, so what is shown is what is saved.
            if (!wantRandom) onChange(min, min);
          }}
        >
          <SelectTrigger id={modeId} className={REWARD_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EXACT} className={REWARD_SELECT_ITEM_CLASS}>
              Exact
            </SelectItem>
            <SelectItem value={RANDOM} className={REWARD_SELECT_ITEM_CLASS}>
              Random between
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {random ? (
        <div className="grid grid-cols-2 gap-3">
          <RewardNumberField
            label={`From${suffix}`}
            value={min}
            min={limits.min}
            max={limits.max}
            error={minError}
            onText={(text) => onChange(requiredNumber(text), max)}
          />
          <RewardNumberField
            label={`To${suffix}`}
            value={max}
            min={limits.min}
            max={limits.max}
            error={maxError}
            onText={(text) => onChange(min, requiredNumber(text))}
          />
        </div>
      ) : (
        <RewardNumberField
          label={`Value${suffix}`}
          value={min}
          min={limits.min}
          max={limits.max}
          error={minError ?? maxError}
          onText={(text) => {
            const value = requiredNumber(text);
            onChange(value, value);
          }}
        />
      )}
    </div>
  );
}
