"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";

import {
  REWARD_FLAT_MAX,
  REWARD_FLAT_MIN,
  REWARD_OPTION_KINDS,
  REWARD_PERCENT_MAX,
  REWARD_PERCENT_MIN,
  REWARD_POINTS_MAX,
  REWARD_POINTS_MIN,
  REWARD_QTY_MAX,
  REWARD_QTY_MIN,
  type RewardOption,
  type RewardOptionKind,
} from "@pos/shared/reward-levels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { Field } from "@/components/settings/SettingsFields";
import { CategoryPicker } from "@/components/settings/CategoryPicker";
import { ProductPicker } from "@/components/settings/ProductPicker";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { RewardOptionLimits } from "@/components/settings/rewards/RewardOptionLimits";
import { RewardRangeFields, type RewardRangeUnit } from "@/components/settings/rewards/RewardRangeFields";
import {
  REWARD_CARD_CLASS,
  REWARD_ICON_BUTTON_CLASS,
  REWARD_NOTE_CLASS,
  REWARD_SELECT_ITEM_CLASS,
  REWARD_SELECT_TRIGGER_CLASS,
} from "@/components/settings/rewards/reward-ui";
import { NONE_WARNING, REWARD_KIND_LABELS } from "@/lib/reward-levels-copy";
import { switchKind } from "@/lib/reward-levels-edit";
import { fieldProblem, requiredNumber, type RewardProblem } from "@/lib/reward-levels-form";

const RANGE_UNIT: Partial<Record<RewardOptionKind, RewardRangeUnit>> = {
  "bill-percent": "percent",
  "product-percent": "percent",
  "category-percent": "percent",
  "bill-flat": "rupees",
  "category-flat": "rupees",
  points: "points",
};
const RANGE_LIMITS: Record<RewardRangeUnit, { min: number; max: number }> = {
  percent: { min: REWARD_PERCENT_MIN, max: REWARD_PERCENT_MAX },
  rupees: { min: REWARD_FLAT_MIN, max: REWARD_FLAT_MAX },
  points: { min: REWARD_POINTS_MIN, max: REWARD_POINTS_MAX },
};

interface RewardOptionFieldsProps {
  option: RewardOption;
  /** 0-based position inside the box, how many rewards the box has, and this reward's chance in whole percent. */
  index: number;
  count: number;
  chance: number;
  /** Where the reward sits (a 0-based level index and the 1-based box) so its problems can be found. */
  level: number;
  step: number;
  problems: readonly RewardProblem[];
  onChange: (next: RewardOption) => void;
  onRemove: () => void;
}

// One reward of a box: what it is (all eight kinds in one dropdown), its amount or pick, and its limits.
export function RewardOptionFields({ option, index, count, chance, level, step, problems, onChange, onRemove }: RewardOptionFieldsProps) {
  const kindId = useId();
  const itemId = useId();
  const problem = (field: string): string | null => fieldProblem(problems, level, step, option.id, field);
  const unit = RANGE_UNIT[option.kind];

  return (
    <div className={REWARD_CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-brand-ink">
          {count > 1 ? `Reward ${index + 1} · ${chance}% chance` : "Reward"}
        </p>
        {count > 1 && (
          <Button
            type="button"
            variant="ghost"
            className={`${REWARD_ICON_BUTTON_CLASS} text-brand-danger hover:text-brand-danger`}
            aria-label={`Remove reward ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={kindId} className={BRAND_LABEL_CLASS}>
          What diners get
        </Label>
        <Select value={option.kind} onValueChange={(next) => onChange(switchKind(option, next as RewardOptionKind))}>
          <SelectTrigger id={kindId} className={REWARD_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REWARD_OPTION_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind} className={REWARD_SELECT_ITEM_CLASS}>
                {REWARD_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(option.kind === "product-percent" || option.kind === "free-item") && (
        <Field label="Item" htmlFor={itemId} error={problem("productId") ?? problem("productName") ?? undefined}>
          <ProductPicker
            id={itemId}
            value={option.productId}
            currentName={option.productName}
            invalid={problem("productId") !== null || problem("productName") !== null}
            className={REWARD_SELECT_TRIGGER_CLASS}
            itemClassName={REWARD_SELECT_ITEM_CLASS}
            onChange={(productId, productName) => onChange({ ...option, productId, productName })}
          />
        </Field>
      )}

      {(option.kind === "category-percent" || option.kind === "category-flat") && (
        <Field label="Category" htmlFor={itemId} error={problem("categoryId") ?? problem("categoryName") ?? undefined}>
          <CategoryPicker
            id={itemId}
            value={option.categoryId}
            currentName={option.categoryName}
            invalid={problem("categoryId") !== null || problem("categoryName") !== null}
            className={REWARD_SELECT_TRIGGER_CLASS}
            itemClassName={REWARD_SELECT_ITEM_CLASS}
            onChange={(categoryId, categoryName) => onChange({ ...option, categoryId, categoryName })}
          />
        </Field>
      )}

      {unit !== undefined && "min" in option && (
        <RewardRangeFields
          key={option.kind}
          unit={unit}
          min={option.min}
          max={option.max}
          limits={RANGE_LIMITS[unit]}
          minError={problem("min")}
          maxError={problem("max")}
          onChange={(min, max) => onChange({ ...option, min, max })}
        />
      )}

      {option.kind === "free-item" && (
        <RewardNumberField
          label="How many"
          value={option.qty}
          min={REWARD_QTY_MIN}
          max={REWARD_QTY_MAX}
          error={problem("qty")}
          onText={(text) => onChange({ ...option, qty: requiredNumber(text) })}
        />
      )}

      {option.kind === "none" && <p className={REWARD_NOTE_CLASS}>{NONE_WARNING}</p>}

      <RewardOptionLimits
        option={option}
        showChance={count > 1}
        errors={{ weight: problem("weight"), capRupees: problem("capRupees"), minBill: problem("minBill") }}
        onChange={onChange}
      />
    </div>
  );
}
