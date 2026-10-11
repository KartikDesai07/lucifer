"use client";

import { ChevronDown } from "lucide-react";

import {
  REWARD_CAP_RUPEES_MAX,
  REWARD_CAP_RUPEES_MIN,
  REWARD_MIN_BILL_MAX,
  REWARD_MIN_BILL_MIN,
  REWARD_WEIGHT_MAX,
  REWARD_WEIGHT_MIN,
  REWARD_WEIGHT_DEFAULT,
  type RewardOption,
} from "@pos/shared/reward-levels";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { REWARD_BUTTON_CLASS } from "@/components/settings/rewards/reward-ui";
import { kindAllowsMinBill } from "@/lib/reward-levels-edit";
import { optionalNumber, requiredNumber } from "@/lib/reward-levels-form";

const CAP_KINDS: ReadonlySet<string> = new Set(["product-percent", "category-percent"]);

export interface RewardLimitErrors {
  weight: string | null;
  capRupees: string | null;
  minBill: string | null;
}

interface RewardOptionLimitsProps {
  option: RewardOption;
  /** Only a box with two or more rewards has a chance to set. */
  showChance: boolean;
  errors: RewardLimitErrors;
  onChange: (next: RewardOption) => void;
}

// An optional number goes in when typed and is REMOVED when blanked (never left as undefined or 0). The kind check
// happens at the call site, so the key is always one this option's kind allows.
function withOptionalNumber(option: RewardOption, key: "capRupees" | "minBill", value: number | undefined): RewardOption {
  const next: Record<string, unknown> = { ...option };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as unknown as RewardOption;
}

function currentOf(option: RewardOption, key: "capRupees" | "minBill"): number | undefined {
  const fields: Record<string, unknown> = { ...option };
  const value = fields[key];
  return typeof value === "number" ? value : undefined;
}

// The rarely used per-reward limits, folded under "More options": its chance (with two or more rewards), "up to ₹" on
// a percent off an item or category, and "only on bills of ₹ or more". Open from the start when one is already set
// or has a problem, so a set limit is never hidden.
export function RewardOptionLimits({ option, showChance, errors, onChange }: RewardOptionLimitsProps) {
  const hasCap = CAP_KINDS.has(option.kind);
  const hasMinBill = kindAllowsMinBill(option.kind);
  if (!showChance && !hasCap && !hasMinBill) return null;

  const cap = currentOf(option, "capRupees");
  const minBill = currentOf(option, "minBill");
  const startOpen =
    cap !== undefined || minBill !== undefined || (showChance && option.weight !== REWARD_WEIGHT_DEFAULT) ||
    errors.weight !== null || errors.capRupees !== null || errors.minBill !== null;

  return (
    <Collapsible defaultOpen={startOpen} className="rounded-md border border-brand-rule">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`${REWARD_BUTTON_CLASS} w-full justify-between px-3 text-sm font-medium text-brand-ink`}
        >
          More options
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-brand-rule p-3">
        {showChance && (
          <RewardNumberField
            label="Chance"
            value={option.weight}
            min={REWARD_WEIGHT_MIN}
            max={REWARD_WEIGHT_MAX}
            error={errors.weight}
            hint="Rewards share the cards in proportion to these numbers. 1 and 1 is an even split; 3 and 1 makes the first one three times as likely."
            onText={(text) => onChange({ ...option, weight: requiredNumber(text) })}
          />
        )}
        {hasCap && (
          <RewardNumberField
            label="Up to ₹"
            value={cap}
            min={REWARD_CAP_RUPEES_MIN}
            max={REWARD_CAP_RUPEES_MAX}
            error={errors.capRupees}
            hint="The most this reward takes off. Leave blank for no limit."
            onText={(text) => onChange(withOptionalNumber(option, "capRupees", optionalNumber(text)))}
          />
        )}
        {hasMinBill && (
          <RewardNumberField
            label="Only on bills of ₹ or more"
            value={minBill}
            min={REWARD_MIN_BILL_MIN}
            max={REWARD_MIN_BILL_MAX}
            error={errors.minBill}
            hint="Leave blank to use it on any bill."
            onText={(text) => onChange(withOptionalNumber(option, "minBill", optionalNumber(text)))}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
