"use client";

import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { Input } from "@/components/ui/input";
import { SETTINGS_INPUT_CLASS } from "@/lib/settings-card-layout";
import { CardField, SettingsBlock, SettingsCard } from "@/components/settings/SettingsCard";
import { PayQrFields } from "@/components/settings/PayQrFields";
import { UpiRulesFields } from "@/components/settings/UpiRulesFields";

interface UpiPaymentsCardProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  className?: string;
}

// The bill's UPI QR in one card: the main UPI ID, the optional amount slabs under it, and when the pay QR prints (plan D2,
// 2026-11-06; the UPI ID came from Contact & licence).
export function UpiPaymentsCard({ control, register, errors, className }: UpiPaymentsCardProps) {
  return (
    <SettingsCard
      title="UPI payments"
      sub="Customers scan the QR on a bill and pay to these UPI IDs."
      className={className}
    >
      <CardField
        label="UPI ID"
        htmlFor="settings-upiId"
        error={errors.upiId?.message}
        hint="For the Scan to pay QR on bills. Example: yourshop@okaxis"
      >
        <Input
          id="settings-upiId"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={SETTINGS_INPUT_CLASS}
          {...register("upiId")}
        />
      </CardField>
      <UpiRulesFields control={control} register={register} errors={errors} />
      <SettingsBlock title="Pay QR on bills" sub="When a bill prints a QR, and how long it works.">
        <PayQrFields control={control} errors={errors} />
      </SettingsBlock>
    </SettingsCard>
  );
}
