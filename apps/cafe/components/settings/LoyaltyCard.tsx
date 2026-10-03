"use client";

import { useId } from "react";
import { Controller, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { LOYALTY_MIN_BILL_MAX, LOYALTY_MIN_BILL_MIN } from "@pos/shared/public-diner";
import {
  LOYALTY_CARD_SIZE_MAX,
  LOYALTY_CARD_SIZE_MIN,
  LOYALTY_UNIT_LABEL_MAX_LEN,
} from "@pos/shared/loyalty-rules";
import { Input } from "@/components/ui/input";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { Field, SettingsGroup, ToggleRow } from "@/components/settings/SettingsFields";

interface LoyaltyCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
}

// CB-4 — diner accounts + the stamp card, on the SAME settings screen as QR
// ordering.
//
// CB-5A FIX B — the reward ladder below (LoyaltyStampGrid) is now the
// SINGLE editor of "what a reward is": what a full card earns, one flat
// value or a multi-step ladder. This file keeps only the controls that are
// NOT part of that ladder contract — diner accounts, the stamp-card switch,
// and the accrual gate (minimum bill). The 4 superseded controls
// (loyaltyStampsPerReward/loyaltyRewardKind/loyaltyRewardValue/loyaltyRewardItem)
// stay in settingsSchema and this section's fields (legacy fallback for a
// cafe that never opens this page — see settings-sections.test.ts's exact-
// partition pin) and the form still seeds/submits them unchanged; they are
// simply no longer independently editable here, so two controls on one page
// can no longer disagree about what the reward is.
//
// Settings pass slice 8 — two SettingsGroups. The card size and the stamp's
// name MOVED here from LoyaltyStampGrid: they describe the card, not a reward.
// A diner sees the stamp card only when sign-in AND the card are both on
// (diner-route-guard dinerLoyaltyOn), so the card switch is shown off and
// locked while sign-in is off. The STORED value is never rewritten by that:
// turn sign-in back on and the cafe's own choice is still there.
export function LoyaltyCard({ control, register, errors }: LoyaltyCardProps) {
  const minBillId = useId();
  const cardSizeId = useId();
  const unitLabelId = useId();
  const accountsOn = useWatch({ control, name: "dinerAccountsEnabled" }) === true;

  return (
    <>
      <SettingsGroup title="Diner accounts" description="Sign-in on the QR menu. The stamp card needs it.">
        <Controller
          control={control}
          name="dinerAccountsEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Let diners sign in"
              description="Diners sign in on the QR menu with their mobile number and a 4-digit PIN to see their past orders. If someone forgets their PIN, staff reset it at the counter."
              checked={field.value ?? false}
              onChange={field.onChange}
            />
          )}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Stamp card"
        description="Diners collect stamps on their bills and earn rewards along the way."
      >
        <Controller
          control={control}
          name="loyaltyEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Turn on the stamp card"
              description={
                accountsOn
                  ? "Diners collect one stamp on every bill that meets the minimum below."
                  : 'Turn on "Let diners sign in" first. Stamps are saved to each diner\'s account.'
              }
              disabled={!accountsOn}
              checked={accountsOn && (field.value ?? false)}
              onChange={field.onChange}
            />
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum bill for a stamp (₹)"
            htmlFor={minBillId}
            error={errors.loyaltyMinBill?.message}
            hint="Bills below this earn no stamp. Use 0 to stamp every bill."
          >
            <Input
              id={minBillId}
              type="number"
              inputMode="numeric"
              className={BRAND_CONTROL_CLASS}
              min={LOYALTY_MIN_BILL_MIN}
              max={LOYALTY_MIN_BILL_MAX}
              {...register("loyaltyMinBill", { valueAsNumber: true })}
            />
          </Field>

          <Field
            label="Stamps to fill the card"
            htmlFor={cardSizeId}
            error={
              typeof errors.loyaltyRules?.cardSize?.message === "string"
                ? errors.loyaltyRules.cardSize.message
                : undefined
            }
            hint="The number of boxes on the card."
          >
            <Input
              id={cardSizeId}
              type="number"
              inputMode="numeric"
              className={BRAND_CONTROL_CLASS}
              min={LOYALTY_CARD_SIZE_MIN}
              max={LOYALTY_CARD_SIZE_MAX}
              {...register("loyaltyRules.cardSize", { valueAsNumber: true })}
            />
          </Field>

          <Field
            label="Name for a stamp"
            htmlFor={unitLabelId}
            error={
              typeof errors.loyaltyRules?.unitLabel?.message === "string"
                ? errors.loyaltyRules.unitLabel.message
                : undefined
            }
            hint='Diners see this word, e.g. "stamp" or "point".'
          >
            <Input
              id={unitLabelId}
              className={BRAND_CONTROL_CLASS}
              maxLength={LOYALTY_UNIT_LABEL_MAX_LEN}
              {...register("loyaltyRules.unitLabel")}
            />
          </Field>
        </div>
      </SettingsGroup>
    </>
  );
}
