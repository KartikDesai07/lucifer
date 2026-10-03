"use client";

import { useId } from "react";
import { Controller, useWatch } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  LOYALTY_CLAIM_WITHIN_DAYS_MIN,
  LOYALTY_CLAIM_WITHIN_DAYS_MAX,
} from "@pos/shared/loyalty-rules";
import { normalizePromoCode } from "@pos/shared/public-promo";
import { milestonePromoStatus, NO_PROMO_CODE_VALUE } from "@/lib/milestone-promo-status";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRAND_CONTROL_CLASS, BRAND_FIELD_ERROR_CLASS } from "@/components/brand/brand-classes";
import { Field, HINT_CLASS, SectionLink } from "@/components/settings/SettingsFields";
import { rowFieldMessage } from "@/components/settings/MilestoneRewardFields";

// CB-5D — split out of MilestoneRewardFields.tsx to stay under the ~300-line
// cap: these two controls are the "promo code" concern (a code and its
// claim-by TTL), separate from the reward-SHAPE concern (kind/value/item/qty)
// the parent still owns. Same row, same caller, same error plumbing — just a
// second component so the parent keeps its own budget.
//
// Settings pass slice 8 — the promo code is PICKED from the cafe's promo list,
// not typed. Nothing creates a code when a reward is saved: at claim time
// buildRewardAssignment (lib/reward-assignment.ts) hands the diner a code only
// if it is ALREADY in Settings' promo list and switched on, otherwise it gives
// nothing and says nothing. So the picker offers only real list codes, and
// warns (milestonePromoStatus mirrors that builder) when a saved code has
// since been deleted or switched off. "No code" stores undefined, which also
// removes the old trap where a typed-then-cleared "" failed the 3-16 letters
// rule and blocked Save.
interface MilestoneRewardCodeFieldsProps {
  control: Control<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  index: number;
}

export function MilestoneRewardCodeFields({ control, errors, index }: MilestoneRewardCodeFieldsProps) {
  const promoId = useId();
  const claimId = useId();
  // The saved promo list (this page's form holds the full settings defaults).
  const promoCodes = useWatch({ control, name: "promoCodes" });
  const promoCode = useWatch({ control, name: `loyaltyRules.milestones.${index}.promoCode` });

  const listable = (promoCodes ?? []).filter((c) => typeof c?.code === "string" && c.code.trim() !== "");
  const status = milestonePromoStatus(promoCode, promoCodes);
  const current = promoCode ? normalizePromoCode(promoCode) : "";
  const promoError = rowFieldMessage(errors.loyaltyRules?.milestones, index, "promoCode");

  return (
    <>
      <Field label="Promo code" htmlFor={promoId} error={promoError}>
        <Controller
          control={control}
          name={`loyaltyRules.milestones.${index}.promoCode`}
          render={({ field }) => (
            <Select
              value={field.value ? normalizePromoCode(field.value) : NO_PROMO_CODE_VALUE}
              onValueChange={(next) => field.onChange(next === NO_PROMO_CODE_VALUE ? undefined : next)}
            >
              <SelectTrigger id={promoId} className={BRAND_CONTROL_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROMO_CODE_VALUE}>No code</SelectItem>
                {listable.map((c, i) => (
                  <SelectItem key={`${c.code}-${i}`} value={c.code} disabled={c.active === false}>
                    {c.code + (c.active === false ? " (switched off)" : "")}
                  </SelectItem>
                ))}
                {status === "missing" && (
                  <SelectItem value={current} disabled>
                    {`${current} (not in your list)`}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        />
        {/* A zod error replaces this line (Field shows it below the control). */}
        {!promoError && status === "missing" && (
          <p className={BRAND_FIELD_ERROR_CLASS}>
            {`${current} isn't in your promo list, so diners get no code. Pick another or add it under `}
            <SectionLink slug="qr-ordering">QR ordering</SectionLink>.
          </p>
        )}
        {!promoError && status === "off" && (
          <p className={BRAND_FIELD_ERROR_CLASS}>
            {`${current} is switched off in your promo list, so diners get no code. Switch it on under `}
            <SectionLink slug="qr-ordering">QR ordering</SectionLink>.
          </p>
        )}
        {!promoError && status !== "missing" && status !== "off" && listable.length === 0 && (
          <p className={HINT_CLASS}>
            You have no promo codes yet. Add one under <SectionLink slug="qr-ordering">QR ordering</SectionLink> to
            give it with this reward.
          </p>
        )}
        {!promoError && status !== "missing" && status !== "off" && listable.length > 0 && (
          <p className={HINT_CLASS}>Optional. A diner who claims this reward also gets this code to use once.</p>
        )}
      </Field>

      <Field
        label="Claim within (days)"
        htmlFor={claimId}
        error={rowFieldMessage(errors.loyaltyRules?.milestones, index, "claimWithinDays")}
        hint="How long after reaching this box a diner can still claim it. Leave blank for no deadline."
      >
        {/* How long after EARNING this rung a diner may still claim it —
            distinct from the promo code's own validity once claimed. */}
        <Controller
          control={control}
          name={`loyaltyRules.milestones.${index}.claimWithinDays`}
          render={({ field }) => (
            <Input
              id={claimId}
              type="number"
              inputMode="numeric"
              className={BRAND_CONTROL_CLASS}
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
