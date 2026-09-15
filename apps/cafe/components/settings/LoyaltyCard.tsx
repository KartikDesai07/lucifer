"use client";

import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { LOYALTY_MIN_BILL_MAX, LOYALTY_MIN_BILL_MIN } from "@pos/shared/public-diner";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, ToggleRow } from "@/components/settings/SettingsFields";

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
// value or a multi-step ladder. This card keeps only the 3 controls that are
// NOT part of that ladder contract — diner accounts, the stamp-card switch,
// and the accrual gate (minimum bill). The 4 superseded controls
// (loyaltyStampsPerReward/loyaltyRewardKind/loyaltyRewardValue/loyaltyRewardItem)
// stay in settingsSchema and this section's fields (legacy fallback for a
// cafe that never opens this page — see settings-sections.test.ts's exact-
// partition pin) and the form still seeds/submits them unchanged; they are
// simply no longer independently editable here, so two controls on one page
// can no longer disagree about what the reward is.
export function LoyaltyCard({ control, register, errors }: LoyaltyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Diner accounts &amp; stamp card</CardTitle>
        <CardDescription>
          Let diners sign in on the QR menu with their mobile number and a 4-digit PIN, and collect a stamp on every
          qualifying bill. The reward ladder below decides what a completed card is worth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Controller
          control={control}
          name="dinerAccountsEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Diner accounts"
              description="Diners can sign in with their mobile number and a 4-digit PIN to see their past orders. If someone forgets their PIN, staff reset it at the counter."
              checked={field.value ?? false}
              onChange={field.onChange}
            />
          )}
        />

        <Controller
          control={control}
          name="loyaltyEnabled"
          render={({ field }) => (
            <ToggleRow
              label="Stamp card"
              description="Collect a stamp on every bill above the minimum below. Needs diner accounts to be on."
              checked={field.value ?? false}
              onChange={field.onChange}
            />
          )}
        />

        <Field
          label="Minimum bill for one stamp (₹)"
          error={errors.loyaltyMinBill?.message}
          hint="A bill below this earns no stamp. Use 0 to stamp every bill."
        >
          <Input
            type="number"
            min={LOYALTY_MIN_BILL_MIN}
            max={LOYALTY_MIN_BILL_MAX}
            {...register("loyaltyMinBill", { valueAsNumber: true })}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
